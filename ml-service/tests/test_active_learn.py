"""Active-learning acquisition score tests."""
import math
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from model.active_learn import (  # noqa: E402
    acquisition_score,
    entropy,
    normalize_entropy,
    rank_review_queue,
)


def test_uniform_distribution_is_max_uncertainty():
    p = [0.25, 0.25, 0.25, 0.25]
    assert math.isclose(normalize_entropy(entropy(p)), 1.0, abs_tol=1e-9)


def test_one_hot_is_min_uncertainty():
    assert math.isclose(entropy([1.0, 0, 0, 0]), 0.0, abs_tol=1e-9)


def test_acquisition_score_bounded_0_1():
    s = acquisition_score(probs=[0.7, 0.1, 0.1, 0.1], embedding=None, exemplar_matrix=None)
    assert 0.0 <= s <= 1.0


def test_cold_start_uncertain_beats_confident():
    uncertain = acquisition_score(probs=[0.4, 0.3, 0.2, 0.1])
    confident = acquisition_score(probs=[0.97, 0.01, 0.01, 0.01])
    assert uncertain > confident


def test_novelty_term_with_exemplars():
    rng = np.random.default_rng(42)
    ex = rng.normal(size=(20, 8)).astype(np.float32)
    ex /= np.linalg.norm(ex, axis=1, keepdims=True)
    near = ex[0].copy()
    far = -ex[0].copy()
    s_near = acquisition_score(probs=[0.97, 0.01, 0.01, 0.01], embedding=near, exemplar_matrix=ex)
    s_far = acquisition_score(probs=[0.97, 0.01, 0.01, 0.01], embedding=far, exemplar_matrix=ex)
    assert s_far > s_near


def test_rank_review_queue_orders_desc():
    items = [
        {"id": "a", "probs": [0.97, 0.01, 0.01, 0.01]},
        {"id": "b", "probs": [0.25, 0.25, 0.25, 0.25]},
        {"id": "c", "probs": [0.55, 0.15, 0.15, 0.15]},
    ]
    ranked = rank_review_queue(items)
    assert ranked[0]["id"] == "b"
    assert ranked[-1]["id"] == "a"
    assert all("acquisition_score" in it for it in ranked)
