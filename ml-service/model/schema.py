"""Cross-language contract. The JSON shape returned by POST /classify is defined
here; web/db/schema.ts mirrors it. Change one, change the other."""
from __future__ import annotations

from pydantic import BaseModel, Field

from .config import TIERS


class RuleTag(BaseModel):
    rule: str
    matched_phrases: list[str] = Field(default_factory=list)
    confidence: float


class Precursors(BaseModel):
    activities: list[str] = Field(default_factory=list)
    locations: list[str] = Field(default_factory=list)
    barrier_failures: list[str] = Field(default_factory=list)
    energy_sources: list[str] = Field(default_factory=list)


class ClassifyResult(BaseModel):
    tiers: dict[str, float] = Field(..., description="probability per ASTM tier")
    tier: str = Field(..., description="argmax tier")
    severity_index: float = Field(..., description="100 * sum(w_i * p_i), range 25-100")
    confidence: float
    needs_review: bool
    rule_tags: list[RuleTag] = Field(default_factory=list)
    precursors: Precursors = Field(default_factory=Precursors)
    embedding: list[float] | None = None
    model_version: str = "rules_only"
    acquisition_score: float | None = Field(
        None, description="active-learning priority, higher = more informative label"
    )
    mode: str = Field("transformer", description="'transformer' or 'rules_only' fallback")


class ClassifyRequest(BaseModel):
    text: str = Field(..., min_length=1)


class TrainRow(BaseModel):
    text: str
    tier: str
    weight: float | None = None  # corrections may carry human weight; default 1.0


class TrainRequest(BaseModel):
    rows: list[TrainRow] = Field(..., min_length=8)
    note: str | None = None


class GateReport(BaseModel):
    promoted: bool
    challenger_version: str
    champion_version: str | None = None
    sif_recall_challenger: float
    sif_recall_champion: float | None = None
    delta_pp: float | None = None
    reason: str = ""


def severity_index(tier_probs: dict[str, float]) -> float:
    from .config import SEVERITY_WEIGHTS

    total = sum(tier_probs.get(t, 0.0) for t in TIERS) or 1.0
    return round(100.0 * sum(SEVERITY_WEIGHTS[t] * tier_probs.get(t, 0.0) / total for t in TIERS), 1)
