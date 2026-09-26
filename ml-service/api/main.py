"""AnvayaX ML microservice — stateless FastAPI app.

Contract (docs/PRD.md §5): Next.js owns the database; this service never opens
sqlite. Endpoints:
  GET  /health             liveness + mode (transformer | rules_only)
  POST /classify           full ClassifyResult incl. 384-dim embedding + acquisition_score
  POST /extract-precursors precursor extraction only (spaCy + lexicon)
  GET  /model-info         active version, thresholds, registry trajectory
  POST /train              continual-learning refresh: replay-from-base LoRA ->
                           frozen-regression-set gate -> promote or reject
Optional exemplar store: if ml-service/data/exemplars.json exists
  ({texts:[...]} — refreshed by scripts/refresh.ts alongside the pool),
  /classify computes a true kNN-novelty acquisition score against it.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from model import config as C
from model.active_learn import acquisition_score
from model.classifier_infer import classify, predict_probs_from_dir, reset_bundle, _load_bundle
from model.eval import evaluate_matrix, gate_decision
from model.precursor_extract import extract_precursors
from model.registry import (
    active_version,
    champion_metrics,
    load_config,
    load_registry,
    next_version,
    promote,
    register_version,
)
from model.schema import (
    ClassifyRequest,
    ClassifyResult,
    GateReport,
    TrainRequest,
)

app = FastAPI(title="AnvayaX ML service", version="0.1.0")
_train_lock = threading.Lock()

_EXEMPLARS: list[list[float]] | None = None
_EXEMPLARS_MTIME: float = 0.0


def _exemplar_matrix():
    """(n, dim) float32 exemplar matrix or None; reloaded when the file changes."""
    global _EXEMPLARS, _EXEMPLARS_MTIME
    p = C.DATA_DIR / "exemplars.json"
    if not p.exists():
        return None
    try:
        mt = p.stat().st_mtime
        if _EXEMPLARS is None or mt != _EXEMPLARS_MTIME:
            data = json.loads(p.read_text(encoding="utf-8"))
            import numpy as np

            _EXEMPLARS = np.asarray(data.get("embeddings", []), dtype=np.float32)
            _EXEMPLARS_MTIME = mt
        return _EXEMPLARS if _EXEMPLARS is not None and len(_EXEMPLARS) else None
    except Exception:
        return None


@app.get("/health")
def health():
    b = _load_bundle()
    return {
        "status": "ok",
        "mode": "transformer" if b else "rules_only",
        "active_version": active_version(),
        "time": time.time(),
    }


@app.post("/classify", response_model=ClassifyResult)
def classify_endpoint(req: ClassifyRequest):
    try:
        res = classify(req.text)
    except Exception as exc:  # surface model errors as 500, rules fallback upstream
        raise HTTPException(status_code=500, detail=f"classify failed: {exc}")
    # refine acquisition score with true kNN novelty when exemplars exist
    ex = _exemplar_matrix()
    if res.embedding and ex is not None:
        res.acquisition_score = round(
            acquisition_score(probs=list(res.tiers.values()), embedding=res.embedding,
                              exemplar_matrix=ex), 6)
    return res


class ExtractRequest(BaseModel):
    text: str = Field(..., min_length=1)


class ClassifyBatchRequest(BaseModel):
    texts: list[str] = Field(..., min_length=1, max_length=500)


@app.post("/classify-batch")
def classify_batch_endpoint(req: ClassifyBatchRequest):
    """Bulk classify for ingest/seed (750 rows at once). Same refinement as
    /classify; returns results aligned to input order."""
    ex = _exemplar_matrix()
    results = []
    for text in req.texts:
        try:
            res = classify(text)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"classify failed: {exc}")
        if res.embedding and ex is not None:
            res.acquisition_score = round(
                acquisition_score(probs=list(res.tiers.values()), embedding=res.embedding,
                                  exemplar_matrix=ex), 6)
        results.append(res)
    return {"results": [r.model_dump() for r in results]}


@app.post("/extract-precursors")
def extract_endpoint(req: ExtractRequest):
    return extract_precursors(req.text).model_dump()


@app.get("/model-info")
def model_info():
    cfg = load_config()
    b = _load_bundle()
    return {
        "active_version": active_version(),
        "mode": "transformer" if b else "rules_only",
        "base_model": C.BASE_MODEL,
        "embedding_model": C.EMBEDDING_MODEL,
        "embedding_dim": C.EMBEDDING_DIM,
        "tiers": C.TIERS,
        "severity_weights": C.SEVERITY_WEIGHTS,
        "review_threshold": cfg.get("review_threshold", C.DEFAULT_REVIEW_THRESHOLD),
        "rule_threshold": cfg.get("rule_threshold", C.DEFAULT_RULE_THRESHOLD),
        "refresh_interval_days": C.REFRESH_INTERVAL_DAYS,
        "gate_recall_tolerance_pp": C.GATE_RECALL_TOLERANCE_PP,
        "champion_metrics": champion_metrics(),
        "registry": load_registry(),
    }


class TrainResponse(BaseModel):
    gate: GateReport
    challenger_metrics: dict
    promoted: bool


@app.post("/train", response_model=TrainResponse)
def train_endpoint(req: TrainRequest):
    """Continual-learning refresh. Synchronous (hackathon scale); the caller
    (scripts/refresh.ts) owns scheduling. Replay-from-base invariant enforced in
    classifier_train.train(). Gate: challenger must not lose >2pp SIF recall on
    the frozen regression set."""
    from model.classifier_train import train as run_train

    if not _train_lock.acquire(blocking=False):
        raise HTTPException(status_code=409, detail="a training run is already in progress")
    try:
        reg_set = C.LABELING_DIR / "regression_set.csv"
        if not reg_set.exists():
            raise HTTPException(status_code=500,
                                detail=f"frozen regression set missing: {reg_set}")

        # write pool rows to a temp CSV the trainer consumes
        tmp_pool = C.LABELING_DIR / "api_pool.csv"
        C.LABELING_DIR.mkdir(parents=True, exist_ok=True)
        with open(tmp_pool, "w", encoding="utf-8") as f:
            f.write("id,text,tier,in_holdout\n")
            for i, r in enumerate(req.rows):
                esc = r.text.replace('"', '""')
                f.write(f'api-{i},"{esc}",{r.tier},0\n')

        champion = champion_metrics()
        champion_version = active_version()
        challenger = next_version()
        class Args:
            pool = str(tmp_pool)
            train = None
            include_corrections = None
            base = C.BASE_MODEL
            from_base = True
            # v2/v3 post-mortem (docs/CONTINUAL_LEARNING.md §4): weighted-CE and
            # focal challengers on the expanded pool all collapsed SIF recall on
            # the frozen gate (0.36-0.55 vs champion 0.82). Root cause was NOT
            # the loss — it was (a) plain shuffled batches letting whole batches
            # go SIF-free under the ~4:1 imbalance, (b) checkpoint selection by
            # weighted val loss, which peaks after the majority fit sharpens and
            # minority recall has already decayed, and (c) 2e-4 LR, whose seed
            # variance swings gate recall between 0.45 and 1.00 (the frozen set
            # has 11 SIF rows — every miss costs 9pp). Fixes: class-balanced
            # batch sampling, lr=1e-4 (sweep: 0.91/0.91/1.00 across seeds 42/13/99
            # vs 2e-4's coin-flip), and checkpoint selection on val SIF recall
            # gated by a val-accuracy floor so flag-everything epochs lose.
            epochs = 10
            batch_size = 16
            lr = 1e-4
            loss = "focal"
            gamma = 2.0
            balanced = True
            sif_boost = 1.0
            seed = C.SEED
            device = "auto"
            version = challenger
            out = str(C.REGISTRY_DIR)

        meta = run_train(Args())

        # evaluate challenger AND champion (if any) on the frozen regression set
        import csv as _csv

        rows = list(_csv.DictReader(open(reg_set, encoding="utf-8")))
        texts = [r["text"] for r in rows]
        import numpy as np

        from model.config import TIERS, TIER_INDEX

        y = np.asarray([TIER_INDEX[r["tier"]] for r in rows])
        ch_probs = predict_probs_from_dir(texts, C.REGISTRY_DIR / challenger)
        ch_report = evaluate_matrix(y, ch_probs)
        champ_report = None
        if champion_version and (C.REGISTRY_DIR / champion_version).exists():
            try:
                cp_probs = predict_probs_from_dir(texts, C.REGISTRY_DIR / champion_version)
                champ_report = evaluate_matrix(y, cp_probs)
            except Exception as exc:
                # Adapter weights may be absent on a fresh clone (the .safetensors
                # are gitignored) — fall back to the champion's published
                # registry metrics instead of failing the whole refresh.
                print(f"[train] champion {champion_version} not scorable ({exc}); "
                      f"using published registry metrics for the gate")

        promote_flag, reason, sif_r, delta = gate_decision(ch_report, champ_report or champion)
        if champ_report is None and champion_version:
            reason += " [champion scored from published registry metrics]"
        ch_report["train_meta"] = meta
        register_version(
            challenger, metrics=ch_report,
            gate_result="promoted" if promote_flag else "rejected",
            champion_version=champion_version,
            trained_on_rows=len(req.rows), note=req.note,
        )
        if promote_flag:
            promote(challenger)
            reset_bundle()
        base_ref = champ_report or champion or {}
        return TrainResponse(
            gate=GateReport(
                promoted=promote_flag, challenger_version=challenger,
                champion_version=champion_version,
                sif_recall_challenger=sif_r,
                sif_recall_champion=base_ref.get("sif_positive", {}).get("recall"),
                delta_pp=round(delta, 2) if delta is not None else None,
                reason=reason,
            ),
            challenger_metrics=ch_report,
            promoted=promote_flag,
        )
    finally:
        _train_lock.release()
