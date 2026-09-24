"""AnvayaX ML service — central config. Single source of truth for paths,
tier taxonomy, weights and thresholds. The web app must never hardcode any of
this: it reads thresholds/versions via GET /model-info."""
from __future__ import annotations

from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_ROOT.parent
RULES_DIR = Path(__file__).resolve().parent / "rules"
REGISTRY_DIR = SERVICE_ROOT / "model_registry"
MODEL_CONFIG_PATH = SERVICE_ROOT / "model_config.json"
LABELING_DIR = SERVICE_ROOT / "labeling"
DATA_DIR = SERVICE_ROOT / "data"

# ASTM E2920-26 severity tiers, ordinal ascending.
TIERS = ["near_miss", "recordable", "psif", "asif"]
TIER_INDEX = {t: i for i, t in enumerate(TIERS)}
SIF_POSITIVE = ("psif", "asif")  # "SIF-potential or actual"

# Severity sub-rank: ordinal expectation over tier probabilities.
# severity_index = 100 * sum(w_i * p_i)  -> range [25, 100]
SEVERITY_WEIGHTS = {"near_miss": 0.25, "recordable": 0.50, "psif": 0.75, "asif": 1.00}

BASE_MODEL = "distilbert-base-uncased"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384

# Review-queue routing: confidence below this -> needs_review.
DEFAULT_REVIEW_THRESHOLD = 0.62
# Rule tagger: multi-label confidence threshold, NOT top-k (PRD §9 over-tagging guard).
DEFAULT_RULE_THRESHOLD = 0.60

# Continual-learning cadence (documented cron, not a daemon).
REFRESH_INTERVAL_DAYS = 7
# Regression gate: reject challenger if SIF-recall drops more than this (percentage points).
GATE_RECALL_TOLERANCE_PP = 2.0

# Acquisition score (active learning): alpha*entropy + (1-alpha)*novelty.
ACQUISITION_ALPHA = 0.5
ACQUISITION_K = 5

# LoRA hyperparameters (T4-feasible).
LORA_R = 16
LORA_ALPHA = 32
LORA_DROPOUT = 0.05
LORA_TARGET_MODULES = ["q_lin", "v_lin", "k_lin"]

MAX_SEQ_LEN = 256
SEED = 42
