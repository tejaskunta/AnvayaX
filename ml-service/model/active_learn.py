"""Active learning — acquisition score for the Review Queue.

acquisition_score = alpha * normalized_entropy + (1 - alpha) * novelty
  novelty = mean cosine distance from the report embedding to its k nearest
            LABELED exemplars (a report far from anything labeled is worth a
            human's attention).

alpha=0.5 balances exploitation (uncertain predictions) against exploration
(novel regions of the corpus). See docs/CONTINUAL_LEARNING.md §4."""
from __future__ import annotations

import math

import numpy as np

from .config import ACQUISITION_ALPHA, ACQUISITION_K, TIERS


def entropy(probs) -> float:
    p = np.asarray(probs, dtype=np.float64)
    p = p[p > 0]
    s = p.sum() or 1.0
    p = p / s
    return float(-np.sum(p * np.log(p)))


def max_entropy() -> float:
    return math.log(len(TIERS))


def normalize_entropy(ent: float) -> float:
    """Scale to [0,1] against the uniform-distribution ceiling."""
    return min(1.0, ent / max_entropy())


def acquisition_score(probs=None, entropy_value: float | None = None,
                      embedding: np.ndarray | None = None,
                      exemplar_matrix: np.ndarray | None = None,
                      alpha: float = ACQUISITION_ALPHA, k: int = ACQUISITION_K) -> float:
    """Higher = more informative to label. When no labeled exemplars exist yet
    (cold start), novelty defaults to 1.0 so early rows still rank sensibly."""
    if entropy_value is None:
        entropy_value = entropy(probs if probs is not None else [])
    unc = normalize_entropy(entropy_value)
    if embedding is None or exemplar_matrix is None or len(exemplar_matrix) == 0:
        nov = 1.0
    else:
        from .similarity import knn_mean_distance

        nov, _ = knn_mean_distance(np.asarray(embedding, np.float32),
                                   np.asarray(exemplar_matrix, np.float32),
                                   None, k=k)
    score = alpha * unc + (1 - alpha) * nov
    return float(max(0.0, min(1.0, score)))


def rank_review_queue(items: list[dict]) -> list[dict]:
    """items: [{id, probs|entropy, embedding}] -> sorted desc by acquisition_score."""
    exemplars = [it["embedding"] for it in items if it.get("labeled") and it.get("embedding") is not None]
    ex_mat = np.asarray(exemplars, dtype=np.float32) if exemplars else None
    for it in items:
        it["acquisition_score"] = acquisition_score(
            probs=it.get("probs"),
            entropy_value=it.get("entropy"),
            embedding=it.get("embedding"),
            exemplar_matrix=ex_mat,
        )
    return sorted(items, key=lambda x: x["acquisition_score"], reverse=True)
