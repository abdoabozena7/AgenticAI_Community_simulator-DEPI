from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from .agent import Agent


def compute_metrics(agents: List[Agent]) -> Dict[str, float | int | Dict[str, int] | Dict[str, Dict[str, int]]]:

    counts = {"accept": 0, "reject": 0, "neutral": 0}
    per_category: Dict[str, int] = defaultdict(int)
    per_category_breakdown: Dict[str, Dict[str, int]] = defaultdict(lambda: {"accept": 0, "reject": 0, "neutral": 0})
    for agent in agents:
        op = agent.current_opinion
        counts[op] += 1
        per_category_breakdown[agent.category_id][op] += 1
        if op == "accept":
            per_category[agent.category_id] += 1
    total = len(agents)
    acceptance_rate = counts["accept"] / total if total > 0 else 0.0
    decided = counts["accept"] + counts["reject"]
    if decided > 0:
        balance = 1.0 - (abs(counts["accept"] - counts["reject"]) / decided)
        polarization = max(0.0, min(1.0, balance * (decided / total)))
    else:
        polarization = 0.0
    return {
        "total_agents": total,
        "accepted": counts["accept"],
        "rejected": counts["reject"],
        "neutral": counts["neutral"],
        "acceptance_rate": acceptance_rate,
        "polarization": polarization,
        "per_category": dict(per_category),
        "per_category_breakdown": {k: dict(v) for k, v in per_category_breakdown.items()},
    }
