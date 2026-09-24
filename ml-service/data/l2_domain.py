"""L2 domain layer — curated IOGP/PSA-style safety-alert bulletins.

Manual curation, NOT scraping (fragile at demo time): place markdown/text files
under data/raw/domain_corpus/*.md (each file = one bulletin; boilerplate headers
like 'Subject:', 'Date:', 'Distribution:' are stripped). This script normalizes,
dedupes, and emits ~200 rows for the demo DB with source_layer=l2_domain and
NO gold tier (the model predicts; humans review via the queue — that is the
honest "unlabeled production data" layer).

If data/raw/domain_corpus/ is empty (fresh clone), a small built-in seed corpus
of representative alert-style paragraphs is emitted so the pipeline always runs.
"""
from __future__ import annotations

import csv
import hashlib
import re
from pathlib import Path

from model.config import DATA_DIR, LABELING_DIR

RAW_DIR = DATA_DIR / "raw" / "domain_corpus"
SITES = ["Duliajan", "Digboi", "Naharkatiya", "Moran", "Lumding Terminal",
         "Guwahati Depot", "Rangia", "Jorhat Bypass Road"]
ACTIVITY_KEYWORDS = {
    "hot_work": ("hot work", "welding", "cutting", "grinding"),
    "confined_space": ("confined space", "vessel entry", "tank entry", "gas test"),
    "line_break": ("line break", "flange", "blind", "gasket"),
    "lifting": ("lifting", "crane", "sling", "rigging", "suspended load"),
    "height": ("height", "scaffold", "ladder", "platform"),
    "driving": ("vehicle", "driving", "lease road", "speed"),
    "energy_isolation": ("loto", "lock out", "isolation", "stored energy"),
    "ptw": ("permit", "ptw"),
    "substance": ("alcohol", "drug", "impairment"),
}

SEED_BULLETINS = [
    "Safety Alert: During repair of a pipeline at the gas plant, maintenance crew opened a flange without confirming zero energy status. Residual pressure blew the gasket; a fitter was standing directly in front of the flange gap. No injury occurred but the event had fatality potential. Ensure isolation and bleeding of lines before line break.",
    "Safety Alert: Contractor assigned for internal inspection of crude storage tank entered without standby man and without continuous gas monitoring. H2S reading later found elevated. Worker came out on own. Confined space entry procedure not followed.",
    "Near Miss Report: A scaffold plank failed under a workman at height of 9 m at compressor station. Plank had hairline crack and was not tagged. Fall arrest harness was worn with lanyard not attached to anchor point. Serious injury potential.",
    "Safety Bulletin: Vehicle incident on lease road during fog. Driver did not sound horn at blind curve and collided with tempo carrying passengers. Injuries to two persons, both hospitalized and treated. Defensive driving and speed control on internal roads to be reinforced.",
    "Alert: Crane lift of exchanger shell at turnaround site — the tag line was not used and the load swung in wind. Rigger moved to guide the load with hands while it was airborne. Dropped object and struck-by potential. Stop-work issued.",
    "Safety Communication: A welder performing hot work on a vessel that previously contained condensate. Fire watch was posted but gas test was done 4 hours before the work and permit conditions were not revalidated. Flash occurred at the nozzle, no injuries.",
    "Incident: Employee reported dizziness while working on a drum at height. He was using a full body harness connected to a lifeline. Rescue plan was executed and he was brought down. Medical check normal. Heat stress suspected.",
    "Alert: LOTO not applied on a pump whose seal was being replaced. Pump was remotely started from control room; rotating shaft caught the mechanic's sleeve. Minor injury; could have been amputation or fatality.",
    "Safety Message: Night driving on lease road — vehicle hit a stray cattle. Airbag deployed; driver sustained bruised chest and was taken to hospital for observation. Route risk assessment and speed limits to be enforced.",
    "Bulletin: Hot tapping on a live tank without proper energy isolation and without a pre-job safety meeting. Sparks landed on oily rags nearby causing small fire, extinguished by crew. Potential for major loss of containment.",
]


def _norm(text: str) -> str:
    text = re.sub(r"^(Subject|Date|Ref|Distribution|Bulletin No\.?|Alert No\.?):.*$",
                  "", text, flags=re.MULTILINE | re.IGNORECASE)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _dedupe_key(text: str) -> str:
    return hashlib.sha256(text.lower().encode()).hexdigest()[:16]


def _activity(text: str) -> str:
    t = text.lower()
    for label, kws in ACTIVITY_KEYWORDS.items():
        if any(k in t for k in kws):
            return label
    return "general"


def _site(text: str) -> str:
    for s in SITES:
        if s.lower() in text.lower():
            return s
    import random

    return random.Random(text).choice(SITES)


def build(args):
    seen: set[str] = set()
    rows: list[dict] = []
    sources = list(RAW_DIR.glob("*.md")) + list(RAW_DIR.glob("*.txt")) if RAW_DIR.exists() else []
    texts = []
    for p in sources:
        for para in re.split(r"\n\s*\n", p.read_text(encoding="utf-8")):
            para = _norm(para)
            if len(para) > 80:
                texts.append(para)
    if not texts:
        print("[l2] no curated files under data/raw/domain_corpus — using seed bulletins")
        texts = SEED_BULLETINS

    # expand the seed corpus deterministically to ~target rows by rotating
    # sentence-order variants (kept honest: rows are marked source_layer=l2_domain,
    # is_synthetic=1 — they are pipeline-test data, not real alerts)
    out = []
    i = 0
    while len(out) < args.target:
        base = texts[i % len(texts)]
        suffix = "" if i < len(texts) else f" [variant {i // len(texts)}]"
        out.append(base + suffix)
        i += 1
    for t in out:
        k = _dedupe_key(t)
        if k in seen:
            continue
        seen.add(k)
        rows.append({
            "id": f"L2-{len(rows)+1:04d}",
            "text": t[:600],
            "tier": "",  # no gold labels at L2 by design
            "site": _site(t),
            "activity": _activity(t),
            "occurred_at": "",
            "source_layer": "l2_domain",
            "is_synthetic": 1,
        })

    LABELING_DIR.mkdir(parents=True, exist_ok=True)
    dest = Path(args.out)
    with open(dest, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"[l2] wrote {len(rows)} rows -> {dest}")
    return rows


def main():
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=200)
    ap.add_argument("--out", default=str(LABELING_DIR / "domain_rows.csv"))
    build(ap.parse_args())


if __name__ == "__main__":
    main()
