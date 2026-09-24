"""Inter-annotator agreement — Cohen's kappa on the double-annotated subset.

150 of the ~550 synthetic gold rows are annotated by two independent passes
(model-assisted + human, per docs/DATASET_AND_SCOPE_PLAN.md §1.2). Disagreements
are quarantined to disagreement.csv and EXCLUDED from training gold — publishing
kappa with n is part of the research-credibility story."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from itertools import combinations
from pathlib import Path

from .config import TIERS


def cohen_kappa(pairs: list[tuple[str, str]]) -> dict:
    """pairs: [(label_a, label_b)] on the same items. Returns kappa + observed/
    expected agreement. NaN-safe: returns kappa=None for empty input."""
    n = len(pairs)
    if n == 0:
        return {"kappa": None, "n": 0}
    a_counts, b_counts = Counter(), Counter()
    agree = 0
    for a, b in pairs:
        a_counts[a] += 1
        b_counts[b] += 1
        if a == b:
            agree += 1
    po = agree / n
    pe = sum((a_counts[t] / n) * (b_counts[t] / n) for t in set(a_counts) | set(b_counts))
    kappa = (po - pe) / (1 - pe) if pe < 1 else None
    return {"kappa": round(kappa, 4) if kappa is not None else None,
            "observed_agreement": round(po, 4),
            "expected_agreement": round(pe, 4), "n": n}


def pairwise_kappa(groups: dict[str, dict[str, str]]) -> dict:
    """groups: {annotator: {item_id: tier}} -> kappa for every annotator pair."""
    out = {}
    for a, b in combinations(sorted(groups), 2):
        shared = set(groups[a]) & set(groups[b])
        pairs = [(groups[a][i], groups[b][i]) for i in sorted(shared)]
        out[f"{a} vs {b}"] = cohen_kappa(pairs)
    return out


def process_double_csv(path: Path, out_dir: Path) -> dict:
    """Input CSV: id,text,annotator_a,annotator_b. Writes disagreement.csv and
    returns kappa stats."""
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    pairs = [(r["annotator_a"], r["annotator_b"]) for r in rows
             if r.get("annotator_a") in TIERS and r.get("annotator_b") in TIERS]
    stats = cohen_kappa(pairs)
    out_dir.mkdir(parents=True, exist_ok=True)
    dis = [r for r in rows if r.get("annotator_a") != r.get("annotator_b")]
    with open(out_dir / "disagreement.csv", "w", newline="", encoding="utf-8") as f:
        if dis:
            w = csv.DictWriter(f, fieldnames=list(dis[0].keys()))
            w.writeheader()
            w.writerows(dis)
    stats["disagreements"] = len(dis)
    (out_dir / "kappa.json").write_text(json.dumps(stats, indent=2), encoding="utf-8")
    return stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="double-annotated CSV")
    ap.add_argument("--out", default="labeling")
    args = ap.parse_args()
    print(json.dumps(process_double_csv(Path(args.input), Path(args.out)), indent=2))


if __name__ == "__main__":
    main()
