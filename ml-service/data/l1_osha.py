"""L1 OSHA layer — public construction-incident narratives.

PURPOSE (docs/DATASET_AND_SCOPE_PLAN.md §1): embedding exposure + pipeline
smoke-test ONLY. These rows are US construction reports, a different domain
from upstream oil & gas; they are NEVER inserted into the demo DB and NEVER
used as SIF gold labels. Downloading requires a Kaggle login (manual step):

  1. Download "OSHA Literature and Data" (or the public OSHA violations detail
     export) and place the CSV at:  data/raw/osha/osha.csv
  2. Run: python -m data.l1_osha            (samples ~1000 narratives)

Output: data/osha_exposure.csv (id, text) — consumed by scripts only to warm
the embedding cache / prove the pipeline handles messy real-world text.
"""
from __future__ import annotations

import argparse
import csv
import random
import re
from pathlib import Path

from model.config import DATA_DIR, SEED

RAW = DATA_DIR / "raw" / "osha" / "osha.csv"
CANDIDATE_TEXT_COLS = ["Narrative", "Description", "narrative", "text"]


def _clean(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def sample(limit: int = 1000, seed: int = SEED) -> list[dict]:
    if not RAW.exists():
        print(f"[l1] {RAW} not found — skipping (manual download step, see module docstring).")
        return []
    with open(RAW, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.DictReader(f)
        col = next((c for c in CANDIDATE_TEXT_COLS if c in (reader.fieldnames or [])), None)
        if not col:
            print("[l1] no narrative column found in osha.csv")
            return []
        rows = []
        for i, r in enumerate(reader):
            t = _clean(r.get(col) or "")
            if 60 <= len(t) <= 1200:
                rows.append({"id": f"L1-{i}", "text": t})
    rng = random.Random(seed)
    rng.shuffle(rows)
    rows = rows[:limit]
    out = DATA_DIR / "osha_exposure.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "text"])
        w.writeheader()
        w.writerows(rows)
    print(f"[l1] wrote {len(rows)} narratives -> {out} (exposure only, never demo DB)")
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=SEED)
    sample(ap.parse_args().limit, ap.parse_args().seed)
