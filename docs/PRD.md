# PRD — Final — SIF Sentinel

**AI/NLP Engine to Detect Serious Injury & Fatality (SIF) Precursors**
SIH26165 · Oil India Limited (OIL)

> Note: This is the consolidated, final version — merges the product PRD and technical stack. Frontend is React/TypeScript; database is SQLite (reverted from Neon) via Drizzle ORM, keeping the typed-query benefit without the cloud-availability risk at demo time.
>
> *Committed verbatim as a background spec. The implemented product name is **AnvayaX**; "SIF Sentinel" in this document refers to the original product concept.*

## 1. Product Overview

OIL's HSSE platform collects UA/UC observations, near-miss, and incident reports, triaged manually on fixed intervals. Only ~20–25% of reports carry genuine fatal potential; the rest are routine. SIF Sentinel ingests free-text reports and:

a. Classifies each into an SIF severity tier (not a binary — see Section 3)
b. Tags each to the relevant IOGP Life-Saving Rule (multi-label)
c. Surfaces recurring precursor patterns (activity, location, barrier failure) via a dashboard ranking sites/activities by SIF-precursor density.

## 2. Prior Art & Grounding

| Source | What it gives us |
|---|---|
| Tixier, Hallowell, Rajagopalan & Bowman (2016), *Automation in Construction* 62:45–56 | Rule/dictionary NLP extracting 100+ safety attributes at >95% accuracy — the hybrid, explainable design pattern we follow |
| Baker, Hallowell & Tixier (2020), arXiv:1907.11769 | Deep-learning follow-up — justifies layering a transformer on top of the rule layer |
| EEI Safety Classification and Learning (SCL) Model, built on Hallowell's Energy Theory | Labeling logic: energy source + safeguard presence/failure, not just severity outcome |
| ASTM E2920-26 (Jan 2026) + E3529-26 | Current severity tiers (aSIF/pSIF/recordable/near-miss) and an identify→prioritize→reduce workflow — replaces a binary SIF/non-SIF split |
| IOGP Report 459 (2018 revision) | The fixed 9-rule tagging taxonomy: Bypassing Safety Controls, Confined Space, Driving Safety, Energy Isolation, Hot Work, Line of Fire, Safe Mechanical Lifting, Working at Height, Controlled Substances |
| CompScience "SIF Signal" (commercial product) | Closest real competitor — classifies uploaded structured data against ASTM E2920-26. We differentiate: raw free text at point of submission, tagged to oil & gas-specific IOGP rules |

## 3. Model Architecture (unchanged — Python/ML side)

```
Free-text report
│
▼
Rule/dictionary layer (explainable, auditable)
— IOGP Life-Saving Rule keyword/phrase matching (multi-label)
— Energy-source / barrier-status cues (EEI SCL concepts)
│
▼
Transformer classifier (DistilBERT-base, fine-tuned)
— aSIF / pSIF / recordable / near-miss tiering (ASTM E2920-26)
— Class-weighted or focal loss for the pSIF/aSIF minority
│
▼
Precursor extraction (spaCy NER + clustering: activity, location, barrier failure)
│
▼
Aggregation → site/activity precursor-density + trend dashboard
```

**Primary metric: recall on pSIF/aSIF classes, stated explicitly over raw accuracy.**

**Dataset strategy:** pretrain/validate the pipeline on public OSHA construction-accident narratives (~16,000 records) since no oil & gas-specific labeled corpus is public; write labeling criteria against the EEI SCL Model and ASTM E2920-26 tiers before hand-labeling a small oil & gas-flavored set; treat OIL's real data (if released) as the fine-tuning/validation set, not the from-scratch training set.

## 4. Feature List

**Core (from the problem statement):** SIF severity classifier · IOGP Life-Saving Rule multi-label tagger · precursor pattern mining by activity/location/barrier · dashboard with risk heatmap, drill-down, and live text sandbox.

**Differentiators:** aSIF/pSIF/recordable/near-miss tiering per the current ASTM standard · rule-trace explainability (exact trigger phrases shown) · escalating-risk detection (rank by rate of change in density, not just absolute value) · barrier/safeguard tagging · human-in-the-loop correction logged for retraining · code-mixed English/Hindi handling (stretch goal) · similar-past-incidents retrieval in the sandbox.

## 5. Success Metrics

- **Demo:** sandbox correctly classifies 4–5 varied judge-typed inputs across all four tiers, including a clear non-SIF case.
- **Model:** recall ≥ 0.85 on pSIF/aSIF classes on held-out data; precision reported honestly.
- **Dashboard:** two clicks from "worst site" to "specific rule, specific activity, specific missing safeguard."

## 6. Updated Technical Stack

| Layer | Technology |
|---|---|
| ML/NLP service | Python, HuggingFace Transformers (DistilBERT-base), spaCy, scikit-learn |
| Rule/tagging layer | Python regex + spaCy Matcher / EntityRuler |
| ML inference API | FastAPI + Uvicorn, Pydantic |
| Web frontend | React + TypeScript (.tsx), built with Vite or Next.js |
| Web/API layer | Next.js API routes (TypeScript), or a thin Node/Express layer if you'd rather keep Next.js purely as frontend |
| Database | SQLite via Drizzle ORM (`drizzle-orm/better-sqlite3`) |
| Charts | Chart.js or Recharts (React-native charting, pairs naturally with TSX components) |
| Dev tooling | Git/GitHub, pytest (Python side), Vitest or Jest (TS side) |
| Training compute | Google Colab / Kaggle (free T4 GPU tier) |

