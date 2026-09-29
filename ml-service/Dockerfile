# AnvayaX ML microservice — CPU inference image (Hugging Face Space / any Docker host).
# Build context = ml-service/. The Space README frontmatter declares sdk: docker,
# app_port: 7860; HF injects $PORT and we bind it.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf

WORKDIR /srv

# CPU-only torch wheels first — the default PyPI torch==2.2.2 bundles CUDA
# libs (~2 GB extra) and pulls nvidia-* packages we have no use for.
RUN pip install --no-cache-dir torch==2.2.2 --index-url https://download.pytorch.org/whl/cpu

COPY requirements-docker.txt /tmp/req.txt
RUN pip install --no-cache-dir -r /tmp/req.txt \
 && python -m spacy download en_core_web_sm

COPY . /srv/

# Bake the two Hugging Face models into the image so the service boots with
# zero runtime downloads (fast cold starts, no egress flakiness on hosts
# without HF tokens). num_labels=4 matches the TIERS taxonomy in model/config.py.
RUN python -c "\
from transformers import AutoModelForSequenceClassification, AutoTokenizer; \
from sentence_transformers import SentenceTransformer; \
AutoTokenizer.from_pretrained('distilbert-base-uncased'); \
AutoModelForSequenceClassification.from_pretrained('distilbert-base-uncased', num_labels=4); \
SentenceTransformer('all-MiniLM-L6-v2'); \
print('HF models baked into image')"

EXPOSE 7860
# HF Spaces passes the routed port via $PORT; default keeps local docker run sane.
CMD ["sh", "-c", "uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
