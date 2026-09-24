# AnvayaX — Training Runbook (Colab / Kaggle T4 + local CPU)

The demo ships with a trained adapter, but you may need to retrain (e.g., after the
continual-learning demo or when the real OIL data drop arrives). Two paths:

## Path 1 — Local CPU (M-series laptop, slow but fine for ≤1k rows)

```bash
cd ml-service
source .venv/bin/activate
python -m model.classifier_train \
    --train labeling/splits.json --pool labeling/labeled_set.csv \
    --include-corrections ../web/db/sqlite.db \
    --epochs 4 --batch-size 16 --lr 2e-4 --seed 42
python -m model.eval --version vK   # writes model_registry/vK/metrics.json
```

CPU training on ~270 rows (60% of gold) with LoRA takes ~5–10 min. Expected.

## Path 2 — Kaggle / Colab free T4 GPU (recommended for v2+)

1. Upload (or `git clone`) the `ml-service/` folder.
2. Notebook:
   ```bash
   pip install -r requirements.txt
   python -m model.classifier_train --device cuda \
       --train labeling/splits.json --pool labeling/labeled_set.csv \
       --epochs 6 --batch-size 32 --lr 2e-4
   python -m model.eval --version vK
   ```
3. Download `model_registry/vK/` (adapter `adapter_model.safetensors` + `tokenizer*` +
   `metrics.json` + `model_config.json`) and drop it into `ml-service/model_registry/vK/`
   locally. Restart the FastAPI service — `/model-info` shows the new active version.

## The 60/40 demo split (do not lose this)

`data/splits.py --demo-holdout 0.4` produces:
- `labeling/splits.json` → **v1 trains on 60% only**
- `labeling/heldout_pool.csv` → the 40%, released into the training pool *only* via
  Review-Queue corrections during the demo (`corrections.released_to_pool = true`)
- `labeling/regression_set.csv` → frozen set, never trained on, used by the gate

## Refresh = retrain + gate + register (one command, from `web/`)

```bash
cd web && npx tsx scripts/refresh.ts
```

It exports the pool (gold ∪ released corrections), calls `POST /train`, and the
Python side runs from-base LoRA training → challenger eval on the frozen set →
**promote only if SIF-recall didn't drop > 2pp** → `model_registry` row either way.

## Focal-loss escalation

If `model_registry/vK/metrics.json` shows val SIF-recall < 0.85 with the default
class-weighted CE, retrain once with `--loss focal` (γ=2, λ tuned on val). The flag
lives in `model/losses.py`; rationale in `docs/DATASET_AND_SCOPE_PLAN.md` §1 red flag 3.
