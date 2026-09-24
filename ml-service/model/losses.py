"""Loss functions: class-weighted cross-entropy + focal-loss escalation."""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class FocalLoss(nn.Module):
    """Weighted focal loss: FL(p_t) = -alpha_t (1 - p_t)^gamma log(p_t).

    Escalation path (docs/DATASET_AND_SCOPE_PLAN.md §1.3): if weighted CE
    under-recalls the minority SIF tiers, switch --loss focal to down-weight
    easy majors and concentrate gradient on hard/minority examples."""

    def __init__(self, gamma: float = 2.0, weight: torch.Tensor | None = None,
                 reduction: str = "mean"):
        super().__init__()
        self.gamma = gamma
        self.weight = weight  # per-class alpha weights
        self.reduction = reduction

    def forward(self, logits: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        logp = F.log_softmax(logits, dim=-1)
        logp_t = logp.gather(dim=-1, index=target.unsqueeze(1)).squeeze(1)
        p_t = logp_t.exp()
        loss = -((1.0 - p_t) ** self.gamma) * logp_t
        if self.weight is not None:
            w = self.weight.to(logits.device).gather(0, target)
            loss = loss * w
        if self.reduction == "mean":
            return loss.mean()
        if self.reduction == "sum":
            return loss.sum()
        return loss
