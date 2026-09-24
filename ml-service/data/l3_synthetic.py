"""L3 synthetic gold generator — Groq only (qwen/qwen3.8-27b generation,
openai/gpt-oss-20b independent second annotation — different families on purpose).

Three-layer dataset plan (docs/DATASET_AND_SCOPE_PLAN.md §1):
  L1 OSHA public narratives  -> embedding exposure / pipeline smoke only (never demo DB)
  L2 domain-style bulletins  -> model-predicted, no gold labels (l2_domain.py)
  L3 synthetic gold          -> THIS: training pool + frozen regression set

Annotation protocol (honest, documented):
  annotator_a = the planned tier the generator was told to write (model-assisted pass)
  annotator_b = INDEPENDENT second Groq pass that sees only the text (150-row subset)
  Cohen's kappa is measured between a and b; disagreements are quarantined to
  labeling/disagreement.csv and excluded from training gold (kappa.py).

Deterministic template fallback keeps the build working without a key/quota.
Outputs:
  labeling/labeled_set.csv       (id,text,tier,site,activity,occurred_at,...)
  labeling/double_annotated.csv  (id,text,annotator_a,annotator_b)
  data/PROVENANCE.json           {provider, model, prompt_hash, counts, tier_plan, ...}
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import time
from pathlib import Path

from model.config import DATA_DIR, LABELING_DIR, REPO_ROOT, SEED

GROQ_MODEL = "qwen/qwen3.8-27b"  # generator model (rich, realistic HSSE narratives)
ANNOTATOR_MODEL = "openai/gpt-oss-20b"  # independent 2nd annotator — different family on purpose,
                                        # so Cohen's kappa measures cross-model agreement, not self-agreement
BATCH = 10  # reports per Groq call

SITES = ["Duliajan", "Digboi", "Naharkatiya", "Moran", "Lumding Terminal",
         "Guwahati Depot", "Rangia", "Jorhat Bypass Road"]

# scenario -> (activity label, context hint for the prompt)
SCENARIOS = {
    "hot_work": ("Hot Work", "welding/cutting/grinding near hydrocarbons, tank/vessel/pipeline"),
    "confined_space": ("Vessel/Tank Entry", "entry into storage tanks, vessels, sumps, manholes"),
    "line_break": ("Line Break", "opening pressurised lines, blinds, flanges, gaskets"),
    "dropped_object": ("Lifting/Suspended Load", "crane lifts, scaffolds, tools at height"),
    "ptw_violation": ("Permit to Work", "permit skipped/expired/forged or gas test missing"),
    "lifting": ("Rigging/Lifting", "cranes, slings, shackles, tag lines, loads in motion"),
    "driving": ("Vehicle Movement", "lease roads, fatigue, speed, reversing, animals on road"),
    "energy_isolation": ("LOTO/Energy Isolation", "stored energy, residual pressure, unisolated equipment"),
    "height": ("Working at Height", "scaffolds, ladders, roofs, platforms above 1.8 m"),
    "substance": ("Controlled Substances", "impairment, alcohol/drugs before or during shift"),
}

TIERS = ["near_miss", "recordable", "psif", "asif"]

# ~550 rows, SIF-potential (psif+asif) = 125/550 = 22.7% (target 20-25%)
TIER_PLAN = {"near_miss": 220, "recordable": 205, "psif": 95, "asif": 30}

SYSTEM_PROMPT = (
    "You are an HSSE incident-report writer for an Indian upstream oil & gas company. "
    "You produce realistic, varied free-text incident narratives in the terse, partly "
    "ungrammatical style of real site reports (present/past tense mix, abbreviations "
    "like PTW, LOTO, H2S, SIF, TBT). 1-4 sentences each. No names, no invented numbers "
    "of casualties beyond what is asked, no markdown."
)

USER_TEMPLATE = (
    "Write {n} distinct incident narratives for site reports at an oil & gas company "
    "(sites: {sites}). Scenario family: {scenario} — {hint}. "
    "Severity tier for EVERY narrative (be faithful to it): {tier}.\n"
    "Tier meanings: near_miss = no injury, unplanned event with clear potential; "
    "recordable = injury requiring medical treatment beyond first aid, not life-threatening; "
    "psif = POTENTIALLY serious injury/fatality — the event COULD have caused death, "
    "amputation, or life-changing injury (high energy released, worker exposed, safeguard "
    "absent) even if nobody was hurt; asif = ACTUAL serious injury/fatality (death, "
    "fracture, hospitalisation).\n"
    "Vary phrasing, shift, weather, contractor vs employee, time of day. "
    'Return ONLY a JSON array: [{{"text": "...", "site": "one of the sites"}}]. '
    "Do not number or comment."
)

LABEL_TEMPLATE = (
    "Classify each HSSE narrative into exactly one ASTM tier: near_miss, recordable, "
    "psif (potentially serious injury/fatality - could have killed/seriously hurt someone), "
    "asif (actual serious injury or fatality). "
    'Return ONLY a JSON array: [{{"id": "...", "tier": "..."}}].\n'
    "Items:\n{items}"
)


def _prompt_hash() -> str:
    h = hashlib.sha256()
    h.update(SYSTEM_PROMPT.encode())
    h.update(USER_TEMPLATE.encode())
    h.update(json.dumps(TIER_PLAN, sort_keys=True).encode())
    return h.hexdigest()[:16]


def _extract_json(text: str):
    """Grab the first JSON array from a model response (tolerate fences/preambles)."""
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        raise ValueError(f"no JSON array in response: {text[:120]!r}")
    return json.loads(m.group(0))


def _groq_client():
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        # also try root .env
        env = REPO_ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("GROQ_API_KEY="):
                    key = line.split("=", 1)[1].strip()
    if not key:
        return None
    from groq import Groq

    return Groq(api_key=key)


def _groq_batch(client, user_msg: str, retries: int = 3, model: str = GROQ_MODEL) -> list[dict]:
    last = None
    for attempt in range(retries):
        try:
            r = client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": SYSTEM_PROMPT},
                          {"role": "user", "content": user_msg}],
                temperature=0.9, max_tokens=1600,
            )
            return _extract_json(r.choices[0].message.content)
        except Exception as exc:  # rate limit / transient
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"groq call failed after retries: {last}")


# ---------------------------------------------------------------------------
# Deterministic template fallback (no key / quota exhausted)
# ---------------------------------------------------------------------------

FALLBACK_TEMPLATES = {
    "near_miss": [
        "During {act} at {site}, a {cue} occurred near the work area. No one was hurt. "
        "Work was stopped and the area was secured.",
        "{act} job at {site}: unexpected {cue} noticed by the crew; immediate stand-down, "
        "no injuries reported.",
    ],
    "recordable": [
        "Employee sustained a minor injury during {act} at {site}. Taken to clinic, received "
        "medical treatment (stitches/splint), returned to duty next day. First aid only was not enough.",
        "During {act} at {site}, a worker slipped and injured his wrist. Hospital check found no "
        "fracture; treated and released with medication.",
    ],
    "psif": [
        "While {act} at {site}, {cue} released unexpectedly. The crew member was in the line of fire "
        "but was not struck. Barrier was missing and the outcome could easily have been fatal.",
        "{act} at {site}: {cue} failed while personnel were exposed below/near the load. No injuries, "
        "however the event had serious injury potential due to stored energy and absent safeguard.",
    ],
    "asif": [
        "During {act} at {site}, a worker was struck by {cue} and sustained a fracture; admitted and "
        "hospitalised for surgery.",
        "{act} at {site} ended in a fatality: the person was overcome by {cue} despite rescue attempts; "
        "declared dead at the hospital.",
    ],
}

CUES = {
    "hot_work": "sparks near open hydrocarbon line",
    "confined_space": "H2S alarm after gas test was skipped",
    "line_break": "residual pressure in the opened flange",
    "dropped_object": "shackle failure on a suspended load",
    "ptw_violation": "expired permit discovered mid-job",
    "lifting": "sling snap under load",
    "driving": "vehicle skid on the lease road",
    "energy_isolation": "pump started while isolation was incomplete",
    "height": "scaffold plank giving way",
    "substance": "operator showing impairment during shift",
}


def fallback_text(scenario: str, tier: str, site: str, rng: random.Random) -> str:
    tpl = rng.choice(FALLBACK_TEMPLATES[tier])
    return tpl.format(act=SCENARIOS[scenario][0].lower(), site=site, cue=CUES[scenario])


# ---------------------------------------------------------------------------

def build_plan(rng: random.Random) -> list[list[tuple[str, str]]]:
    """Batches of (scenario, tier) pairs, each batch homogeneous (one Groq call
    writes one scenario family at one tier). Scenario rotated evenly within tier."""
    keys = list(SCENARIOS)
    groups: dict[tuple[str, str], int] = {}
    i = 0
    for tier, count in TIER_PLAN.items():
        for _ in range(count):
            g = (keys[i % len(keys)], tier)
            groups[g] = groups.get(g, 0) + 1
            i += 1
    plan: list[tuple[str, str]] = []
    for (sc, tier), count in groups.items():
        plan += [(sc, tier)] * count
    batches = [plan[i : i + BATCH] for i in range(0, len(plan), BATCH)]
    rng.shuffle(batches)
    return batches


def generate(args):
    rng = random.Random(args.seed)
    batches = build_plan(rng)
    client = None if args.no_groq else _groq_client()
    mode = "groq" if client else "template_fallback"
    n_rows = sum(len(b) for b in batches)
    print(f"[l3] generating {n_rows} rows via {mode} ({len(batches)} batches)")

    rows: list[dict] = []

    for bi, batch in enumerate(batches):
        scenario, tier = batch[0]
        n = len(batch)
        texts, sites = [], []
        if client:
            try:
                out = _groq_batch(client, USER_TEMPLATE.format(
                    n=n, sites=", ".join(SITES), scenario=SCENARIOS[scenario][0],
                    hint=SCENARIOS[scenario][1], tier=tier))
                texts = [o.get("text", "").strip() for o in out if o.get("text", "").strip()]
                sites = [o.get("site") if o.get("site") in SITES else rng.choice(SITES) for o in out]
            except Exception as exc:
                print(f"[l3] batch {bi} failed ({exc}); templates for this batch")
                texts, sites = [], []
        if len(texts) < n:
            sites = list(sites) + [rng.choice(SITES) for _ in range(n - len(texts))]
            texts += [fallback_text(scenario, tier, sites[k], rng)
                      for k in range(len(texts), n)]
        for k in range(n):
            sid, _ = batch[k]
            rows.append({
                "id": f"L3-{len(rows)+1:04d}",
                "text": re.sub(r"\s+", " ", texts[k])[:600],
                "tier": tier,
                "site": sites[k] if k < len(sites) else rng.choice(SITES),
                "activity": SCENARIOS[sid][0],
                "scenario": sid,
                "occurred_at": _rand_date(rng),
                "source_layer": "l3_synthetic",
                "is_synthetic": 1,
            })

    # second independent annotator on a 150-row sample (annotator_b)
    sample = rng.sample(rows, min(args.kappa_n, len(rows)))
    double = []
    if client:
        for i in range(0, len(sample), BATCH):
            chunk = sample[i : i + BATCH]
            items = "\n".join(f'{r["id"]}: {r["text"]}' for r in chunk)
            try:
                labels = {o["id"]: o["tier"] for o in _groq_batch(
                    client, LABEL_TEMPLATE.format(items=items), retries=2,
                    model=ANNOTATOR_MODEL)
                    if isinstance(o, dict) and o.get("tier") in TIERS}
            except Exception:
                labels = {}
            for r in chunk:
                double.append({"id": r["id"], "text": r["text"],
                               "annotator_a": r["tier"], "annotator_b": labels.get(r["id"], "")})
    else:
        double = [{"id": r["id"], "text": r["text"], "annotator_a": r["tier"],
                   "annotator_b": ""} for r in sample]

    LABELING_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(LABELING_DIR / "labeled_set.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()) + ["in_holdout"])
        w.writeheader()
        for r in rows:
            r["in_holdout"] = 0
            w.writerow(r)
    with open(LABELING_DIR / "double_annotated.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "text", "annotator_a", "annotator_b"])
        w.writeheader()
        w.writerows(double)

    counts = {t: sum(1 for r in rows if r["tier"] == t) for t in TIERS}
    sif = (counts["psif"] + counts["asif"]) / len(rows)
    prov = {
        "provider": "groq" if client else "deterministic_templates",
        "model": GROQ_MODEL if client else "n/a",
        "annotator_model": ANNOTATOR_MODEL if client else "n/a",
        "prompt_hash": _prompt_hash(),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "counts": counts,
        "tier_plan": TIER_PLAN,
        "sif_potential_share": round(sif, 4),
        "kappa_sample": len(double),
        "seed": args.seed,
        "note": "annotator_a = model-assisted planned tier; annotator_b = independent "
                "second Groq pass (text-only). Disagreements excluded from training gold.",
    }
    (DATA_DIR / "PROVENANCE.json").write_text(json.dumps(prov, indent=2), encoding="utf-8")
    print(f"[l3] wrote {len(rows)} rows, sif_share={sif:.1%}, "
          f"double={len(double)} -> {LABELING_DIR}")
    return rows, prov


def _rand_date(rng: random.Random) -> str:
    days = rng.randint(0, 540)
    t = time.gmtime(time.time() - days * 86400)
    return time.strftime("%Y-%m-%d", t)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--kappa-n", type=int, default=150)
    ap.add_argument("--no-groq", action="store_true", help="force template fallback")
    generate(ap.parse_args())


if __name__ == "__main__":
    main()
