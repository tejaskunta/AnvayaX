"""Embedding similarity utilities (MiniLM-L6-v2, 384-dim).

Duties:
- embed(texts) -> L2-normalized vectors (cached model singleton)
- knn_mean_distance(embedding, labeled_exemplars, k) -> mean cosine distance to
  the k nearest labeled examples (novelty term of the acquisition score)
- pairwise cosine matrix for batch dedupe / clustering in eval scripts
"""
from __future__ import annotations

import threading
from typing import Sequence

import numpy as np

from .config import EMBEDDING_MODEL

_lock = threading.Lock()
_model = None


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from sentence_transformers import SentenceTransformer

                _model = SentenceTransformer(EMBEDDING_MODEL)
    return _model


def embed(texts: Sequence[str], batch_size: int = 32) -> np.ndarray:
    """Returns (n, dim) float32, L2-normalized so dot product == cosine."""
    model = _get_model()
    vecs = model.encode(list(texts), batch_size=batch_size,
                        convert_to_numpy=True, show_progress_bar=False,
                        normalize_embeddings=True)
    return np.asarray(vecs, dtype=np.float32)


def knn_mean_distance(query: np.ndarray, exemplars: np.ndarray, labels: np.ndarray,
                      k: int = 5) -> tuple[float, list[float]]:
    """Mean cosine DISTANCE (1 - cos) from query to its k nearest exemplars, plus
    the neighbor labels (for diagnostics). Returns (1.0, []) when there are no
    exemplars — maximum novelty, which is the right prior for cold start."""
    if exemplars is None or len(exemplars) == 0:
        return 1.0, []
    sims = exemplars @ query  # normalized -> cosine
    k = min(k, len(sims))
    idx = np.argsort(-sims)[:k]
    return float(np.mean(1.0 - sims[idx])), [int(i) for i in idx]


def cosine_matrix(a: np.ndarray, b: np.ndarray | None = None) -> np.ndarray:
    return a @ (b if b is not None else a).T
