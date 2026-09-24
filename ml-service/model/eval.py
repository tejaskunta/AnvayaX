"""Evaluation — per-class metrics, F2 for SIF-positive, threshold sweep, and the
champion/challenger regression gate.

THE GATE (docs/CONTINUAL_LEARNING.md §3): a challenger vK+1 is promoted only if
its SIF-positive recall on the FROZEN regression set is >= the champion's recall
minus GATE_RECALL_TOLERANCE_PP percentage points. Everything else is report
decoration; this one number protects the safety-critical metric."""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

import numpy as np
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    precision_recall_curve,
    precision_score,
    recall_score,
    f1_score,
)

from .config import (
    DEFAULT_RULE_THRESHOLD,
    GATE_RECALL_TOLERANCE_PP,
    SIF_POSITIVE,
    TIERS,
    TIER_INDEX,
)
from .registry import champion_metrics, active_version


def fbeta(p: float, r: float, beta: float = 2.0) -> float:
    if p + r == 0:
        return 0.0
    return (1 + beta**2) * p * r / (beta**2 * p + r)


def per_class_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    out = {}
    labels = list(range(len(TIERS)))
    p = precision_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    r = recall_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    f = f1_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    for i, t in enumerate(TIERS):
        out[t] = {"precision": round(float(p[i]), 4), "recall": round(float(r[i]), 4),
                  "f1": round(float(f[i]), 4),
                  "support": int((y_true == i).sum())}
    return out


def sif_positive_metrics(y_true: np.ndarray, probs: np.ndarray) -> dict:
    """Collapse psif+asif into one positive class; report recall/precision/F2.

    Two operating points, both reported (safety story needs the honest pair):
      * argmax-based  — what the deployed classifier actually flags (tier == psif/asif)
      * prob-mass     — flags when P(psif)+P(asif) >= 0.5, the over-flag posture
                        preferred for SIF screening (accept FPs, never miss a precursor)
    """
    sif_idx = [TIER_INDEX[t] for t in SIF_POSITIVE]
    y_bin = np.isin(y_true, sif_idx).astype(int)
    p_bin = probs[:, sif_idx].sum(axis=1)
    y_pred = np.isin(probs.argmax(axis=1), sif_idx).astype(int)
    p = precision_score(y_bin, y_pred, zero_division=0)
    r = recall_score(y_bin, y_pred, zero_division=0)
    ap = average_precision_score(y_bin, p_bin) if y_bin.sum() > 0 else None
    y_prob = (p_bin >= 0.5).astype(int)
    return {"precision": round(float(p), 4), "recall": round(float(r), 4),
            "f2": round(fbeta(float(p), float(r), beta=2.0), 4),
            "average_precision": round(float(ap), 4) if ap is not None else None,
            "positive_support": int(y_bin.sum()),
            "recall_prob_mass": round(float(recall_score(y_bin, y_prob, zero_division=0)), 4),
            "precision_prob_mass": round(float(precision_score(y_bin, y_prob, zero_division=0)), 4)}


def threshold_sweep(y_true: np.ndarray, probs: np.ndarray,
                    thresholds: np.ndarray | None = None) -> list[dict]:
    """Sweep the review threshold (max-prob cutoff): below it a row goes to the
    human queue. Report coverage (auto-accepted %) vs SIF-recall at each cut."""
    sif_idx = {TIER_INDEX[t] for t in SIF_POSITIVE}
    thresholds = thresholds if thresholds is not None else np.arange(0.30, 0.96, 0.02)
    rows = []
    for thr in thresholds:
        conf = probs.max(axis=1)
        auto = conf >= thr
        y_pred = probs.argmax(axis=1)
        sif_mask = np.isin(y_true, list(sif_idx))
        rec = (auto & sif_mask & (y_pred == y_true)).sum() / max(sif_mask.sum(), 1)
        rows.append({"threshold": round(float(thr), 2),
                     "coverage": round(float(auto.mean()), 4),
                     "sif_recall_auto": round(float(rec), 4)})
    return rows


def evaluate_matrix(y_true: np.ndarray, probs: np.ndarray) -> dict:
    y_pred = probs.argmax(axis=1)
    return {
        "n": int(len(y_true)),
        "accuracy": round(float((y_pred == y_true).mean()), 4),
        "macro_f1": round(float(f1_score(y_true, y_pred, average="macro", zero_division=0)), 4),
        "per_class": per_class_metrics(y_true, y_pred),
        "sif_positive": sif_positive_metrics(y_true, probs),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=list(range(len(TIERS)))).tolist(),
    }


# ---------------------------------------------------------------------------
# The regression gate
# ---------------------------------------------------------------------------

def gate_decision(challenger: dict, champion: dict | None) -> tuple[bool, str, float, float | None]:
    """Returns (promote, reason, challenger_sif_recall, delta_pp)."""
    sif_r = challenger["sif_positive"]["recall"]
    if champion is None:
        return True, "first model — no champion to beat", sif_r, None
    ch_r = champion["sif_positive"]["recall"]
    delta_pp = (sif_r - ch_r) * 100.0
    if sif_r * 100.0 >= ch_r * 100.0 - GATE_RECALL_TOLERANCE_PP:
        return True, (f"SIF recall {sif_r:.3f} within tolerance of champion {ch_r:.3f} "
                      f"(delta {delta_pp:+.2f}pp >= -{GATE_RECALL_TOLERANCE_PP}pp)"), sif_r, delta_pp
    return False, (f"REJECTED: SIF recall dropped {abs(delta_pp):.2f}pp below champion "
                   f"({sif_r:.3f} vs {ch_r:.3f}); tolerance {GATE_RECALL_TOLERANCE_PP}pp"), sif_r, delta_pp


def load_eval_set(path: Path, probs_path: Path) -> tuple[np.ndarray, np.ndarray]:
    gold = {r["id"]: r["tier"] for r in csv.DictReader(open(path, encoding="utf-8"))}
    preds = json.loads(Path(probs_path).read_text(encoding="utf-8"))
    ids, y, probs = [], [], []
    for pid, p in preds.items():
        if pid in gold:
            ids.append(pid)
            y.append(TIER_INDEX[gold[pid]])
            probs.append([p[t] for t in TIERS])
    return np.asarray(y), np.asarray(probs, dtype=np.float64)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gold", required=True, help="regression-set CSV (id,text,tier)")
    ap.add_argument("--probs", required=True, help="JSON {id: {tier: prob}} from inference")
    ap.add_argument("--out", default=None, help="metrics JSON output")
    ap.add_argument("--gate", action="store_true", help="print gate decision vs champion")
    args = ap.parse_args()
    y, probs = load_eval_set(Path(args.gold), Path(args.probs))
    report = evaluate_matrix(y, probs)
    report["threshold_sweep"] = threshold_sweep(y, probs)
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.gate:
        ch = champion_metrics()
        promote, reason, sif_r, delta = gate_decision(report, ch)
        print(json.dumps({"promoted": promote, "reason": reason,
                          "challenger_sif_recall": sif_r,
                          "champion_version": active_version(),
                          "delta_pp": delta}, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
