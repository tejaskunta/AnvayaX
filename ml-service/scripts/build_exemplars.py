"""Build data/exemplars.json — the reference embedding set for kNN novelty.

Exemplars = the texts the ACTIVE model was trained on (splits.json "train" ids
from labeling/labeled_set.csv). The review queue's acquisition score is
alpha*entropy + (1-alpha)*kNN-cosine-distance to this set, so "novel" reports
are ones far from the training distribution — the active-learning story.

Run BEFORE seeding the web DB so every persisted report gets a real
acquisition_score (the API hot-reloads the file by mtime, no restart needed).

At each refresh, rebuild from the challenger's training pool so exemplars
always track the active model version.

Usage (cwd=ml-service):
    .venv/bin/python -m scripts.build_exemplars
"""
from __future__ import annotations

import csv
import json

import numpy as np

from model import config as C
from model.similarity import embed


def main() -> None:
    splits = json.loads((C.LABELING_DIR / "splits.json").read_text(encoding="utf-8"))
    train_ids = set(splits["train"])
    rows = list(csv.DictReader(open(C.LABELING_DIR / "labeled_set.csv", encoding="utf-8")))
    texts = [r["text"] for r in rows if r["id"] in train_ids]
    if not texts:
        raise SystemExit("no train rows found in labeled_set.csv")

    emb = embed(texts)
    out = {
        "model_version": json.loads(C.MODEL_CONFIG_PATH.read_text())["active_version"],
        "embedding_model": C.EMBEDDING_MODEL,
        "built_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds"),
        "count": len(texts),
        "embeddings": np.round(emb, 5).tolist(),
    }
    tmp = C.DATA_DIR / "exemplars.json.tmp"
    tmp.write_text(json.dumps(out), encoding="utf-8")
    tmp.replace(C.DATA_DIR / "exemplars.json")
    print(f"exemplars.json: {len(texts)} vectors x {emb.shape[1]} dims (model={out['model_version']})")


if __name__ == "__main__":
    main()
