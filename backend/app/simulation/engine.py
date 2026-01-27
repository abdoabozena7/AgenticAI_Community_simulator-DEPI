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
import json
import hashlib
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
        bias_desc = ", ".join(agent.biases) if agent.biases else "none"
        archetype_lower = (agent.archetype_name or "").lower()
        if "tech" in archetype_lower or "developer" in archetype_lower:
            vocab = "efficiency, scalability, latency, reliability, smart systems"
        elif "entrepreneur" in archetype_lower or "business" in archetype_lower:
            vocab = "ROI, market demand, profit margin, CAC/LTV, pricing"
        elif "worker" in archetype_lower or "employee" in archetype_lower:
            vocab = "monthly savings, reliability, day-to-day usability, job security"
        else:
            vocab = "market fit, trust, compliance, user adoption"
        prompt = (
            "You are an AI assistant summarising why a specific agent changed its opinion "
            "in a multi-agent social simulation. Write 1-2 natural sentences. "
            "Make it specific to the idea and the agent's archetype and traits. "
            "Avoid repeating identical phrasing across agents. "
            "Strict rule: do NOT use generic templates like 'benefits outweigh risks'. "
            "Use archetype-specific vocabulary.\n"
            f"Archetype: {agent.archetype_name}\n"
            f"Biases: {bias_desc}\n"
            f"Traits: {traits_desc}\n"
            f"Vocabulary to use: {vocab}\n"
            f"Research context: {research_summary}\n"
            f"Previous opinion: {prev_opinion}\n"
            f"New opinion: {new_opinion}\n"
            f"Influence weights: "
            f"accept={influence_weights.get('accept',0.0):.3f}, neutral={influence_weights.get('neutral',0.0):.3f}, "
            f"reject={influence_weights.get('reject',0.0):.3f}. "
            "Provide a concise explanation (max 30 words) in English."
        )
        try:
            response = await generate_ollama(
                prompt=prompt,
                temperature=0.7,
                options={
                    "repeat_penalty": 1.15,
                    "top_p": 0.9,
                },
            )
            # Truncate to ensure brevity
            explanation = response.strip().split("\n")[0]
            # Only keep first sentence up to 25 words
            words = explanation.split()
            if len(words) > 30:
                explanation = " ".join(words[:30])
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
        # Seed randomness so identical inputs produce similar outcomes
        seed_source = json.dumps(
            {
                "idea": user_context.get("idea", ""),
                "category": user_context.get("category", ""),
                "audience": user_context.get("targetAudience", []),
                "goals": user_context.get("goals", []),
                "country": user_context.get("country", ""),
                "city": user_context.get("city", ""),
                "risk": user_context.get("riskAppetite", ""),
                "maturity": user_context.get("ideaMaturity", ""),
            },
            sort_keys=True,
            ensure_ascii=True,
        )
        seed_value = int(hashlib.sha256(seed_source.encode("utf-8")).hexdigest()[:8], 16)
        random.seed(seed_value)

        # Determine number of agents (18-24 inclusive)
        def _idea_risk_score(idea_text: str) -> float:
            text = idea_text.lower()
            score = 0.0
            if any(token in text for token in ["legal", "court", "lawsuit", "police", "regulation"]):
                score += 0.15
            if any(token in text for token in ["predict", "prediction", "outcome", "diagnosis"]):
                score += 0.1
            if any(token in text for token in ["medical", "health", "clinic", "doctor"]):
                score += 0.15
            if any(token in text for token in ["documents", "upload", "records"]):
                score += 0.08
            return min(0.4, score)

        idea_text = str(user_context.get("idea") or "")
        research_summary = str(user_context.get("research_summary") or "")
        idea_risk = _idea_risk_score(idea_text)

        def _idea_concerns() -> str:
            text = idea_text.lower()
            concerns = []
            if any(token in text for token in ["legal", "court", "lawsuit", "police", "regulation"]):
                concerns.append("regulation and liability")
            if any(token in text for token in ["predict", "prediction", "outcome"]):
                concerns.append("prediction accuracy")
            if any(token in text for token in ["documents", "upload", "records", "photos"]):
                concerns.append("privacy and data security")
            if not concerns:
                return "market fit and execution risk"
            return ", ".join(concerns[:2])

        def _idea_label() -> str:
            text = idea_text.lower()
            if "legal" in text or "court" in text:
                if "predict" in text or "outcome" in text:
                    return "an AI legal assistant that predicts case outcomes"
                return "an AI legal assistant"
            if any(token in text for token in ["medical", "health", "clinic", "doctor"]):
                return "a health-focused AI assistant"
            if "finance" in text or "bank" in text:
                return "a finance-focused AI assistant"
            if "education" in text or "school" in text:
                return "an education-focused AI assistant"
            if "e-commerce" in text or "commerce" in text or "retail" in text:
                return "an e-commerce product"
            if idea_text.strip():
                snippet = idea_text.strip()
                if len(snippet) > 70:
                    snippet = snippet[:67].rstrip() + "..."
                return f"the idea '{snippet}'"
            return "this idea"

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
                0.24
                + (0.25 * risk_value)
                + (0.2 * risk_tolerance)
                + (0.15 * optimism)
                + maturity_bias
                - idea_risk
                - (0.15 * skepticism)
            )
            reject_prob = (
                0.16
                + (0.25 * (1.0 - risk_value))
                + (0.15 * skepticism)
                + idea_risk
                - (0.1 * optimism)
            )
            accept_prob = min(0.7, max(0.12, accept_prob))
            reject_prob = min(0.6, max(0.08, reject_prob))
            neutral_prob = max(0.1, 1.0 - accept_prob - reject_prob)
            roll = random.random()
            if roll < accept_prob:
                return "accept"
            if roll < accept_prob + reject_prob:
                return "reject"
            return "neutral"

        requested_agents = user_context.get("agentCount")
        if isinstance(requested_agents, int) and 5 <= requested_agents <= 60:
            num_agents = requested_agents
        else:
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
        requested_iterations = user_context.get("iterations")
        if isinstance(requested_iterations, int) and 1 <= requested_iterations <= 12:
            num_iterations = requested_iterations
        else:
            num_iterations = random.randint(3, 6)

        def _friendly_category(category_id: str) -> str:
            return category_id.replace("_", " ").title()

        def _pick_phrase(seed: str, phrases: list[str]) -> str:
            value = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8], 16)
            return phrases[value % len(phrases)]

        def _persona_vocab(archetype: str, category: str) -> list[str]:
            a = archetype.lower()
            c = category.lower()
            if "tech" in a or "developer" in a or "engineer" in c:
                return [
                    "efficiency gains",
                    "scalability",
                    "latency and reliability",
                    "automation potential",
                ]
            if "entrepreneur" in a or "business" in a:
                return [
                    "ROI",
                    "market demand",
                    "profit margin",
                    "pricing leverage",
                ]
            if "worker" in a or "employee" in c:
                return [
                    "monthly savings",
                    "reliability",
                    "day-to-day usability",
                    "job stability",
                ]
            return ["market fit", "trust", "compliance", "user adoption"]

        def _human_reasoning(
            agent: Agent,
            iteration: int,
            influence_weights: Dict[str, float],
            changed: bool,
            prev_opinion: str | None = None,
            new_opinion: str | None = None,
        ) -> str:
            category = _friendly_category(agent.category_id)
            skepticism = agent.traits.get("skepticism", 0.5)
            optimism = agent.traits.get("optimism", 0.5)
            risk_tolerance = agent.traits.get("risk_tolerance", 0.5)
            top_opinion = max(influence_weights, key=influence_weights.get)
            archetype = agent.archetype_name or category
            prefix = _pick_phrase(
                agent.agent_id,
                [
                    "From my perspective",
                    "Given my background",
                    "As someone in this segment",
                    "In my view",
                ],
            )
            vocab = _persona_vocab(archetype, category)
            focal = _pick_phrase(f"{agent.agent_id}-vocab", vocab)
            peer = _pick_phrase(
                f"{agent.agent_id}-peer",
                [
                    "Agent A",
                    "Agent B",
                    "Agent C",
                ],
            )
            if changed and prev_opinion and new_opinion:
                if new_opinion == "accept":
                    return (
                        f"{prefix} ({archetype}), I now lean accept because {_idea_label()} feels feasible "
                        f"and the {focal} case is convincing after {peer}'s point."
                    )
                if new_opinion == "reject":
                    return (
                        f"{prefix} ({archetype}), I moved to reject because {_idea_label()} raises "
                        f"risks around {_idea_concerns()}, and {peer}'s caution reinforced it."
                    )
                return (
                    f"{prefix} ({archetype}), I moved to neutral on {_idea_label()} because the signals "
                    "are mixed and I need more evidence."
                )
            # Not changed
            if agent.current_opinion == "accept":
                reason = _pick_phrase(
                    f"{agent.agent_id}-accept",
                    [
                        f"{focal} looks strong",
                        f"{focal} is still compelling",
                        f"{focal} keeps the value clear",
                    ],
                )
                if skepticism > 0.6:
                    reason = f"{focal} is clear, but I still want safeguards"
                return f"{prefix} ({archetype}), I still lean accept on {_idea_label()} because {reason}."
            if agent.current_opinion == "reject":
                reason = _pick_phrase(
                    f"{agent.agent_id}-reject",
                    [
                        f"{focal} risk feels too high, especially around {_idea_concerns()}",
                        f"{focal} uncertainty is still too high",
                        f"{focal} and {_idea_concerns()} are unresolved",
                    ],
                )
                if risk_tolerance > 0.7:
                    reason = f"{focal} is high and the value is unclear"
                return f"{prefix} ({archetype}), I'm leaning reject on {_idea_label()} because {reason}."
            if optimism > 0.6:
                return (
                    f"{prefix} ({archetype}), I stay neutral on {_idea_label()}: "
                    "I see potential, but the evidence is not strong yet."
                )
            return (
                f"{prefix} ({archetype}), I stay neutral on {_idea_label()} because "
                f"{_idea_concerns()} are still unresolved, even after {peer}'s input."
            )

        # Main simulation loop
        for iteration in range(1, num_iterations + 1):
            # Phase 1: Broadcast current opinions (simulate environment awareness)
            for agent in agents:
                message = (
                    f"Iteration {iteration}: I'm leaning '{agent.current_opinion}' "
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
                    try:
                        explanation = await self._llm_reasoning(
                            agent,
                            prev_opinion,
                            new_opinion,
                            influence_weights,
                        )
                    except Exception:
                        explanation = _human_reasoning(
                            agent,
                            iteration,
                            influence_weights,
                            True,
                            prev_opinion,
                            new_opinion,
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
                    explanation = _human_reasoning(agent, iteration, influence_weights, False)
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
