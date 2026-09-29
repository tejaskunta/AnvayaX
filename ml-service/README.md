---
title: AnvayaX ML Service
emoji: 🛢️
colorFrom: red
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
license: mit
---

Stateless FastAPI inference microservice for AnvayaX (SIF precursor
intelligence): `/classify`, `/classify-batch`, `/extract-precursors`,
`/model-info`, `/health`, `/train`. Called server-side by the Next.js app
(ML_SERVICE_URL) — no browser talks to it directly, so no CORS layer needed.

Loads the committed v3 LoRA adapter over distilbert-base-uncased (CPU),
plus all-MiniLM-L6-v2 for 384-dim embeddings; both base models are baked
into the image at build time.
