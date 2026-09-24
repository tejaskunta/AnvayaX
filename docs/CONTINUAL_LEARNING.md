# AnvayaX — Continual Learning Loop (the headline feature)

**One-line pitch:** *AnvayaX isn't a classifier with a dashboard bolted on — it's an active-learning loop with a safety dashboard as the interface. Every human correction in the Review Queue is a training signal; the regression gate guarantees the model can only get better; the model registry makes the improvement auditable.*

## 1. Why "retrain every N days" is hard — and the mitigation for each failure mode

| Failure mode | Naive approach | AnvayaX mitigation |
|---|---|---|
| **Catastrophic forgetting** — model overfits recent logs, silently regresses on old patterns | Fine-tune the previous adapter on new data only | **Replay:** every refresh retrains the *base* model (DistilBERT + fresh LoRA) on the **full accumulated corpus** (gold set + released corrections). Never incremental-from-adapter. |
| **Deploying a worse model** than the one it replaced | Promote whatever finished training last | **Frozen regression gate:** a held-out set that is *never* trained on. Champion vs challenger. A refresh is **rejected** if SIF-potential recall drops by more than 2 percentage points. Both outcomes are logged. |
| **Compute cost** on student hardware | Full fine-tune nightly | **LoRA adapters** (`peft`): a refresh is minutes on a free Colab/Kaggle T4; an adapter is a few MB; rollback = repointing a config file. |
| **Label scarcity** — humans can't review everything | Review queue ordered by timestamp | **Active learning:** the queue is ordered by `acquisition_score` (below), so each human correction buys the maximum information. The queue is the flywheel's intake valve. |

## 2. The loop, concretely

```
┌─────────────────────────────────────────────────────────────────┐
│  1. INGEST   new reports → POST /classify (champion vK)          │
│                     │                                            │
│  2. TRIAGE   low-confidence / high-uncertainty → Review Queue    │
│              (ordered by acquisition_score, DESC)                │
│                     │                                            │
│  3. CORRECT  human Accept / Correct-to → `corrections` table     │
│              (report_id, original_tag, corrected_tag,            │
│               corrected_by, released_to_pool)                    │
│                     │                                            │
│  4. REFRESH  every REFRESH_INTERVAL_DAYS (default 7) or on-      │
│              demand button → scripts/refresh.ts                  │
│              exports pool → POST /train                          │
│                     │                                            │
│  5. RETRAIN  LoRA fine-tune FROM BASE on full pool → challenger  │
│              vK+1                                                │
│                     │                                            │
│  6. GATE     eval vK+1 vs vK on frozen regression set            │
│              PASS (recall drop ≤ 2pp) → promote                  │
│              REJECT → keep vK, log rejection                     │
│                     │                                            │
│  7. REGISTER model_registry row; model_config.json repoints      │
│              active_version; rollback = repoint to prior row     │
└─────────────────────────────────────────────────────────────────┘
```

**Refresh trigger:** the button on the Model Insight screen + `npx tsx scripts/refresh.ts`, with a documented cron line (`0 3 * * 1` — Mondays, off-demo-hours). Deliberately **not** an always-on daemon: demo determinism beats background realism, and the cron documentation shows the production path.

## 3. Acquisition score (Review Queue ordering)

For report *x* with tier probabilities *p* from the champion model and MiniLM embedding *e(x)*:

$$\text{acquisition\_score}(x) = \alpha \cdot \underbrace{\frac{-\sum_i p_i \log p_i}{\log 4}}_{\text{normalised predictive entropy}} + (1-\alpha) \cdot \underbrace{\frac{1}{k}\sum_{y \in \text{NN}_k(x)} \left(1 - \cos(e(x), e(y))\right)}_{\text{embedding-space novelty vs labelled exemplars}}$$

with α = 0.5 and k = 5 (defaults, reported in the pitch). Entropy alone finds *confusing* reports; novelty alone finds *unseen* reports; the sum finds reports that are **both confusing and unlike anything the model has learned** — exactly where one human label is worth the most.

## 4. The honest live demo of learning (the money shot)

1. **v1** is trained on only **60%** of the gold-labeled set. The other **40% is held out** — never seen, and the Review Queue is seeded with rows from it.
2. During the demo: judge-typed reports flow through; corrections are accepted in the Review Queue, which **releases held-out rows into the training pool** (`released_to_pool = true`).
3. Click **Run refresh**. `POST /train` retrains from base on the grown pool → challenger **v2** → evaluated on the frozen regression set → gate PASS → promoted.
4. Model Insight shows **v1 → v2 SIF-recall genuinely improving** on data v1 never trained on.

No fakery: the improvement is real, only the *timing* is scripted. Fully defensible under judge questioning — and the gate/registry rows are the audit trail.

## 5. What we will NOT claim

- We do not claim the model learns from *unlabeled* logs alone — corrections are the labels; that's why the human is in the loop.
- We do not claim nightly production-grade MLOps — this is a hackathon-scale implementation of the *control pattern* (gate, registry, replay), honest about scale.
- We do not claim improvement is guaranteed — the gate exists precisely because sometimes a refresh should be rejected. (A rejected refresh is the feature working, not failing.)
