"""Rule/dictionary layer — explainable, auditable IOGP 459 multi-label tagger.
Confidence threshold gating, NOT top-k (PRD §9 over-tagging guard)."""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml

from .config import DEFAULT_RULE_THRESHOLD, RULES_DIR


def _compile(pattern: str) -> re.Pattern[str]:
    return re.compile(pattern, re.IGNORECASE)


@lru_cache(maxsize=1)
def load_rule_packs(path: Path | None = None) -> list[dict]:
    p = path or RULES_DIR / "iogp_rules.yml"
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    packs = []
    for r in raw["rules"]:
        packs.append(
            {
                "name": r["name"],
                "severity_prior": float(r.get("severity_prior", 0.5)),
                "patterns": [_compile(x) for x in r["phrases"]],
            }
        )
    return packs


def tag_rules(text: str, threshold: float = DEFAULT_RULE_THRESHOLD) -> list[dict]:
    """Return [{rule, matched_phrases, confidence}] for every rule whose
    confidence clears the threshold. Confidence = min(1, 0.5 + 0.18*hits) —
    a single distinctive hit clears 0.60; noise-only rules stay below."""
    out: list[dict] = []
    for pack in load_rule_packs():
        hits: list[str] = []
        for pat in pack["patterns"]:
            for m in pat.finditer(text):
                s = m.group(0).strip().lower()
                if s and s not in hits:
                    hits.append(s)
        if not hits:
            continue
        confidence = round(min(1.0, 0.5 + 0.18 * len(hits)), 3)
        if confidence >= threshold:
            out.append(
                {"rule": pack["name"], "matched_phrases": sorted(hits)[:8], "confidence": confidence}
            )
    return sorted(out, key=lambda d: -d["confidence"])


def heuristic_tier(text: str, tags: list[dict]) -> tuple[str, float]:
    """RULES_ONLY fallback tier. Returns (tier, confidence).
    Uses severity priors + injury/energy cues. Never used when a trained
    transformer is loaded — the transformer owns tiering."""
    t = text.lower()
    neg_injury = bool(
        re.search(r"\b(no|not|without|zero|free\s+of|did\s+not\s+result\s+in|resulted\s+in\s+no)\s+"
                  r"[^.]{0,25}?\b(injur|casualt|harm|fatalit|death|wound|burn|fractur|hospital)\w*", t)
    )
    serious = (not neg_injury) and bool(
        re.search(r"\b(death|died|fatal|fatality|killed|lost\s+life|deceased)\b", t)
        or re.search(r"\b(amputat|fractur|skull|spinal|brain|internal\s+injur|surgery|hospitali[sz]ed)\b", t)
    )
    injury = (not neg_injury) and bool(
        re.search(r"\b(injur|wound|hurt|lacerat|burn|fractur|sprain|strain|hospital|medical\s+treatment)\b", t)
    )
    if serious:
        return "asif", 0.9
    sif_prior = max((tag["confidence"] * _prior(tag["rule"]) for tag in tags), default=0.0)
    energy = bool(
        re.search(r"\b(pressure|steam|h2s|h2s|hydrogen|crude|condensate|live\s+cable|electric|height|scaffold|vessel|tank|confined|load|crane|fall|struck|ruptur|burst|release|spill|fire|explos)\w*", t)
    )
    if sif_prior >= 0.65 and energy and not injury:
        return "psif", round(min(0.88, sif_prior), 3)
    if injury:
        return "recordable", 0.7
    return "near_miss", 0.65


def _prior(rule_name: str) -> float:
    for pack in load_rule_packs():
        if pack["name"] == rule_name:
            return pack["severity_prior"]
    return 0.5