**Why this split**

**Two languages, two jobs:** Python owns ML (HuggingFace/spaCy don't have a good TypeScript equivalent — don't fight that). TypeScript owns the web app and data layer — React/TSX is the right call for a dashboard with real interactive state (site selection, drill-down, live sandbox results). SQLite keeps the database a single local file: no server process to keep alive, no network dependency, nothing to configure on demo day.

The Next.js backend calls the Python FastAPI service over HTTP for classification (`POST /classify`) and precursor extraction — it doesn't reimplement any ML logic in TypeScript.

**Drizzle + SQLite specifics**

- `drizzle-orm` with the `better-sqlite3` driver (`drizzle-orm/better-sqlite3`) — synchronous, fast, and it's just a `.db` file in the repo.
- Core tables: `reports` (raw text, tier, confidence, rule_tags, timestamp, site), `sites` (name, current density, trend), `corrections` (report_id, original_tag, corrected_tag, corrected_by) — this last table is what makes the human-in-the-loop feature (Section 4) real instead of just a PRD line.
- Define schema in `drizzle/schema.ts`, generate migrations with `drizzle-kit`, apply with `drizzle-kit push` — same workflow as any other Drizzle setup, just a different driver.

This sidesteps the offline-demo risk entirely: no internet dependency, no venue-wifi contingency needed for the database layer. If you later want a public-facing hosted version outside the hackathon, swapping to a hosted Postgres (Neon or otherwise) later is a driver change, not a rewrite, since the schema and queries stay the same.

**Repo structure (updated)**

```
/ml-service — Python
  /data (raw, processed)
  /labeling (criteria.md, labeled_set.csv)
  /model
    rule_tagger.py
    classifier_train.py
    classifier_infer.py
    precursor_extract.py
  /api
    main.py — FastAPI, /classify, /extract-precursors
  /tests
/web — TypeScript
  /app — Next.js App Router pages (.tsx)
  /components — React components (SiteHeatmap.tsx, DrillDown.tsx, Sandbox.tsx)
  /db
    schema.ts — Drizzle schema
    client.ts — SQLite connection (better-sqlite3)
    sqlite.db — local database file
  /app/api — Next.js route handlers calling the FastAPI service
README.md
```

**Coding agent brief (updated)**

1. **Python side:** unchanged from the earlier brief — data cleaning, `rule_tagger.py`, `classifier_train.py`, `classifier_infer.py`, `precursor_extract.py`, FastAPI endpoints.
2. **TypeScript side:**
   - Set up Next.js with TypeScript, Drizzle schema for `reports` / `sites` / `corrections`, `better-sqlite3` driver.
   - Build `.tsx` components matching the existing dark-industrial visual style: `SiteHeatmap`, `DrillDown`, `LiveSandbox`.
   - Build Next.js API route handlers that call the Python `/classify` endpoint and write results to SQLite via Drizzle.
   - Wire the human-in-the-loop correction UI to the `corrections` table.
3. **Both sides:** write a README section covering setup from scratch (`npm install`, `drizzle-kit push` to initialize the SQLite file, `pip install -r requirements.txt` for the ML service).

**Acceptance criteria:** dashboard renders live from SQLite via Drizzle, not hardcoded arrays; `/classify` results are persisted, not just displayed and discarded; a teammate who didn't write the code can run the whole thing from a clean clone following only the README.

## 7. Ownership Split (unchanged principle, updated scope)

**Do yourself:** labeling criteria, hand-labeling, the hybrid-architecture and recall-over-accuracy reasoning, reading the cited papers/standards yourself, and the pitch narrative.

**Delegate, then review line-by-line:** all scaffolding in both the Python and TypeScript repos, the Drizzle schema/migration boilerplate, the React component implementation, FastAPI endpoint wiring.

## 8. Demo & Presentation Requirements

1. A working demo running live on a laptop during judging — SQLite means no network dependency to plan around for the database layer.
2. Screenshots of each dashboard state (heatmap, drill-down, sandbox result) in the PPT as a static fallback.
3. A 30–60 second screen recording of the sandbox flow (type → analyze → tiered verdict appears).
4. One slide naming the prior-art grounding explicitly — Tixier & Hallowell, ASTM E2920-26, IOGP 459.

## 9. Risks / Open Questions

- Actual OIL data volume/format unknown until the SIH data drop is confirmed.
- Borderline pSIF/near-miss cases are hard even for trained human safety panels — acknowledge this rather than overclaim accuracy.
- Multi-label rule tagging risks over-tagging — use a confidence threshold, not top-k.
- Code-mixed language handling is a stretch goal — don't let it block the core deliverable.

## 10. References

- Tixier, A.J.-P., Hallowell, M.R., Rajagopalan, B., Bowman, D. (2016). *Automation in Construction*, 62, 45–56.
- Baker, H., Hallowell, M.R., Tixier, A.J.-P. (2020). arXiv:1907.11769.
- EEI, *Safety Classification and Learning Model* — eei.org/en/issues-and-policy/power-to-prevent-sif
- ASTM E2920-26 — store.astm.org/e2920-26.html
- IOGP Report 459, *Life-Saving Rules* — iogp.org/workstreams/safety/safety/life-saving-rules
- CompScience SIF Signal, referenced via nsc.org/workplace/sif-prevention-model
