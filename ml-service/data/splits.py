"""Stratified splits for the gold pool (labeled_set.csv).

Artifacts (all under labeling/):
  splits.json         train/val/test of the v1 TRAINING POOL = 60% of ELIGIBLE gold.
                      70/15/15 stratified by tier, seeded.
  heldout_pool.csv    the release-later portion of the 40% held out from v1 —
                      the demo refresh trains on this (continual-learning money
                      shot: v2 genuinely sees data v1 never did).
  regression_set.csv  FROZEN evaluation set (never trained on by ANY version):
                      carved from test AND from the heldout pool, so it stays
                      frozen even after the demo release. Gate = challenger vs
                      champion on THIS set only.
  disagreement.csv    (written by kappa.py) — rows where the two annotators
                      disagreed. Those rows are QUARANTINED: excluded from
                      every split below (train/val/test/regression/heldout),
                      which is what makes the published kappa honest.

All 550 rows stay in labeled_set.csv (the demo DB seeds from it); in_holdout=1
marks every row not in the v1 pool (heldout + frozen-from-heldout + quarantined)
so trainer and seed scripts filter consistently.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import random
from collections import defaultdict
from pathlib import Path

from model.config import LABELING_DIR, SEED, TIERS


def stratified(rows, frac, rng):
    """Take ~frac of rows preserving tier proportions (ceil for coverage)."""
    by_tier = defaultdict(list)
    for r in rows:
        by_tier[r["tier"]].append(r)
    picked = []
    for t, rs in by_tier.items():
        rng.shuffle(rs)
        k = math.ceil(len(rs) * frac)
        picked += rs[:k]
    return picked


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default=str(LABELING_DIR / "labeled_set.csv"))
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--v1-frac", type=float, default=0.6)
    ap.add_argument("--regression-frac", type=float, default=0.4,
                    help="share of the test split carved as the frozen regression set")
    ap.add_argument("--regression-extra-frac", type=float, default=0.15,
                    help="share of the heldout pool ALSO frozen as regression "
                         "(so the demo release can never contaminate the gate)")
    args = ap.parse_args()
    rng = random.Random(args.seed)

    all_rows = list(csv.DictReader(open(args.input, encoding="utf-8")))
    gold = [r for r in all_rows if r.get("tier") in TIERS]

    # 0) quarantine: two-annotator disagreements are not training gold
    dis_path = LABELING_DIR / "disagreement.csv"
    quarantined: set[str] = set()
    if dis_path.exists():
        with open(dis_path, encoding="utf-8") as f:
            quarantined = {r["id"] for r in csv.DictReader(f) if r.get("id")}
    quarantined &= {r["id"] for r in gold}
    eligible = [r for r in gold if r["id"] not in quarantined]
    print(f"[splits] gold={len(gold)} quarantined={len(quarantined)} eligible={len(eligible)}")

    # 1) v1 pool (60% of eligible) vs held-out release pool (40%)
    v1_pool = stratified(eligible, args.v1_frac, rng)
    v1_ids = {r["id"] for r in v1_pool}
    heldout = [r for r in eligible if r["id"] not in v1_ids]

    # 2) stratified 70/15/15 inside the v1 pool
    train = stratified(v1_pool, 0.70, rng)
    train_ids = {r["id"] for r in train}
    rest = [r for r in v1_pool if r["id"] not in train_ids]
    val = stratified(rest, 0.50, rng)
    val_ids = {r["id"] for r in val}
    test = [r for r in rest if r["id"] not in val_ids]
    test_ids = {r["id"] for r in test}

    # 3) frozen regression set: from test AND from the heldout pool. The
    #    heldout-derived part is removed from heldout_pool.csv so releasing
    #    the demo pool can never contaminate the gate.
    regression = stratified(test, args.regression_frac, rng)
    reg_heldout = stratified(heldout, args.regression_extra_frac, rng)
    regression += reg_heldout
    reg_ids = {r["id"] for r in regression}
    release_pool = [r for r in heldout if r["id"] not in reg_ids]
    eval_ids = test_ids - reg_ids  # pure eval remainder

    out = LABELING_DIR
    out.mkdir(parents=True, exist_ok=True)

    def dump(name, rs):
        with open(out / name, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(rs[0].keys()))
            w.writeheader()
            w.writerows(rs)

    dump("heldout_pool.csv", release_pool)
    dump("regression_set.csv", regression)

    splits = {
        "seed": args.seed,
        "v1_frac": args.v1_frac,
        "quarantined": sorted(quarantined),
        "train": sorted(train_ids),
        "val": sorted(val_ids),
        "test": sorted(test_ids),
        "regression": sorted(reg_ids),
        "eval": sorted(eval_ids),
        "heldout": sorted(r["id"] for r in heldout),  # incl. frozen-from-heldout
        "release_pool": sorted(r["id"] for r in release_pool),
        "counts": {
            "gold": len(gold), "quarantined": len(quarantined),
            "train": len(train_ids), "val": len(val_ids),
            "test": len(test_ids), "regression": len(reg_ids), "eval": len(eval_ids),
            "heldout": len(heldout), "release_pool": len(release_pool),
        },
        "train_tier_distribution": {t: sum(1 for r in train if r["tier"] == t) for t in TIERS},
        "regression_tier_distribution": {t: sum(1 for r in regression if r["tier"] == t) for t in TIERS},
    }
    (out / "splits.json").write_text(json.dumps(splits, indent=2), encoding="utf-8")

    # 4) rewrite labeled_set.csv with in_holdout flags (ALL rows kept)
    fields = list(all_rows[0].keys())
    if "in_holdout" not in fields:
        fields.append("in_holdout")
    with open(args.input, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in all_rows:
            r["in_holdout"] = 1 if r["id"] not in v1_ids else 0
            w.writerow(r)

    print(f"[splits] v1_pool={len(v1_ids)} train={len(train_ids)} "
          f"val={len(val_ids)} test={len(test_ids)} regression={len(reg_ids)} "
          f"release_pool={len(release_pool)}")
    print(f"[splits] train tiers: {splits['train_tier_distribution']}")
    print(f"[splits] frozen regression tiers: {splits['regression_tier_distribution']}")


if __name__ == "__main__":
    main()
