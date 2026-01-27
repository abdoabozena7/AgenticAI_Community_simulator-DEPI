"""
Simulation engine for the hybrid multi-agent social simulation backend.

This module orchestrates the lifecycle of a single simulation run. It
creates agents from the dataset, executes a specified number of
iterations according to the influence logic and emits reasoning and
metrics events via a supplied callback. A hybrid approach is used for
reasoning: mathematical influence rules determine opinion changes,
while a local LLM (via Ollama) occasionally generates human-readable
explanations when agents change their opinions.
"""

from __future__ import annotations

import asyncio
import random
from typing import Callable, Dict, List, Any, Tuple

from ..core.dataset_loader import Dataset
from ..models.schemas import ReasoningStep
from .agent import Agent
from .influence import compute_pairwise_influences, decide_opinion_change
from .aggregator import compute_metrics
from ..core.ollama_client import generate_ollama


class SimulationEngine:
    """Driver for executing social simulations.

    Each simulation run spawns a set of agents derived from the dataset and
    carries out multiple iterations of pairwise influence. The engine
    communicates progress through an event emitter callback which
    delivers reasoning steps and metrics updates to the caller (e.g.
    WebSocket handler). A hybrid reasoning model combines simple
    mathematical rules with occasional LLM-generated explanations.
    """

    def __init__(self, dataset: Dataset) -> None:
        self.dataset = dataset

    async def _llm_reasoning(
        self,
        agent: Agent,
        prev_opinion: str,
        new_opinion: str,
        influence_weights: Dict[str, float],
    ) -> str:
        """Invoke the LLM to produce a short explanation for an opinion change.

        The prompt includes the agent's traits, previous and new opinions and
        the influence weights for each opinion category. The LLM is asked
        to produce a concise explanation (max ~25 words). If the call
        fails, a fallback deterministic message is returned.

        Args:
            agent: The agent undergoing the opinion change.
            prev_opinion: The agent's previous opinion.
            new_opinion: The agent's new opinion.
            influence_weights: Dictionary of cumulative influence weights.

        Returns:
            A textual explanation for the opinion change.
        """
        traits_desc = ", ".join(f"{k}: {v:.2f}" for k, v in agent.traits.items())
        prompt = (
            "You are an AI assistant summarising why an agent changed its opinion "
            "in a multi-agent social simulation. The agent has personality traits: "
            f"{traits_desc}. Their previous opinion was '{prev_opinion}' and the new "
            f"opinion is '{new_opinion}'. They were influenced by cumulative weights: "
            f"accept={influence_weights.get('accept',0.0):.3f}, neutral={influence_weights.get('neutral',0.0):.3f}, "
            f"reject={influence_weights.get('reject',0.0):.3f}. "
            "Provide a concise explanation (max 25 words) in English explaining the change."
        )
        try:
            response = await generate_ollama(prompt=prompt, temperature=0.3)
            # Truncate to ensure brevity
            explanation = response.strip().split("\n")[0]
            # Only keep first sentence up to 25 words
            words = explanation.split()
            if len(words) > 25:
                explanation = " ".join(words[:25])
            return explanation
        except Exception:
            # Fallback deterministic explanation
            return (
                f"Changed opinion from '{prev_opinion}' to '{new_opinion}' due to stronger "
                "cumulative influence from other agents."
            )

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
                'reasoning_step', 'metrics' and 'agents'.

        Returns:
            Final aggregated metrics summarising the simulation outcome.
        """
        # Determine number of agents (18-24 inclusive)
        def _idea_risk_score(idea_text: str) -> float:
            text = idea_text.lower()
            score = 0.0
            if any(token in text for token in ["legal", "court", "lawsuit", "police", "regulation"]):
                score += 0.2
            if any(token in text for token in ["predict", "prediction", "outcome", "diagnosis"]):
                score += 0.15
            if any(token in text for token in ["medical", "health", "clinic", "doctor"]):
                score += 0.2
            if any(token in text for token in ["documents", "upload", "records"]):
                score += 0.1
            return min(0.5, score)

        idea_text = str(user_context.get("idea") or "")
        idea_risk = _idea_risk_score(idea_text)

        def _initial_opinion(traits: Dict[str, float]) -> str:
            risk = user_context.get("riskAppetite")
            if isinstance(risk, (int, float)):
                risk_value = max(0.0, min(1.0, float(risk)))
            else:
                risk_value = 0.5
            maturity = str(user_context.get("ideaMaturity") or "").lower()
            maturity_bias = {
                "concept": 0.0,
                "prototype": 0.04,
                "mvp": 0.08,
                "launched": 0.12,
            }.get(maturity, 0.0)
            optimism = float(traits.get("optimism", 0.5))
            skepticism = float(traits.get("skepticism", 0.5))
            risk_tolerance = float(traits.get("risk_tolerance", 0.5))
            accept_prob = (
                0.18
                + (0.25 * risk_value)
                + (0.2 * risk_tolerance)
                + (0.15 * optimism)
                + maturity_bias
                - idea_risk
                - (0.15 * skepticism)
            )
            reject_prob = (
                0.18
                + (0.25 * (1.0 - risk_value))
                + (0.15 * skepticism)
                + idea_risk
                - (0.1 * optimism)
            )
            accept_prob = min(0.65, max(0.1, accept_prob))
            reject_prob = min(0.65, max(0.1, reject_prob))
            neutral_prob = max(0.1, 1.0 - accept_prob - reject_prob)
            roll = random.random()
            if roll < accept_prob:
                return "accept"
            if roll < accept_prob + reject_prob:
                return "reject"
            return "neutral"

        num_agents = random.randint(18, 24)
        agents: List[Agent] = []
        template_pool: List[Tuple[Any, Any]] = []
        for category_id, templates in self.dataset.templates_by_category.items():
            category = self.dataset.category_by_id.get(category_id)
            if not category or not templates:
                continue
            for template in templates:
                template_pool.append((template, category))
        if not template_pool:
            raise ValueError("No persona templates available to spawn agents.")
        # Spawn agents by randomly sampling from available templates
        for _ in range(num_agents):
            template, category = random.choice(template_pool)
            agent = Agent(template=template, category=category, initial_opinion=_initial_opinion(template.traits))
            agents.append(agent)

        def _agent_snapshot(agent: Agent) -> Dict[str, Any]:
            return {
                "agent_id": agent.agent_id,
                "category_id": agent.category_id,
                "opinion": agent.current_opinion,
                "confidence": agent.confidence,
            }

        # Emit initial agent snapshot (iteration 0)
        await emitter(
            "agents",
            {
                "iteration": 0,
                "total_agents": len(agents),
                "agents": [_agent_snapshot(agent) for agent in agents],
            },
        )

        # Determine number of iterations (3-6 inclusive)
        num_iterations = random.randint(3, 6)

        # Main simulation loop
        for iteration in range(1, num_iterations + 1):
            # Phase 1: Broadcast current opinions (simulate environment awareness)
            for agent in agents:
                message = (
                    f"Iteration {iteration}: current opinion is '{agent.current_opinion}' "
                    f"with confidence {agent.confidence:.2f}."
                )
                agent.record_reasoning_step(
                    iteration=iteration,
                    message=message,
                    triggered_by="environment",
                    opinion_change=None,
                )
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
            any_changed = False
            for agent in agents:
                influence_weights = influences[agent.agent_id]
                new_opinion, changed = decide_opinion_change(
                    current_opinion=agent.current_opinion,
                    influence_weights=influence_weights,
                    skepticism=agent.traits.get("skepticism", 0.0),
                )
                if not changed:
                    top_opinion = max(influence_weights, key=influence_weights.get)
                    if influence_weights[top_opinion] > 0 and random.random() < 0.12:
                        new_opinion = top_opinion
                        changed = new_opinion != agent.current_opinion
                if changed:
                    any_changed = True
                    prev_opinion = agent.current_opinion
                    agent.current_opinion = new_opinion
                    # Adjust confidence: drop when changed
                    agent.confidence = max(0.3, agent.confidence - 0.1)
                    # Generate an LLM explanation for the opinion change
                    explanation = await self._llm_reasoning(
                        agent,
                        prev_opinion,
                        new_opinion,
                        influence_weights,
                    )
                    agent.record_reasoning_step(
                        iteration=iteration,
                        message=explanation,
                        triggered_by="environment",
                        opinion_change={"from": prev_opinion, "to": new_opinion},
                    )
                    await emitter(
                        "reasoning_step",
                        {
                            "agent_id": agent.agent_id,
                            "iteration": iteration,
                            "message": explanation,
                        },
                    )
                else:
                    # If not changed, slightly increase confidence
                    agent.confidence = min(1.0, agent.confidence + 0.05)
                    # Send a simple deterministic message for stable opinion
                    explanation = (
                        f"Iteration {iteration}: kept opinion '{agent.current_opinion}' "
                        "because the influence was not strong enough to change."
                    )
                    agent.record_reasoning_step(
                        iteration=iteration,
                        message=explanation,
                        triggered_by="environment",
                        opinion_change=None,
                    )
                    await emitter(
                        "reasoning_step",
                        {
                            "agent_id": agent.agent_id,
                            "iteration": iteration,
                            "message": explanation,
                        },
                    )
            if not any_changed:
                for agent in random.sample(agents, k=max(1, len(agents) // 10)):
                    flip = random.choice(["accept", "reject"])
                    if agent.current_opinion != flip:
                        agent.current_opinion = flip
                        agent.confidence = max(0.3, agent.confidence - 0.1)

            # Avoid unrealistic unanimous outcomes
            unique_opinions = {agent.current_opinion for agent in agents}
            if len(unique_opinions) == 1:
                only = next(iter(unique_opinions))
                if only == "neutral":
                    flip_to = random.choice(["accept", "reject"])
                else:
                    flip_to = "neutral"
                for agent in random.sample(agents, k=max(1, len(agents) // 12)):
                    if agent.current_opinion != flip_to:
                        agent.current_opinion = flip_to
                        agent.confidence = max(0.3, agent.confidence - 0.1)

            # Phase 4: Emit aggregated metrics

            metrics = compute_metrics(agents)
            await emitter(
                "metrics",
                {
                    "accepted": metrics["accepted"],
                    "rejected": metrics["rejected"],
                    "neutral": metrics["neutral"],
                    "acceptance_rate": metrics["acceptance_rate"],
                    # Include total agents for context
                    "total_agents": metrics["total_agents"],
                    "per_category": metrics["per_category"],
                    "iteration": iteration,
                    "total_iterations": num_iterations,
                },
            )
            # Emit latest agent snapshot after applying updates
            await emitter(
                "agents",
                {
                    "iteration": iteration,
                    "total_agents": len(agents),
                    "agents": [_agent_snapshot(agent) for agent in agents],
                },
            )
            # Small delay to simulate asynchronous processing and allow UI to update
            await asyncio.sleep(0.1)

        # After all iterations, compute final metrics
        final_metrics = compute_metrics(agents)
        return final_metrics
