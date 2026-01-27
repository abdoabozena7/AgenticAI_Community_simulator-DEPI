"""
Aggregation functions for summarising simulation outcomes.

This module encapsulates logic for computing high-level metrics from a
list of agents. It is used both during intermediate iterations (to
provide real-time updates via the WebSocket) and at the end of the
simulation (to produce final results for API responses).
"""

from __future__ import annotations

from collections import defaultdict
from typing import Dict, List

from .agent import Agent


def compute_metrics(agents: List[Agent]) -> Dict[str, float | int | Dict[str, int]]:
    """Compute aggregated metrics from a list of agents.

    Metrics include the total number of agents and the counts of each
    opinion category, the overall acceptance rate and per-category
    acceptance counts. Acceptance rate is defined as the fraction of
    agents whose current opinion is 'accept'.

    Args:
        agents: List of agents whose states should be summarised.

    Returns:
        A dictionary with the following keys:
            - 'total_agents': total number of agents
            - 'accepted': number of agents with opinion 'accept'
            - 'rejected': number of agents with opinion 'reject'
            - 'neutral': number of agents with opinion 'neutral'
            - 'acceptance_rate': acceptance fraction (0–1)
            - 'per_category': mapping of category_id to acceptance count
    """
    counts = {"accept": 0, "reject": 0, "neutral": 0}
    per_category: Dict[str, int] = defaultdict(int)
    for agent in agents:
        op = agent.current_opinion
        counts[op] += 1
        if op == "accept":
            per_category[agent.category_id] += 1
    total = len(agents)
    acceptance_rate = counts["accept"] / total if total > 0 else 0.0
    return {
        "total_agents": total,
        "accepted": counts["accept"],
        "rejected": counts["reject"],
        "neutral": counts["neutral"],
        "acceptance_rate": acceptance_rate,
        "per_category": dict(per_category),
    }
