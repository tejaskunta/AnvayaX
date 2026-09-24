# AnvayaX

**AI/NLP engine that detects Serious Injury & Fatality (SIF) precursors in free-text HSSE incident reports** — Smart India Hackathon 2026, problem statement **SIH26165 · Oil India Limited**.

AnvayaX reads raw, unstructured safety narratives (UA/UC observations, near-miss and incident reports) and, for each one:

1. **Classifies** it into an ASTM E2920-26 severity tier — `aSIF` / `pSIF` / `recordable` / `near-miss` — plus a continuous `severity_index` (25–100) for ranking.
2. **Tags** the IOGP Report 459 Life-Saving Rules it implicates, with the exact trigger phrases highlighted (rule-trace explainability).
3. **Extracts** precursor patterns — activity, location, barrier failure, energy source — and aggregates them into a site-risk heatmap with rate-of-change ("escalating risk") ranking.
4. **Learns continuously** — a human-in-the-loop Review Queue ordered by an active-learning acquisition score feeds a scheduled refresh cycle: LoRA retrain from base on the full accumulated corpus → challenger evaluated on a frozen regression set → promoted **only** if SIF-recall holds. The Model Insight screen shows the v1→v2 improvement trajectory live. This is the headline feature ([spec](docs/CONTINUAL_LEARNING.md)).

> **Data honesty:** the demo dataset is **synthetic** (Groq-generated, template-seeded per oil & gas scenario), clearly badged in the UI and recorded in `ml-service/data/PROVENANCE.json`. No public oil-&-gas SIF-labeled corpus exists; the three-layer construction (OSHA → IOGP/PSA domain → synthetic) is documented in [docs/DATASET_AND_SCOPE_PLAN.md](docs/DATASET_AND_SCOPE_PLAN.md).

## Architecture

```
┌────────────────────────────┐  HTTP   ┌─────────────────────────────┐
│  web/  Next.js 14 (TS)     │ ──────► │  ml-service/  FastAPI (Py)  │
│  · 7 screens (dashboard)   │         │  · rule/dictionary layer    │
│  · /api route handlers     │ ◄────── │  · DistilBERT + LoRA (peft) │
│  · Drizzle + better-sqlite3│  JSON   │  · spaCy precursor extract  │
│  · db/sqlite.db (one file) │         │  · /classify /train /info   │
└────────────────────────────┘         └─────────────────────────────┘
```

TypeScript owns the app + data layer; Python owns every ML decision. No ML logic is reimplemented in TS; the DB is owned solely by Drizzle (the ML service is stateless).

## Setup from a clean clone

Prereqs: **Node ≥ 20**, **Python 3.11–3.12** (3.14 is too new for PyTorch wheels), and a Groq API key only if you regenerate the synthetic dataset.

### 1. ML service

```bash
cd ml-service
uv venv .venv --python 3.12        # or: python3.12 -m venv .venv
source .venv/bin/activate
uv pip install -r requirements.txt # or: pip install -r requirements.txt
python -m spacy download en_core_web_sm
uvicorn api.main:app --port 8000   # keep running; /health to verify
```

A trained adapter ships in `model_registry/` — if it's missing, the service
automatically runs in `RULES_ONLY` fallback mode (heuristic tiers, `needs_review=true`)
so the demo never breaks.

### 2. Web app

```bash
cd web
npm install
npx drizzle-kit push               # creates db/sqlite.db
npm run seed                       # 750 demo reports through the ML pipeline
npm run dev                        # http://localhost:3000
```

`.env` at the repo root holds `GROQ_API_KEY` (gitignored). `web/.env.local` can
override `ML_SERVICE_URL` (default `http://127.0.0.1:8000`).

### 3. The refresh cycle (continual learning)

```bash
cd web && npx tsx scripts/refresh.ts    # or click "Run refresh" on Model Insight
```

Add to cron for production cadence: `0 3 * * 1 cd /path/to/AnvayaX/web && npx tsx scripts/refresh.ts` (Mondays 03:00; `REFRESH_INTERVAL_DAYS=7` is shown on the Model Insight screen and is deliberately **not** an always-on daemon during demos).

## Repository layout

```
ml-service/
  api/main.py            FastAPI: /classify /extract-precursors /model-info /train /health
  model/
    schema.py            ClassifyResult — the cross-language contract
    rule_tagger.py       IOGP 459 rules + energy/barrier cues (YAML packs, threshold-gated)
    classifier_train.py  DistilBERT + LoRA, from-base replay, class-weighted/focal loss
    classifier_infer.py  tier probs, severity_index, needs_review
    precursor_extract.py spaCy activity/location/barrier/energy extraction
    active_learn.py      acquisition_score = entropy + embedding novelty
    eval.py              per-class P/R/F1, F2, confusion, threshold sweep, regression gate
    registry.py          model_registry: versions, metrics, promote/reject, rollback
    losses.py, kappa.py, similarity.py
  data/                  l1_osha.py · l2_domain.py · l3_synthetic.py · PROVENANCE.json
  labeling/              labeled_set.csv · splits.json · disagreement.csv
  tests/                 pytest suite
web/
  app/                   7 screens (App Router)
  app/api/               route handlers → Drizzle (ingest, analyze, heatmap, queue, …)
  components/            SiteHeatmap · DrillDown · Sandbox · ReviewQueue · ModelInsight …
  db/schema.ts           reports · sites · corrections · batches · model_registry
  scripts/               seed.ts · refresh.ts · export_corrections.ts
docs/
  PRD.md                 verbatim product spec
  DATASET_AND_SCOPE_PLAN.md   dataset strategy + scope addendum
  CONTINUAL_LEARNING.md  the headline feature, fully specified
  LABELING_CRITERIA.md   EEI SCL / ASTM tier decision rules (human-owned)
notebooks/TRAINING.md    Colab/Kaggle T4 runbook
```

## Tests

```bash
cd ml-service && source .venv/bin/activate && pytest -q
cd web && npx vitest run
```

## Key references

Tixier & Hallowell (2016) · Baker, Hallowell & Tixier (2020, arXiv:1907.11769) · EEI SCL Model · ASTM E2920-26 / E3529-26 · IOGP Report 459. Full list in [docs/PRD.md](docs/PRD.md) §10.
