

from __future__ import annotations

import random
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from ..models.schemas import InteractionRuleModel
from .agent import Agent
from ..core.dataset_loader import Dataset


def compute_pairwise_influences(agents: List[Agent], dataset: Dataset) -> Dict[str, Dict[str, float]]:

    # Initialise influence accumulators for each agent
    accum: Dict[str, Dict[str, float]] = {
        agent.agent_id: {"accept": 0.0, "neutral": 0.0, "reject": 0.0} for agent in agents
    }

    if not agents:
        return accum

    agents_by_category: Dict[str, List[Agent]] = defaultdict(list)
    for agent in agents:
        agents_by_category[agent.category_id].append(agent)
    other_by_category: Dict[str, List[Agent]] = {}
    for category_id, same_agents in agents_by_category.items():
        other_by_category[category_id] = [a for a in agents if a.category_id != category_id]

    population = len(agents)
    sample_size = min(population - 1, max(12, int((population ** 0.5) * 3)))
    same_ratio = 0.55

    for target in agents:
        same_pool = [a for a in agents_by_category.get(target.category_id, []) if a.agent_id != target.agent_id]
        other_pool = other_by_category.get(target.category_id, [])
        influencer_pool: List[Agent] = []
        if sample_size > 0:
            k_same = min(len(same_pool), int(sample_size * same_ratio))
            k_other = min(len(other_pool), sample_size - k_same)
            if k_same > 0:
                influencer_pool.extend(random.sample(same_pool, k=k_same))
            if k_other > 0:
                influencer_pool.extend(random.sample(other_pool, k=k_other))
            if len(influencer_pool) < min(sample_size, population - 1):
                selected_ids = {a.agent_id for a in influencer_pool}
                remaining = [a for a in agents if a.agent_id != target.agent_id and a.agent_id not in selected_ids]
                need = min(sample_size - len(influencer_pool), len(remaining))
                if need > 0:
                    influencer_pool.extend(random.sample(remaining, k=need))
        else:
            influencer_pool = [a for a in agents if a.agent_id != target.agent_id]

        for influencer in influencer_pool:
            # Determine base influence from dataset rule
            rule_key = (influencer.category_id, target.category_id)
            rule: Optional[InteractionRuleModel] = dataset.rules_by_pair.get(rule_key)
            if rule is None:
                # If no explicit rule, assume neutral multiplier of 1.0
                base_multiplier = 1.0
            else:
                base_multiplier = rule.influence_multiplier
            base_weight = base_multiplier * influencer.influence_weight
            # Leader boost only (avoid double-counting base weight)
            base_boost = 1.0
            if getattr(influencer, "is_leader", False):
                base_boost *= 1.4
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
            # Random noise (multiplicative, unbiased)
            noise = random.uniform(-0.06, 0.06)
            # Compute final influence weight
            weight = base_weight * base_boost * homophily * skepticism_factor * susceptibility * (1.0 + noise)
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
    total_weight = sum(weights.values())
    if total_weight <= 0:
        return current_opinion, False
    shares = {k: (v / total_weight) for k, v in weights.items()}
    base_threshold = 0.05 + (0.2 * skepticism) + (0.2 * stubbornness)

    # Make neutral less attractive unless it's clearly dominant
    if shares["accept"] > shares["neutral"] + base_threshold and shares["accept"] >= shares["reject"]:
        candidate = "accept"
    elif shares["reject"] > shares["neutral"] + base_threshold and shares["reject"] >= shares["accept"]:
        candidate = "reject"
    else:
        candidate = "neutral"

    # Additional stubbornness to leave current opinion
    if candidate != current_opinion:
        stay_threshold = 0.04 + (0.18 * stubbornness) + (0.1 * skepticism)
        if (shares[candidate] - shares.get(current_opinion, 0.0)) < stay_threshold:
            candidate = current_opinion

    return candidate, candidate != current_opinion
