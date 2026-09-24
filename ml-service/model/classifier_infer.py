"""Inference — loads the ACTIVE LoRA adapter and produces ClassifyResult.

Cold start / no-adapter path: RULES_ONLY mode (heuristic tier + rule tags +
precursors) so the whole app is demoable before any training run.

The heavy transformer/tokenizer are loaded lazily once per process; predictions
are served from the active version in model_config.json."""
from __future__ import annotations

import threading

import numpy as np

from .config import (
    DEFAULT_REVIEW_THRESHOLD,
    MAX_SEQ_LEN,
    TIERS,
    TIER_INDEX,
)
from .precursor_extract import extract_precursors
from .registry import active_version, load_config
from .rule_tagger import heuristic_tier, tag_rules
from .schema import ClassifyResult, RuleTag, severity_index
from .similarity import embed

_lock = threading.Lock()
_bundle = None  # {tokenizer, model, device, version}


def _load_bundle():
    """Load the active adapter, or None if no trained model exists yet."""
    global _bundle
    if _bundle is not None:
        return _bundle
    with _lock:
        if _bundle is not None:
            return _bundle
        av = active_version()
        if not av:
            _bundle = False  # sentinel: rules-only
            return _bundle
        from pathlib import Path

        from .config import REGISTRY_DIR
        art = REGISTRY_DIR / av
        if not art.exists():
            _bundle = False
            return _bundle
        try:
            import torch
            from peft import PeftModel
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            base = load_config().get("base_model")
            from .config import BASE_MODEL

            base = base or BASE_MODEL
            device = "cuda" if torch.cuda.is_available() else "cpu"
            tok = AutoTokenizer.from_pretrained(str(art))
            base_model = AutoModelForSequenceClassification.from_pretrained(
                base, num_labels=len(TIERS))
            model = PeftModel.from_pretrained(base_model, str(art))
            model.to(device).eval()
            _bundle = {"tok": tok, "model": model, "device": device, "version": av}
        except Exception as exc:  # pragma: no cover — fall back to rules-only
            print(f"[infer] adapter load failed ({exc}); RULES_ONLY")
            _bundle = False
        return _bundle


def reset_bundle():
    global _bundle
    _bundle = None


def _probs_transformer(text: str) -> tuple[np.ndarray, str]:
    import torch

    b = _load_bundle()
    enc = b["tok"](text, truncation=True, max_length=MAX_SEQ_LEN, return_tensors="pt")
    enc = {k: v.to(b["device"]) for k, v in enc.items()}
    with torch.no_grad():
        logits = b["model"](**enc).logits[0].float().cpu().numpy()
    p = np.exp(logits - logits.max())
    p = p / p.sum()
    return p, b["version"]


def _probs_rules(text: str) -> np.ndarray:
    """Deterministic one-hot-ish distribution from the heuristic tier so
    severity_index and confidence behave sensibly in RULES_ONLY mode."""
    tags = tag_rules(text)
    tier, conf = heuristic_tier(text, tags)
    idx = TIER_INDEX[tier]
    p = np.full(len(TIERS), (1.0 - conf) / (len(TIERS) - 1))
    p[idx] = conf
    return p


def predict_probs_from_dir(texts: list[str], adapter_dir) -> np.ndarray:
    """Load a specific adapter (challenger, pre-promotion) and return (n, tiers)
    probability matrix. Used by the regression gate in POST /train."""
    import torch
    from pathlib import Path
    from peft import PeftModel
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    from .config import BASE_MODEL

    art = Path(adapter_dir)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(str(art))
    base_model = AutoModelForSequenceClassification.from_pretrained(BASE_MODEL, num_labels=len(TIERS))
    model = PeftModel.from_pretrained(base_model, str(art)).to(device).eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(texts), 32):
            chunk = texts[i : i + 32]
            enc = tok(chunk, truncation=True, max_length=MAX_SEQ_LEN,
                      padding=True, return_tensors="pt")
            enc = {k: v.to(device) for k, v in enc.items()}
            logits = model(**enc).logits.float().cpu().numpy()
            p = np.exp(logits - logits.max(axis=1, keepdims=True))
            out.append(p / p.sum(axis=1, keepdims=True))
    return np.vstack(out)


def classify(text: str, want_embedding: bool = True,
             review_threshold: float = DEFAULT_REVIEW_THRESHOLD) -> ClassifyResult:
    text = (text or "").strip()
    tags: list[RuleTag] = tag_rules(text)
    b = _load_bundle()
    if b:
        probs, version = _probs_transformer(text)
        mode = "transformer"
    else:
        probs = _probs_rules(text)
        version = "rules-only"
        mode = "rules_only"

    tier_idx = int(np.argmax(probs))
    tier = TIERS[tier_idx]
    confidence = float(probs[tier_idx])
    tier_probs = {t: float(probs[i]) for i, t in enumerate(TIERS)}
    si = severity_index(tier_probs)
    needs_review = confidence < review_threshold

    # embedding for the review-queue novelty term + semantic dedupe
    emb = embed([text])[0].tolist() if want_embedding else None

    # acquisition score = alpha*normalized_entropy + (1-alpha)*kNN novelty.
    # Here exemplars are unknown (stateless service) so novelty defaults to 1.0;
    # /classify refines with the true kNN term when data/exemplars.json exists.
    from .active_learn import acquisition_score
    acq = acquisition_score(probs=probs, embedding=emb, exemplar_matrix=None)

    return ClassifyResult(
        tiers={t: round(float(probs[i]), 6) for i, t in enumerate(TIERS)},
        tier=tier,
        severity_index=round(si, 2),
        confidence=round(confidence, 4),
        needs_review=needs_review,
        rule_tags=tags,
        precursors=extract_precursors(text),
        embedding=emb,
        model_version=version,
        acquisition_score=round(acq, 6),
        mode=mode,
    )
