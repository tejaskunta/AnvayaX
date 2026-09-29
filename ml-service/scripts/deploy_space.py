"""Deploy the AnvayaX ML microservice as a Hugging Face Docker Space.

Prereq: an HF account + `hf auth login` (token from
https://huggingface.co/settings/tokens). Uses the cached token; this script
never reads or writes secrets itself.

Uploads ml-service/ (minus venv/caches/scratch data) as one commit, which
triggers the Space's Docker build, then polls until the Space is Running.
Idempotent — re-running uploads a new commit and waits for the rebuild.

Usage (Windows, from repo root):
    ml-service\\.venv\\Scripts\\python.exe ml-service\\scripts\\deploy_space.py
    ml-service\\.venv\\Scripts\\python.exe ml-service\\scripts\\deploy_space.py --name anvayax-ml
"""
from __future__ import annotations

import argparse
import sys
import time
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi
from huggingface_hub.errors import HfHubHTTPError

ML_DIR = Path(__file__).resolve().parent.parent

# Everything the container needs; everything heavy/ephemeral stays local.
IGNORE = [
    ".venv/*",
    "**/__pycache__/*",
    ".pytest_cache/*",
    "tests/*",
    "scripts/*",
    "artifacts/*",
    "data/raw/*",
    "labeling/*.csv",
    "labeling/*.json",
    # v1/v2 weights are history rows only — the Space loads the active v3 adapter.
    "model_registry/v1/adapter_model.safetensors",
    "model_registry/v2/adapter_model.safetensors",
    "model_registry/**/*.safetensors.tmp",
]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="anvayax-ml", help="Space repo name")
    ap.add_argument("--private", action="store_true", help="make the Space private")
    ap.add_argument("--no-wait", action="store_true", help="upload only")
    args = ap.parse_args()

    api = HfApi()
    try:
        me = api.whoami()
    except Exception:
        print("Not logged in to Hugging Face. Run:  hf auth login", file=sys.stderr)
        return 2
    user = me["name"]
    space = args.name

    print(f"> HF account : {user}")
    print(f"> Space      : {user}/{space} ({'private' if args.private else 'public'})")

    api.create_repo(
        repo_id=space,
        repo_type="space",
        space_sdk="docker",
        private=args.private,
        exist_ok=True,
    )

    print("> Uploading ml-service/ (README frontmatter triggers the Docker build)...")
    api.upload_folder(
        repo_id=space,
        repo_type="space",
        folder_path=str(ML_DIR),
        ignore_patterns=IGNORE,
        commit_message="Deploy AnvayaX ML service (v3 adapter, CPU inference)",
    )

    url = f"https://huggingface.co/spaces/{user}/{space}"
    direct = f"https://{user.replace(' ', '-').lower()}-{space.replace('_', '-')}.hf.space"
    print(f"> Space page : {url}")
    print(f"> API base   : {direct}")
    if args.no_wait:
        return 0

    print("> Waiting for build (torch + model bake takes ~5-15 min on first build)...")
    last = None
    deadline = time.time() + 60 * 25
    while time.time() < deadline:
        try:
            rt = api.get_space_runtime(space)
            stage = str(rt.stage)
            if stage != last:
                print(f"  [{time.strftime('%H:%M:%S')}] stage={stage}"
                      + (f" reason={rt.reason}" if getattr(rt, "reason", None) else ""))
                last = stage
            if stage.endswith("RUNNING"):
                print("> Space is RUNNING. Verifying /health ...")
                for base in (direct, url):
                    try:
                        with urllib.request.urlopen(f"{base}/health", timeout=60) as r:
                            print("  /health ->", r.read().decode())
                        print(f"\nSet on Vercel:  ML_SERVICE_URL={base}")
                        return 0
                    except Exception as e:
                        print(f"  {base}/health not answering yet ({e})")
                print("! Running but /health unreachable — check Space logs.",
                      file=sys.stderr)
                return 1
            if "FAILED" in stage:
                print(f"! Build ended in {stage}. Open {url} -> Settings/Logs for the "
                      "Docker build output.", file=sys.stderr)
                return 1
        except HfHubHTTPError as e:
            print(f"  poll error: {e}", file=sys.stderr)
        time.sleep(20)

    print("! Timed out waiting. Check build logs at " + url, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
