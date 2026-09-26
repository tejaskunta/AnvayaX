"""Transformer classifier training — DistilBERT-base + LoRA (peft).

CONTINUAL-LEARNING INVARIANT (docs/CONTINUAL_LEARNING.md §1): every refresh
trains FROM BASE on the FULL accumulated pool. We never load a previous adapter
and continue — that is how catastrophic forgetting happens. `--from-base` is the
default and the only supported mode; the flag exists so the invariant is visible.

Run:
  python -m model.classifier_train --pool labeling/labeled_set.csv \
      --train labeling/splits.json [--include-corrections ../web/db/sqlite.db] \
      [--loss focal] [--device cuda|cpu|auto]
"""
from __future__ import annotations

import argparse
import json
import math
import random
from pathlib import Path

import numpy as np
import torch
from sklearn.utils.class_weight import compute_class_weight
from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler

from .config import (
    BASE_MODEL,
    LORA_ALPHA,
    LORA_DROPOUT,
    LORA_R,
    LORA_TARGET_MODULES,
    MAX_SEQ_LEN,
    SEED,
    SIF_POSITIVE,
    TIERS,
    TIER_INDEX,
)
from .losses import FocalLoss
from .registry import load_config, next_version


class TextDataset(Dataset):
    def __init__(self, texts, labels, tokenizer):
        self.enc = tokenizer(
            list(texts), truncation=True, padding="max_length",
            max_length=MAX_SEQ_LEN, return_tensors="pt",
        )
        self.labels = torch.tensor(labels, dtype=torch.long)

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, i):
        return {k: v[i] for k, v in self.enc.items()} | {"labels": self.labels[i]}


def set_seed(seed: int):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def build_pool(pool_csv: Path, splits_json: Path | None, include_corrections: Path | None,
               release_heldout: bool = False) -> list[dict]:
    """Assemble training rows. Gold pool from labeled_set.csv; optionally restrict
    to the v1 split (60%) unless release_heldout; corrections from sqlite override
    their report's tier (human-in-the-loop = ground truth)."""
    import csv

    rows = list(csv.DictReader(open(pool_csv, encoding="utf-8")))
    rows = [r for r in rows if r.get("tier") in TIER_INDEX and r.get("in_holdout", "0") != "1"]
    if splits_json and splits_json.exists():
        sp = json.loads(splits_json.read_text(encoding="utf-8"))
        train_ids = set(sp.get("train", []))
        if train_ids:
            rows = [r for r in rows if r.get("id") in train_ids]
    if include_corrections and Path(include_corrections).exists():
        import sqlite3

        con = sqlite3.connect(str(include_corrections))
        try:
            corr = con.execute(
                "SELECT r.raw_text, c.corrected_tag FROM corrections c "
                "JOIN reports r ON r.id = c.report_id WHERE c.released_to_pool = 1"
            ).fetchall()
            for text, tag in corr:
                if text and tag in TIER_INDEX:
                    rows.append({"id": f"corr-{len(rows)}", "text": text, "tier": tag,
                                 "in_holdout": "0"})
        finally:
            con.close()
    return rows


