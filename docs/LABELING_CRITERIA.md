# AnvayaX — Labeling Criteria (EEI SCL + ASTM E2920-26)

> **Owner: the human.** Per PRD §7, this document and all hand-labeling are done by the team, not delegated to the model. The generator scripts *propose* tiers for synthetic data; annotators *confirm or correct* against these criteria. Two annotators work independently on the 150-row overlap subset before reconciling.

## Tier definitions (ASTM E2920-26 — 4 classes)

| Tier | Name | Decision rule |
|---|---|---|
| `asif` | Actual SIF | A serious injury or fatality **occurred**: death, permanently disabling injury, lost-time injury ≥ 1 day from a high-energy event, or an injury requiring surgery/hospital admission from such an event. |
| `psif` | Potential SIF | **No serious injury occurred, but a credible energy release could have caused one.** Ask: "Given 10cm, 10 seconds, or one PPE item differently, would this have been a fatality/life-altering injury?" If yes → psif. |
| `recordable` | Recordable injury | Injury/illness requiring treatment beyond first aid (OSHA-style recordable) but **not** arising from a high-energy event and not life-altering. |
| `near_miss` | Near miss / UA-UC | Unsafe act or condition observed, or a miss with **no credible path to a serious injury** given the energy involved (e.g., manual-handling awkward posture with no load dropped). |

## The two-question test for psif vs near_miss

1. **Energy test (EEI SCL):** was a stored or hazardous energy source present at an uncontrolled or inadequately-controlled level? (gravitational, pressure, thermal, chemical, electrical, kinetic, radiation)
2. **Safeguard test:** was a barrier/safeguard **absent, defeated, or failed** at the moment of exposure?

`psif` = (credible high-energy path) AND (barrier gap). A high-energy event with all barriers intact that still caused no harm → `near_miss` with a barrier-failure precursor tag if something was *attempted* to be bypassed.

## Worked examples (add more as the team labels)

| Report (excerpt) | Tier | Why |
|---|---|---|
| "Gauge glass of boiler ruptured during hydro test; operator in blast zone suffered lacerations requiring 12 stitches." | `asif` | Serious injury from stored pressure energy. |
| "Scaffold plank at 12m found with missing clip; worker had stood on it 20 min before it shifted." | `psif` | Gravitational energy + failed fall-protection barrier; credible fatality path, no injury. |
| "Driver exceeded 60 km/h gate speed on lease road; no contact." | `psif` if heavy vehicle/tanker, else `near_miss` | Kinetic energy magnitude decides; Driving Safety rule tag either way. |
| "Nurse-administered: employee reported headache after solvent smell; first aid only." | `recordable` | Health effect beyond first-aid? No → near_miss; medical treatment → recordable. |
| "Observed contractor not wearing safety glasses while grinding at workshop." | `near_miss` | Eye hazard real but not life-altering; barrier gap tagged (PPE) without psif tier. |

## Multi-label IOGP Life-Saving Rule tags

Tag every rule whose *behavior* the report implicates (max relevant, not max applicable). If the rule-relevant act was **bypassed/failed**, tag it; if merely in context, don't. Rules: Bypassing Safety Controls · Confined Space · Driving Safety · Energy Isolation · Hot Work · Line of Fire · Safe Mechanical Lifting · Working at Height · Controlled Substances.

## Precursor fields (for extraction QA)

- **activity** — the task being performed (welding, line-breaking, lifting, entry, driving…)
- **location** — where (tank farm, scaffold, confined vessel, lease road…)
- **barrier_failure** — what safeguard was missing/defeated/failed (PTW absent, LOTO skipped, clip missing, gas test not done…)
- **energy_source** — what stored/hazardous energy was present (pressure, height, heat, chemical, kinetic, electrical)

## Annotator protocol

1. Read the narrative cold; decide tier **before** looking at model suggestions (where present).
2. Apply the two-question test for any psif/near_miss borderline.
3. Record a confidence (high/med/low). Low-confidence and inter-annotator disagreements go to reconciliation, then to the Review Queue — never silently averaged.
4. Disagreements are exported to `labeling/disagreement.csv`, excluded from training, and reported with Cohen's κ and n.
