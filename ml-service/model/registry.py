"""Model registry — champion/challenger bookkeeping for continual learning.

Layout (all under ml-service/model_registry/):
  v1/ adapter_model.safetensors + tokenizer files + metrics.json
  v2/ ...
  ACTIVE pointer lives in ml-service/model_config.json (single source of truth;
  rollback = repoint active_version).

Every refresh attempt — promoted OR rejected — gets a registry row so the
improvement trajectory is auditable (Model Insight screen renders this)."""
from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from .config import MODEL_CONFIG_PATH, REGISTRY_DIR


def _registry_path() -> Path:
    return REGISTRY_DIR / "registry.json"


def load_registry() -> list[dict]:
    p = _registry_path()
    if not p.exists():
        return []
    return json.loads(p.read_text(encoding="utf-8"))


def load_config() -> dict:
    if MODEL_CONFIG_PATH.exists():
        return json.loads(MODEL_CONFIG_PATH.read_text(encoding="utf-8"))
    return {}


def save_config(cfg: dict) -> None:
    MODEL_CONFIG_PATH.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def next_version() -> str:
    versions = [r["version"] for r in load_registry()]
    nums = [int(v[1:]) for v in versions if v.startswith("v") and v[1:].isdigit()]
    return f"v{max(nums, default=0) + 1}"


def register_version(
    version: str,
    *,
    metrics: dict,
    gate_result: str,  # "promoted" | "rejected" | "initial"
    champion_version: str | None,
    trained_on_rows: int,
    note: str | None = None,
    artifact_dir: Path | None = None,
) -> dict:
    """Persist a challenger's artifacts + registry row. Promotion (repointing
    active_version in model_config.json) is decided by the caller via promote()."""
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    dest = REGISTRY_DIR / version
    if artifact_dir and Path(artifact_dir).exists():
        if dest.exists():
            shutil.rmtree(dest)
        shutil.move(str(artifact_dir), str(dest))
    row = {
        "version": version,
        "registered_at": datetime.now(timezone.utc).isoformat(),
        "gate_result": gate_result,
        "champion_before": champion_version,
        "metrics": metrics,
        "sif_recall": (metrics.get("sif_positive") or {}).get("recall")
        if isinstance(metrics, dict)
        else None,
        "trained_on_rows": trained_on_rows,
        "note": note,
    }
    reg = load_registry()
    reg.append(row)
    _registry_path().write_text(json.dumps(reg, indent=2), encoding="utf-8")
    return row


def promote(version: str, extra_config: dict | None = None) -> None:
    cfg = load_config()
    cfg["active_version"] = version
    cfg["promoted_at"] = datetime.now(timezone.utc).isoformat()
    if extra_config:
        cfg.update(extra_config)
    save_config(cfg)
    reg = load_registry()
    for r in reg:
        if r["version"] == version:
            if r["gate_result"] != "initial":  # first champion keeps its audit marker
                r["gate_result"] = "promoted"
            r["promoted_at"] = cfg["promoted_at"]
    _registry_path().write_text(json.dumps(reg, indent=2), encoding="utf-8")


def active_version() -> str | None:
    return load_config().get("active_version")


def champion_metrics() -> dict | None:
    av = active_version()
    if not av:
        return None
    for r in reversed(load_registry()):
        if r["version"] == av and r["gate_result"] in {"promoted", "initial"}:
            return r["metrics"]
    return None


def rollback_to_previous() -> str | None:
    """Repoint active_version to the last promoted version before the current one."""
    reg = [r for r in load_registry() if r["gate_result"] in {"promoted", "initial"}]
    if len(reg) < 2:
        return None
    prev = reg[-2]["version"]
    promote(prev)
    return prev