def train(args):
    set_seed(args.seed)
    device = args.device if args.device != "auto" else ("cuda" if torch.cuda.is_available() else "cpu")

    pool = build_pool(Path(args.pool), Path(args.train) if args.train else None,
                      Path(args.include_corrections) if args.include_corrections else None)
    if len(pool) < 8:
        raise SystemExit(f"Only {len(pool)} training rows — need >= 8")

    # stratified train/val split of the pool (85/15) for early model selection
    by_tier: dict[str, list] = {}
    for r in pool:
        by_tier.setdefault(r["tier"], []).append(r)
    train_rows, val_rows = [], []
    for tier, rs in by_tier.items():
        random.shuffle(rs)
        n_val = max(1, math.ceil(len(rs) * 0.15))
        val_rows += rs[:n_val]
        train_rows += rs[n_val:]

    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.base)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.base, num_labels=len(TIERS),
        id2label={i: t for i, t in enumerate(TIERS)}, label2id=TIER_INDEX,
    )

    from peft import LoraConfig, TaskType, get_peft_model

    lora = LoraConfig(
        task_type=TaskType.SEQ_CLS, r=LORA_R, lora_alpha=LORA_ALPHA,
        lora_dropout=LORA_DROPOUT, target_modules=LORA_TARGET_MODULES,
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()
    model.to(device)

    def encode(rows):
        return TextDataset([r["text"] for r in rows], [TIER_INDEX[r["tier"]] for r in rows], tok)

    # Class-balanced batches: with a ~4:1 majority:minority pool, plain shuffling
    # lets whole batches go SIF-free and the model coasts on the majors (v2/v3
    # post-mortem: focal/weighted loss alone still collapsed psif recall to 0.375).
    # WeightedRandomSampler oversamples minority rows so every batch carries them.
    if getattr(args, "balanced", True):
        y_train = [TIER_INDEX[r["tier"]] for r in train_rows]
        class_counts = np.bincount(y_train, minlength=len(TIERS)).astype(float)
        sample_w = torch.tensor([1.0 / class_counts[c] for c in y_train])
        sampler: object = WeightedRandomSampler(sample_w, num_samples=len(train_rows),
                                                replacement=True)
        shuffle = False
    else:
        sampler, shuffle = None, True
    dl_train = DataLoader(encode(train_rows), batch_size=args.batch_size,
                          shuffle=shuffle, sampler=sampler)
    dl_val = DataLoader(encode(val_rows), batch_size=args.batch_size)

    # class weights on the training pool
    y = [TIER_INDEX[r["tier"]] for r in train_rows]
    classes = np.unique(y)
    cw = compute_class_weight("balanced", classes=classes, y=np.array(y))
    weights = torch.ones(len(TIERS), device=device)
    for c, w in zip(classes, cw):
        weights[c] = float(w)
    # Recall-leaning posture for the safety-critical minority (docs: "accept FPs,
    # never miss a precursor"). sif_boost > 1 raises psif/asif weights above the
    # balanced point; 1.0 keeps plain class-balanced behaviour.
    sif_boost = float(getattr(args, "sif_boost", 1.0))
    if sif_boost != 1.0:
        for t in SIF_POSITIVE:
            weights[TIER_INDEX[t]] *= sif_boost

    if args.loss == "focal":
        criterion = FocalLoss(gamma=args.gamma, weight=weights)
    else:
        criterion = torch.nn.CrossEntropyLoss(weight=weights)

    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr)

    # checkpoint selection: the gate protects SIF-positive recall, so select the
    # epoch with the best val-split SIF recall — but ONLY among epochs whose val
    # accuracy clears MIN_VAL_ACC. The floor is what keeps selection honest: pure
    # max-recall shipped a first v3 that flagged every row SIF (gate recall
    # 1.0000, frozen-set accuracy 0.327 — useless), while pure F2/loss selection
    # shipped healthy-looking models that missed the gate's hard SIF rows
    # (0.545). Tie-break on accuracy so, at equal recall, the less degenerate
    # epoch wins. The frozen regression set is NEVER used here.
    from peft.utils import get_peft_model_state_dict, set_peft_model_state_dict

    MIN_VAL_ACC = 0.60
    sif_idx = {TIER_INDEX[t] for t in SIF_POSITIVE}
    best_val_loss = float("inf")
    best_val_acc = -1.0
    best_sif_recall = -1.0
    best_epoch = 0
    best_state: dict | None = None
    for epoch in range(args.epochs):
        model.train()
        tot = 0.0
        for batch in dl_train:
            batch = {k: v.to(device) for k, v in batch.items()}
            labels = batch.pop("labels")
            out = model(**batch, labels=labels)
            loss = criterion(out.logits, labels)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            tot += loss.item() * labels.size(0)
        # val — SIF (psif∪asif) recall + accuracy on the held-out val split
        model.eval()
        vtot, vcorrect, vtotal = 0.0, 0, 0
        v_sif_hit = v_sif_total = 0
        with torch.no_grad():
            for batch in dl_val:
                batch = {k: v.to(device) for k, v in batch.items()}
                labels = batch.pop("labels")
                logits = model(**batch).logits
                vloss = criterion(logits, labels).item() * labels.size(0)
                vtot += vloss
                preds = logits.argmax(-1)
                vcorrect += (preds == labels).sum().item()
                vtotal += labels.size(0)
                sif_mask = torch.tensor(
                    [int(l.item() in sif_idx) for l in labels],
                    device=device, dtype=torch.bool)
                v_sif_total += int(sif_mask.sum().item())
                v_sif_hit += int(((preds == labels) & sif_mask).sum().item())
        val_loss = vtot / max(vtotal, 1)
        val_acc = vcorrect / max(vtotal, 1)
        sif_recall = v_sif_hit / max(v_sif_total, 1)
        print(f"epoch {epoch+1}/{args.epochs} train_loss={tot/len(y):.4f} "
              f"val_loss={val_loss:.4f} val_acc={val_acc:.3f} "
              f"val_sif_recall={sif_recall:.3f}")
        eligible = val_acc >= MIN_VAL_ACC
        if eligible and (round(sif_recall, 6), round(val_acc, 6)) > \
                (round(best_sif_recall, 6), round(best_val_acc, 6)):
            best_sif_recall = sif_recall
            best_val_acc = val_acc
            best_val_loss = val_loss
            best_epoch = epoch + 1
            best_state = {k: v.detach().cpu().clone()
                          for k, v in get_peft_model_state_dict(model).items()}

    version = args.version or next_version()
    out_dir = Path(args.out) / version
    out_dir.mkdir(parents=True, exist_ok=True)
    if best_state is not None:
        set_peft_model_state_dict(model, best_state)  # roll back to best epoch
    model.save_pretrained(out_dir)
    tok.save_pretrained(out_dir)
    meta = {
        "version": version,
        "base_model": args.base,
        "from_base": True,  # replay invariant — never incremental-from-adapter
        "loss": args.loss,
        "epochs": args.epochs,
        "seed": args.seed,
        "device": device,
        "train_rows": len(train_rows),
        "val_rows": len(val_rows),
        "pool_rows": len(pool),
        "class_distribution": {t: sum(1 for r in pool if r["tier"] == t) for t in TIERS},
        "best_val_loss": round(best_val_loss, 5),
        "best_val_acc": round(best_val_acc, 4),
        "best_val_sif_recall": round(best_sif_recall, 4),
        "val_sif_rows": v_sif_total,
        "min_val_acc_floor": MIN_VAL_ACC,
        "best_epoch": best_epoch,
        "balanced_batches": bool(getattr(args, "balanced", True)),
    }
    (out_dir / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"SAVED {out_dir}")
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pool", default="labeling/labeled_set.csv")
    ap.add_argument("--train", default=None, help="splits.json to restrict to v1 60%")
    ap.add_argument("--include-corrections", default=None, help="path to sqlite.db")
    ap.add_argument("--base", default=BASE_MODEL)
    ap.add_argument("--from-base", dest="from_base", action="store_true", default=True,
                    help="ALWAYS true — replay-from-base invariant")
    ap.add_argument("--epochs", type=int, default=6)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--loss", choices=["weighted_ce", "focal"], default="weighted_ce")
    ap.add_argument("--balanced", action="store_true", default=True,
                    help="class-balanced batch sampling (default on); --no-balanced "
                         "to fall back to plain shuffled batches")
    ap.add_argument("--gamma", type=float, default=2.0)
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--device", default="auto")
    ap.add_argument("--version", default=None)
    ap.add_argument("--out", default="model_registry")
    args = ap.parse_args()
    if not args.from_base:
        raise SystemExit("--from-base=False is not supported: continual learning "
                         "requires replay from base on the full pool.")
    train(args)


if __name__ == "__main__":
    main()
