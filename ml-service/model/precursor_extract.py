"""Precursor extraction — spaCy NER + EntityRuler over activity/location/
barrier-failure/energy-source lexicons (EEI SCL concepts)."""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml

from .config import RULES_DIR

_LEX_CACHE: dict[str, list[re.Pattern[str]]] = {}


@lru_cache(maxsize=1)
def load_lexicons(path: Path | None = None) -> dict[str, list[str]]:
    p = path or RULES_DIR / "precursors.yml"
    raw = yaml.safe_load(p.read_text(encoding="utf-8"))
    return {k: v for k, v in raw.items()}


def _patterns(key: str) -> list[re.Pattern[str]]:
    if key not in _LEX_CACHE:
        _LEX_CACHE[key] = [re.compile(p, re.IGNORECASE) for p in load_lexicons()[key]]
    return _LEX_CACHE[key]


def extract_precursors(text: str) -> dict:
    """Return {activities, locations, barrier_failures, energy_sources} — deduped,
    canonical surface forms. Deterministic; spaCy NER is layered on top where
    available (see extract_with_spacy)."""
    out: dict[str, list[str]] = {}
    for key in ("energy_sources", "barrier_failures", "activities", "locations"):
        found: list[str] = []
        for pat in _patterns(key):
            for m in pat.finditer(text):
                s = (m.group(1) if m.groups() and m.group(1) else m.group(0)).strip().lower()
                s = re.sub(r"\s+", " ", s)
                if s and s not in found:
                    found.append(s)
        out[key] = found[:12]
    return {
        "activities": out["activities"],
        "locations": out["locations"],
        "barrier_failures": out["barrier_failures"],
        "energy_sources": out["energy_sources"],
    }


def extract_with_spacy(text: str) -> dict:
    """spaCy NER (ORG/GPE/LOC) merged into the lexicon result for locations,
    falling back to lexicon-only if the model isn't installed."""
    base = extract_precursors(text)
    try:
        nlp = _spacy_nlp()
        doc = nlp(text[:5000])
        for ent in doc.ents:
            if ent.label_ in {"LOC", "GPE", "FAC"}:
                s = ent.text.strip().lower()
                if s and s not in base["locations"]:
                    base["locations"].append(s)
    except Exception:
        pass  # graceful: model not downloaded
    return base


@lru_cache(maxsize=1)
def _spacy_nlp():
    import spacy

    try:
        return spacy.load("en_core_web_sm")
    except OSError:
        spacy.cli.download("en_core_web_sm")
        return spacy.load("en_core_web_sm")
