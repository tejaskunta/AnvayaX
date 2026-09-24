"""Bootstrap the registry with the v1 champion (run once, after training v1).

  python -m scripts.bootstrap_v1

Evaluates model_registry/v1 on the frozen regression set, registers it with
gate_result="initial" and promotes it (writes model_config.json active_version).
Idempotent: skips if v1 is already registered."""
from __future__ import annotations

import csv

import numpy as np

from model import config as C
from model.classifier_infer import predict_probs_from_dir
from model.eval import evaluate_matrix, threshold_sweep
from model.registry import active_version, load_registry, promote, register_version


def main():
    reg = load_registry()
    version = "v1"
    if any(r["version"] == version for r in reg):
        print(f"[bootstrap] {version} already registered; active={active_version()}")
        return
    adapter = C.REGISTRY_DIR / version
    if not adapter.exists():
        raise SystemExit(f"[bootstrap] missing {adapter} — train v1 first "
                         "(python -m model.classifier_train --train labeling/splits.json)")

    reg_set = C.LABELING_DIR / "regression_set.csv"
    rows = list(csv.DictReader(open(reg_set, encoding="utf-8")))
    texts = [r["text"] for r in rows]
    y = np.asarray([C.TIER_INDEX[r["tier"]] for r in rows])
    probs = predict_probs_from_dir(texts, adapter)
    report = evaluate_matrix(y, probs)
    report["threshold_sweep"] = threshold_sweep(y, probs)

    import json

    meta = json.loads((adapter / "train_meta.json").read_text(encoding="utf-8"))
    register_version(version, metrics=report, gate_result="initial",
                     champion_version=None, trained_on_rows=meta["pool_rows"],
                     note=f"v1: LoRA on {meta['pool_rows']}-row gold pool "
                          "(60%, disagreements quarantined)")
    promote(version)
    print(f"[bootstrap] {version} registered + promoted; "
          f"frozen-set SIF recall={report['sif_positive']['recall']:.3f} "
          f"accuracy={report['accuracy']:.3f}")


if __name__ == "__main__":
    main()
