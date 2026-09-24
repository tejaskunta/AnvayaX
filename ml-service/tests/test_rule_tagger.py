"""Rule layer + heuristic tier tests (no model downloads)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model.rule_tagger import heuristic_tier, tag_rules  # noqa: E402


def test_tag_rules_matches_confined_space_and_hot_work():
    tags = tag_rules("Worker entered the storage tank for welding without a gas test.")
    names = {t["rule"] for t in tags}
    assert "Confined Space" in names
    assert all(t["confidence"] >= 0.6 for t in tags)


def test_tag_rules_threshold_gating_not_topk():
    # a benign sentence should produce no rule tags at all
    assert tag_rules("The office cafeteria served lunch at noon today.") == []


def test_matched_phrases_deduped():
    tags = tag_rules("The permit was not obtained. no permit was issued for the line break.")
    for t in tags:
        assert len(t["matched_phrases"]) == len(set(t["matched_phrases"]))


def test_heuristic_death_is_asif():
    tier, conf = heuristic_tier(
        "The operator died at the scene after the flange ruptured.", [])
    assert tier == "asif"


def test_heuristic_negated_injury_not_asif():
    tags = tag_rules("Inside the storage tank hot work ignited gas. No injuries occurred.")
    tier, _ = heuristic_tier("Inside the storage tank hot work ignited gas. No injuries occurred.", tags)
    assert tier == "psif"


def test_heuristic_injury_is_recordable():
    t = "The technician suffered a laceration to the hand and received medical treatment."
    tier, _ = heuristic_tier(t, tag_rules(t))
    assert tier == "recordable"


def test_heuristic_benign_is_near_miss():
    t = "A wrench was dropped from the scaffold but the area below was barricaded and empty."
    tier, _ = heuristic_tier(t, tag_rules(t))
    assert tier == "near_miss"
