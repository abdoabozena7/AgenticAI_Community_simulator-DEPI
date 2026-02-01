

from __future__ import annotations

import random
from typing import Dict, List, Optional, Tuple

from ..models.schemas import InteractionRuleModel
from .agent import Agent
from ..core.dataset_loader import Dataset


def compute_pairwise_influences(agents: List[Agent], dataset: Dataset) -> Dict[str, Dict[str, float]]:

    # Initialise influence accumulators for each agent
    accum: Dict[str, Dict[str, float]] = {
        agent.agent_id: {"accept": 0.0, "neutral": 0.0, "reject": 0.0} for agent in agents
    }

    for target in agents:
        for influencer in agents:
            if influencer.agent_id == target.agent_id:
                continue  # skip self-influence
            # Determine base influence from dataset rule
            rule_key = (influencer.category_id, target.category_id)
            rule: Optional[InteractionRuleModel] = dataset.rules_by_pair.get(rule_key)
            if rule is None:
                # If no explicit rule, assume neutral multiplier of 1.0
                base_multiplier = 1.0
            else:
                base_multiplier = rule.influence_multiplier
            base_weight = base_multiplier * influencer.influence_weight
            # Boost influence for high-base-weight personas and leaders
            base_boost = 1.0 + max(0.0, influencer.base_influence_weight - 1.0) * 0.35
            if getattr(influencer, "is_leader", False):
                base_boost *= 1.6
            # Homophily bonus: same category or same archetype increases influence
            homophily = 1.0
            if target.category_id == influencer.category_id:
                homophily += 0.2
            if target.template_id == influencer.template_id:
                homophily += 0.1
            # Skepticism resistance: high skepticism reduces influence
            skepticism_factor = 1.0 - target.traits.get("skepticism", 0.0)
            # Susceptibility from target's template
            target_template = dataset.template_by_id.get(target.template_id)
            susceptibility = target_template.influence_susceptibility if target_template else 1.0
            # Random noise to preserve stochastic behaviour
            noise = random.uniform(-0.03, 0.03)
            # Compute final influence weight
            weight = base_weight * base_boost * homophily * skepticism_factor * susceptibility
            weight += noise
            # Clamp weight to non-negative values
            weight = max(weight, 0.0)
            # Accumulate influence towards the influencer's current opinion
            accum[target.agent_id][influencer.current_opinion] += weight
    return accum


def decide_opinion_change(
    current_opinion: str,
    influence_weights: Dict[str, float],
    skepticism: float,
    stubbornness: float = 0.0,
) -> Tuple[str, bool]:

    weights = {
        "accept": influence_weights.get("accept", 0.0),
        "reject": influence_weights.get("reject", 0.0),
        "neutral": influence_weights.get("neutral", 0.0),
    }
    base_threshold = 0.08 + (0.25 * skepticism) + (0.25 * stubbornness)

    # Make neutral less attractive unless it's clearly dominant
    if weights["accept"] > weights["neutral"] + base_threshold and weights["accept"] >= weights["reject"]:
        candidate = "accept"
    elif weights["reject"] > weights["neutral"] + base_threshold and weights["reject"] >= weights["accept"]:
        candidate = "reject"
    else:
        candidate = "neutral"

    # Additional stubbornness to leave current opinion
    if candidate != current_opinion:
        stay_threshold = 0.05 + (0.2 * stubbornness) + (0.1 * skepticism)
        if (weights[candidate] - weights.get(current_opinion, 0.0)) < stay_threshold:
            candidate = current_opinion

    return candidate, candidate != current_opinion
