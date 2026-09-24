"""Severity index, schema, registry, and gate tests."""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model.config import TIERS  # noqa: E402
from model.eval import fbeta, gate_decision  # noqa: E402
from model.schema import severity_index  # noqa: E402


def test_severity_index_all_near_miss():
    assert severity_index({"near_miss": 1.0}) == 25.0


def test_severity_index_all_asif():
    assert severity_index({"asif": 1.0}) == 100.0


def test_severity_index_range():
    si = severity_index({t: 0.25 for t in TIERS})
    assert 25.0 <= si <= 100.0
    # uniform expectation = 100 * mean(weights) = 62.5
    assert abs(si - 62.5) < 0.1


def test_severity_index_renormalizes_unnormalized_probs():
    a = severity_index({"near_miss": 2.0, "asif": 2.0})
    b = severity_index({"near_miss": 0.5, "asif": 0.5})
    assert abs(a - b) < 0.2


def test_f2_weights_recall_over_precision():
    # high recall, low precision -> F2 should exceed F1
    p, r = 0.3, 0.95
    assert fbeta(p, r, beta=2.0) > fbeta(p, r, beta=1.0)


def _report(recall):
    return {"sif_positive": {"recall": recall}}


def test_gate_first_model_always_promoted():
    ok, reason, _, delta = gate_decision(_report(0.80), None)
    assert ok and delta is None


def test_gate_rejects_recall_drop_beyond_tolerance():
    # champion 0.90, challenger 0.85 -> -5pp drop, tolerance 2pp -> reject
    ok, reason, _, delta = gate_decision(_report(0.85), _report(0.90))
    assert not ok
    assert delta is not None and delta < -2.0
    assert "REJECTED" in reason


def test_gate_accepts_within_tolerance():
    # -1.5pp drop is within the 2pp tolerance
    ok, *_ = gate_decision(_report(0.885), _report(0.90))
    assert ok


def test_gate_accepts_improvement():
    ok, reason, _, delta = gate_decision(_report(0.93), _report(0.90))
    assert ok and delta > 0
