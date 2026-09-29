"""AnvayaX ML service on Modal — serverless CPU container with a stable public URL.

Why Modal: HF Spaces now paywalls free Docker Spaces (402), and Vercel is
serverless (no torch). Modal gives us the same Docker-style image build with a
persistent https:// URL, autoscaling to zero between demo sessions.

Deploy (Windows, from repo root, after `modal token new`):
    ml-service\\.venv\\Scripts\\python.exe -m modal deploy ml-service/modal_app.py

The web endpoint URL is printed by the deploy output (also:
`modal apps list`). Set it as ML_SERVICE_URL on Vercel production + preview.

Image mirrors ml-service/Dockerfile: CPU torch, pinned deps, spaCy model, and
the HF base models baked at build time so cold starts never download weights.
"""
from __future__ import annotations

from pathlib import Path

import modal

ML_DIR = Path(__file__).resolve().parent

app = modal.App("anvayax-ml")

# Everything the container needs; heavy/ephemeral/local-only stays out.
IGNORE = [
    ".venv/*",
    "**/__pycache__/*",
    ".pytest_cache/*",
    "tests/*",
    "scripts/*",
    # v1/v2 weights are history rows only — the service loads the active v3 adapter.
    "model_registry/v1/adapter_model.safetensors",
    "model_registry/v2/adapter_model.safetensors",
    "model_registry/**/*.safetensors.tmp",
    "Dockerfile",
    ".dockerignore",
]

# Must stay on ONE line: Modal turns run_commands into a Dockerfile RUN, and a
# newline here would be parsed as a separate Dockerfile instruction.
BAKE_MODELS = (
    "from transformers import AutoModelForSequenceClassification, AutoTokenizer; "
    "from sentence_transformers import SentenceTransformer; "
    "AutoTokenizer.from_pretrained('distilbert-base-uncased'); "
    "AutoModelForSequenceClassification.from_pretrained('distilbert-base-uncased', num_labels=4); "
    "SentenceTransformer('all-MiniLM-L6-v2'); "
    "print('HF models baked into image')"
)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .env(
        {
            "PYTHONUNBUFFERED": "1",
            "HF_HOME": "/opt/hf",
            "HF_HUB_DISABLE_TELEMETRY": "1",
        }
    )
    # CPU-only torch from the PyTorch index, exactly like the Dockerfile.
    .pip_install("torch==2.2.2", index_url="https://download.pytorch.org/whl/cpu")
    # torch is deliberately absent from requirements-docker.txt (installed above).
    .pip_install_from_requirements(str(ML_DIR / "requirements-docker.txt"))
    .run_commands("python -m spacy download en_core_web_sm")
    # Bake base weights into the image layer (no local files needed) so cold
    # starts never download from HF. Must come before add_local_dir.
    .run_commands(f'python -c "{BAKE_MODELS}"')
    .workdir("/srv")
    # Local service code/artifacts mount at container startup — keep last.
    .add_local_dir(ML_DIR, remote_path="/srv", ignore=IGNORE)
)


@app.function(
    image=image,
    cpu=2.0,
    memory=4096,
    # Keep the container warm 5 min after the last request so a reviewer
    # clicking through the demo never pays a cold start twice.
    scaledown_window=300,
    timeout=600,
)
@modal.asgi_app(label="ml")
def service():
    import sys

    sys.path.insert(0, "/srv")

    # Pre-warm at container boot (runs before the first request is served):
    # load the v3 LoRA bundle + MiniLM so /health and /classify answer instantly.
    from model.classifier_infer import _load_bundle
    from model.similarity import embed

    _load_bundle()
    embed(["warmup"])

    from api.main import app as fastapi_app

    return fastapi_app
