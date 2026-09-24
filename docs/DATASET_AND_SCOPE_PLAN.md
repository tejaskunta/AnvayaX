# Dataset & Scope Plan — Addendum to the AnvayaX PRD

> SIH26165 · Oil India Limited (OIL) — working addendum.
> *This file reconstructs the addendum discussed during planning from the agreed section structure. Where the original pasted wording is not preserved, content follows the decisions confirmed in planning. The PRD (`docs/PRD.md`) is the verbatim companion document.*

## 1. Dataset construction — mapped to the four red flags

A public, oil-&-gas-specific, SIF-labeled incident corpus does not exist. Anyone claiming to have trained on "real OIL data" at hackathon stage is bluffing. We address this head-on with a three-layer domain-transfer strategy and honest labeling:

**Red flag 1 — no training data exists → three-layer domain transfer.**

| Layer | Source | Role | In demo DB? |
|---|---|---|---|
| L1 | Public OSHA construction-accident narratives (~16k; ~1,000 sampled) | Pipeline validation + embedding exposure only. Construction vocabulary is *not* oil & gas vocabulary. | **No** — never seeded into the demo database, never SIF-labeled by us |
| L2 | Hand-curated IOGP / PSA / regulator alerts and bulletins (~200) | Domain register without labels — model-predicted tier only, clearly marked | Yes, `source_layer=l2_domain`, no gold labels |
| L3 | LLM-generated synthetic UA/UC observations (Groq `llama-3.3-70b-versatile`), template-seeded per scenario | Gold-labeled training/eval set; every row carries `is_synthetic=true` + `data/PROVENANCE.json` | Yes, ~550 rows (~450 gold-labeled, ~150 double-annotated) |

Total demo volume: **750 reports**, SIF-potential share ≈ 20–25% to match the PRD's stated real-world rate.

**Red flag 2 — single-annotator labels are noisy → two-annotator overlap + Cohen's kappa.**
150 of the L3 rows are double-annotated against `docs/LABELING_CRITERIA.md`. We report Cohen's κ with n stated, export disagreements (`labeling/disagreement.csv`), exclude them from training, and route them into the Review Queue — which doubles as the uncertainty-handling story: disagreement → human-in-the-loop → training signal.

**Red flag 3 — severe class imbalance → stratified splits + class-weighted (or focal) loss.**
Stratified 70/15/15 train/val/test preserves tier ratios; `compute_class_weight` feeds weighted CrossEntropy; focal loss is a flagged escalation if validation SIF-recall < 0.85. We never report a single accuracy number as "the" metric.

**Red flag 4 — accuracy is the wrong headline → recall ≥ 0.85 target on pSIF/aSIF, F2, and threshold tuning.**
Headline metric: SIF-potential (pSIF+aSIF) recall on held-out data, target ≥ 0.85, reported honestly at whatever it actually is. Supporting: per-class P/R/F1, **F2** for SIF-positive classes (false negatives cost more than false positives in this domain), PR curves, and a documented threshold sweep showing the flag threshold is deliberately lowered for psif/asif.

## 2. Prototype scope — seven screens

1. **Upload / Ingest** — CSV/XLSX/JSON batch ingest.
2. **Live Sandbox** — free-text classification with rule-trace highlighting + similar past incidents.
3. **Site Risk Heatmap** — precursor density per site, absolute vs rate-of-change ranking.
4. **Drill-Down** — worst site → rule → activity → missing safeguard in ≤2 clicks.
5. **Report Feed** — filterable table, tier colors, synthetic badges visible.
6. **Review Queue** — human-in-the-loop accept/correct, ordered by acquisition score.
7. **Model Insight** — metrics, kappa, threshold rationale, PR curve, and the model-registry trajectory proving continual learning.

## 3. Integration story — vendor-agnostic by design

We do not guess OIL's HSSE vendor. The ingest surface is deliberately generic:

- **Batch:** CSV/Excel upload matching any export with a free-text narrative column (column mapping on upload).
- **API:** generic `POST /api/ingest` accepting JSON `{text, site, occurred_at, activity?}` rows.

Pitch line: *"We integrated with the format every HSSE platform can export — because guessing OIL's vendor before the data drop is guesswork, not engineering."*

## 4. Research edge (what we can defend under questioning)

1. **Named uncertainty design** — predictive entropy + embedding-space novelty produce an `acquisition_score` that orders the Review Queue; corrections are maximally informative per label (active learning, not "retrain sometimes").
2. **F2 over F1** for SIF-positive classes — cost-sensitive evaluation justified by injury severity asymmetry.
3. **κ reporting with n** — we publish inter-annotator agreement instead of hiding label noise.
4. **Continual learning with a regression gate** — champion/challenger on a frozen set; a refresh that drops SIF-recall >2pp is rejected. See `docs/CONTINUAL_LEARNING.md`.
5. **Vendor-agnostic framing** — integration incompleteness is a stated design boundary, not an oversight.

## 5. Risks & stated limitations

- All L3 data is **synthetic and labelled as such everywhere** (UI badge + PROVENANCE.json). Model performance on synthetic text is not a guarantee of performance on OIL's real corpus — the OSHA→IOGP→synthetic transfer is a bridge, not a substitute.
- Cohen's κ on a 150-row overlap is noisy; report it with n and confidence context.
- The flag threshold is a tunable hyperparameter; we show the sweep rather than pretending one number is sacred.
- Vendor integration is deliberately incomplete pending OIL's data-format drop.
