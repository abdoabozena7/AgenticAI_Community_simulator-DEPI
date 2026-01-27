"""
Simulation engine for the multi-agent social simulation backend.

This module orchestrates the lifecycle of a single simulation run. It
creates agents from the dataset, executes a specified number of
iterations according to the influence logic and emits reasoning and
metrics events via a supplied callback.
"""

from __future__ import annotations

import asyncio
import random
from typing import Callable, Dict, List, Any

from ..core.dataset_loader import Dataset
from ..models.schemas import ReasoningStep
from .agent import Agent
from .influence import compute_pairwise_influences, decide_opinion_change
from .aggregator import compute_metrics


class SimulationEngine:
    """Driver for executing social simulations.

    Each simulation run spawns a set of agents derived from the dataset and
    carries out multiple iterations of pairwise influence. The engine
    communicates progress through an event emitter callback which
    delivers reasoning steps and metrics updates to the caller (e.g.
    WebSocket handler).
    """

    def __init__(self, dataset: Dataset) -> None:
        self.dataset = dataset

    async def run_simulation(
        self,
        user_context: Dict[str, Any],
        emitter: Callable[[str, Dict[str, Any]], asyncio.Future],
    ) -> Dict[str, Any]:
        """Execute a social simulation.

        Args:
            user_context: Structured input provided by the user. The
                simulation engine does not make decisions based on
                sensitive characteristics but can utilise context for
                initial settings if desired.
            emitter: Async function called with events of the form
                (event_type, data). Supported event types include
                'reasoning_step' and 'metrics'.

        Returns:
            Final aggregated metrics summarising the simulation outcome.
        """
        # Determine number of agents (19–24 inclusive)
        num_agents = random.randint(19, 24)
        agents: List[Agent] = []
        category_ids = list(self.dataset.category_by_id.keys())
        # Spawn agents by randomly picking categories and templates
        for _ in range(num_agents):
            category_id = random.choice(category_ids)
            templates = self.dataset.templates_by_category.get(category_id)
            if not templates:
                continue  # skip if no templates for this category
            template = random.choice(templates)
            agent = Agent(template=template, category=self.dataset.category_by_id[category_id], initial_opinion="neutral")
            agents.append(agent)
        # Determine number of iterations (3–6 inclusive)
        num_iterations = random.randint(3, 6)
        # Main simulation loop
        for iteration in range(1, num_iterations + 1):
            # Phase 1: Broadcast current opinions (simulate environment awareness)
            # We create a reasoning step for each agent summarising their state.
            for agent in agents:
                message = f"Iteration {iteration}: current opinion is '{agent.current_opinion}' with confidence {agent.confidence:.2f}."
                agent.record_reasoning_step(iteration=iteration, message=message, triggered_by="environment", opinion_change=None)
                await emitter(
                    "reasoning_step",
                    {
                        "agent_id": agent.agent_id,
                        "iteration": iteration,
                        "message": message,
                    },
                )
            # Phase 2: Compute pairwise influences
            influences = compute_pairwise_influences(agents, self.dataset)
            # Phase 3: Apply opinion updates
            for agent in agents:
                # Determine new opinion
                influence_weights = influences[agent.agent_id]
                new_opinion, changed = decide_opinion_change(
                    current_opinion=agent.current_opinion,
                    influence_weights=influence_weights,
                    skepticism=agent.traits.get("skepticism", 0.0),
                )
                if changed:
                    prev_opinion = agent.current_opinion
                    agent.current_opinion = new_opinion
                    # Adjust confidence: drop when changed
                    agent.confidence = max(0.3, agent.confidence - 0.1)
                    reason = f"Changed opinion from '{prev_opinion}' to '{new_opinion}' due to cumulative influence."
                    agent.record_reasoning_step(
                        iteration=iteration,
                        message=reason,
                        triggered_by="environment",
                        opinion_change={"from": prev_opinion, "to": new_opinion},
                    )
                    await emitter(
                        "reasoning_step",
                        {
                            "agent_id": agent.agent_id,
                            "iteration": iteration,
                            "message": reason,
                        },
                    )
                else:
                    # If not changed, slightly increase confidence
                    agent.confidence = min(1.0, agent.confidence + 0.05)
            # Phase 4: Emit aggregated metrics
            metrics = compute_metrics(agents)
            await emitter(
                "metrics",
                {
                    "accepted": metrics["accepted"],
                    "rejected": metrics["rejected"],
                    "neutral": metrics["neutral"],
                    "acceptance_rate": metrics["acceptance_rate"],
                    # Include total agents for context but the frontend may ignore
                    "total_agents": metrics["total_agents"],
                    "per_category": metrics["per_category"],
                    "iteration": iteration,
                },
            )
            # Small delay to simulate asynchronous processing and allow UI to update
            await asyncio.sleep(0.1)
        # After all iterations, compute final metrics
        final_metrics = compute_metrics(agents)
        return final_metrics
