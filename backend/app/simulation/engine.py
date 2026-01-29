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
        self._llm_semaphore = asyncio.Semaphore(4)

    async def _llm_reasoning(
        self,
        agent: Agent,
        prev_opinion: str,
        new_opinion: str,
        influence_weights: Dict[str, float],
        changed: bool,
        research_summary: str,
        research_signals: str,
        language: str,
        idea_label: str,
        peer_label: str,
        constraints_summary: str,
        recent_phrases: List[str],
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
        if "developer" in archetype_lower or "tech" in archetype_lower or "engineer" in archetype_lower:
            style = "focused on technical trade-offs, edge cases, and implementation effort"
        elif "entrepreneur" in archetype_lower or "business" in archetype_lower:
            style = "obsessed with market timing, competition, and customer acquisition costs"
        elif "worker" in archetype_lower or "employee" in archetype_lower:
            style = "concerned about practical utility, cost-to-value ratio, and daily convenience"
        else:
            style = "thinking about social impact, trust, and long-term sustainability"
        response_language = "Arabic" if language == "ar" else "English"
        memory_context = " | ".join(agent.short_memory[-3:]) if agent.short_memory else "None"
        def _label_opinion_local(opinion: str) -> str:
            if language != "ar":
                return opinion
            return {"accept": "\u0642\u0628\u0648\u0644", "reject": "\u0631\u0641\u0636", "neutral": "\u0645\u062d\u0627\u064a\u062f"}.get(opinion, "\u0645\u062d\u0627\u064a\u062f")

        def _is_mostly_latin(text: str) -> bool:
            if not text:
                return False
            latin = sum(1 for ch in text if "a" <= ch.lower() <= "z")
            arabic = sum(1 for ch in text if "\u0600" <= ch <= "\u06ff")
            return latin > arabic * 2 and latin > 10
        recent_block = "; ".join(recent_phrases[-6:]) if recent_phrases else "None"
        prompt = (
            f"You are a {agent.archetype_name or 'participant'} with skepticism level {agent.traits.get('skepticism', 0.5):.2f}. "
            f"Evaluate this idea: {idea_label}. "
            "Rule: Speak in the first person. "
            "Rule: Use your professional jargon and concrete trade-offs. "
            "Rule: Do NOT use generic sentences or templates. "
            "Rule: Reference another agent's point if it helps. "
            "Rule: Avoid repeating phrases already used by other agents. "
            "Rule: Start with a surprising or non-standard opener; avoid predictable starts like "
            "'I think', 'In my view', or 'From my perspective'. "
            "Rule: Use the settings and research as real-world context, but do NOT list them or show numbers. "
            "Rule: If responding in Arabic, avoid the English words accept/reject/neutral. "
            "Rule: If research contradicts your current stance, show doubt and lower your confidence in words. "
            f"Speak like a human {archetype_lower or 'participant'} {style}. "
            f"Your last thoughts: {memory_context}. "
            f"Research summary: {research_summary}. "
            f"Research signals: {research_signals}. "
            f"Constraints (do NOT list, just consider): {constraints_summary}. "
            f"Avoid these phrases (already used): {recent_block}. "
            f"Respond in {response_language}. If {response_language} is Arabic, do not use any English words or Latin characters."
        )
        try:
            async with self._llm_semaphore:
                response = await asyncio.wait_for(
                    generate_ollama(
                        prompt=prompt,
                        temperature=0.9,
                        options={
                            "repeat_penalty": 1.25,
                            "top_p": 0.9,
                            "frequency_penalty": 0.7,
                        },
                    ),
                    timeout=4.0,
                )
            # Truncate to ensure brevity
            explanation = response.strip().split("\n")[0]
            if response_language == "Arabic":
                for token in ["?????=", "???????=", "?????=", "?????=", "??????=", "????????="]:
                    explanation = explanation.replace(token, "")
            else:
                for token in ["category=", "audience=", "goals=", "maturity=", "location=", "risk="]:
                    explanation = explanation.replace(token, "")
            # Only keep first sentence up to 25 words
            words = explanation.split()
            if len(words) > 30:
                explanation = " ".join(words[:30])
            if response_language == "Arabic" and _is_mostly_latin(explanation):
                raise RuntimeError("LLM response not Arabic enough")
            return explanation
        except Exception:
            # Fallback deterministic explanation
            if language == "ar":
                prev_label = _label_opinion_local(prev_opinion)
                new_label = _label_opinion_local(new_opinion)
                if prev_opinion == new_opinion:
                    return (
                        f"ما زلت على رأيي '{new_label}' لأن الأدلة غير حاسمة بعد."
                    )
                return (
                    f"تم تغيير الرأي من '{prev_label}' إلى '{new_label}' "
                    "بسبب تأثير تراكمي أقوى من بقية الوكلاء."
                )
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
        language = str(user_context.get("language") or "ar").lower()
        idea_risk = _idea_risk_score(idea_text)

        def _idea_concerns() -> str:
            text = idea_text.lower()
            concerns = []
            if any(token in text for token in ["legal", "court", "lawsuit", "police", "regulation"]):
                concerns.append("regulation and liability" if language != "ar" else "اللوائح والمسؤولية")
            if any(token in text for token in ["predict", "prediction", "outcome"]):
                concerns.append("prediction accuracy" if language != "ar" else "دقة التنبؤ")
            if any(token in text for token in ["documents", "upload", "records", "photos"]):
                concerns.append("privacy and data security" if language != "ar" else "الخصوصية وأمن البيانات")
            if not concerns:
                return "market fit and execution risk" if language != "ar" else "ملاءمة السوق ومخاطر التنفيذ"
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

        def _idea_label_localized() -> str:
            if language != "ar":
                return _idea_label()
            raw = idea_text.strip()
            if any("؀" <= ch <= "ۿ" for ch in raw):
                snippet = raw
                if len(snippet) > 60:
                    snippet = snippet[:57].rstrip() + "..."
                return f"الفكرة: {snippet}"
            text_local = raw.lower()
            if "legal" in text_local or "court" in text_local:
                if "predict" in text_local or "outcome" in text_local:
                    return "مساعد قانوني ذكي لتوقع نتائج القضايا"
                return "مساعد قانوني ذكي"
            if any(token in text_local for token in ["medical", "health", "clinic", "doctor"]):
                return "مساعد صحي ذكي"
            if "finance" in text_local or "bank" in text_local:
                return "مساعد مالي ذكي"
            if "education" in text_local or "school" in text_local:
                return "مساعد تعليمي ذكي"
            if "e-commerce" in text_local or "commerce" in text_local or "retail" in text_local:
                return "منتج تجاري إلكتروني"
            return "الفكرة"

        idea_label_for_llm = _idea_label_localized() if language == "ar" else _idea_label()

        def _research_insight() -> str:
            if not research_summary:
                return ""
            summary = research_summary.lower()
            city = str(user_context.get('city') or '')
            if language == 'ar':
                if any(token in summary for token in ['?????', '??????', '????', '????', '????', '?????? ??????']):
                    return f"??? ?????? ????? ?? {city}" if city else "??? ?????? ????? ?? ?????"
                if any(token in summary for token in ['???', '??????', '?????', '??????']):
                    return "??? ??? ???? ??? ??????"
                if any(token in summary for token in ['?????', '????', '???', '?????']):
                    return "??? ????? ??????? ???? ??????"
            else:
                if any(token in summary for token in ['competition', 'crowded', 'saturated', 'many similar']):
                    return f"competition looks high in {city}" if city else "competition looks high"
                if any(token in summary for token in ['demand', 'interest', 'need']):
                    return "there seems to be clear demand"
                if any(token in summary for token in ['risk', 'regulation', 'compliance']):
                    return "regulatory risk looks material"
            return ""

        def _constraints_summary() -> str:
            category = str(user_context.get("category") or "")
            audience = ", ".join(user_context.get("targetAudience") or [])
            goals = ", ".join(user_context.get("goals") or [])
            risk = user_context.get("riskAppetite")
            maturity = str(user_context.get("ideaMaturity") or "")
            location = f"{user_context.get('city') or ''}, {user_context.get('country') or ''}".strip(", ")
            parts = []
            if category:
                parts.append(f"category={category}" if language != "ar" else f"الفئة={category}")
            if audience:
                parts.append(f"audience={audience}" if language != "ar" else f"الجمهور={audience}")
            if goals:
                parts.append(f"goals={goals}" if language != "ar" else f"الهدف={goals}")
            if maturity:
                parts.append(f"maturity={maturity}" if language != "ar" else f"النضج={maturity}")
            if location:
                parts.append(f"location={location}" if language != "ar" else f"الموقع={location}")
            if isinstance(risk, (int, float)):
                parts.append(f"risk={risk:.2f}" if language != "ar" else f"المخاطرة={risk:.2f}")
            return "; ".join(parts)

        def _label_opinion(opinion: str) -> str:
            if language != "ar":
                return opinion
            return {"accept": "قبول", "reject": "رفض", "neutral": "محايد"}.get(opinion, "محايد")

        def _initial_opinion(traits: Dict[str, float]) -> str:
            optimism = float(traits.get("optimism", 0.5))
            skepticism = float(traits.get("skepticism", 0.5))
            # Requested formula for initial diversity
            accept_prob = 0.3 + (0.4 * optimism) - (0.3 * skepticism)
            accept_prob += random.uniform(-0.08, 0.08)
            accept_prob = min(0.8, max(0.1, accept_prob))
            reject_prob = 0.2 + (0.35 * skepticism) - (0.2 * optimism)
            reject_prob += random.uniform(-0.08, 0.08)
            reject_prob = min(0.7, max(0.05, reject_prob))
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

        # Ensure we don't start with all-neutral opinions
        def _opinion_score(agent: Agent) -> float:
            optimism = float(agent.traits.get("optimism", 0.5))
            risk_tolerance = float(agent.traits.get("risk_tolerance", 0.5))
            skepticism = float(agent.traits.get("skepticism", 0.5))
            return optimism + risk_tolerance - skepticism

        if all(agent.current_opinion == "neutral" for agent in agents):
            sorted_agents = sorted(agents, key=_opinion_score, reverse=True)
            swing = max(1, len(agents) // 6)
            for agent in sorted_agents[:swing]:
                agent.current_opinion = "accept"
            for agent in sorted_agents[-swing:]:
                agent.current_opinion = "reject"

        # Inject a couple of strong-leader agents to avoid full neutrality
        leader_count = min(2, len(agents))
        if leader_count:
            leaders = random.sample(agents, k=leader_count)
            for idx, leader in enumerate(leaders):
                leader.is_leader = True
                leader.influence_weight *= 2.0
                leader.fixed_opinion = "accept" if idx % 2 == 0 else "reject"
                leader.current_opinion = leader.fixed_opinion
                leader.confidence = max(0.7, leader.confidence)

        # Determine number of iterations (3-6 inclusive)
        requested_iterations = user_context.get("iterations")
        if isinstance(requested_iterations, int) and 1 <= requested_iterations <= 12:
            num_iterations = requested_iterations
        else:
            num_iterations = random.randint(3, 6)
        # Simulation speed (1x default, 10x fast)
        speed = user_context.get("speed") or 1
        try:
            speed = float(speed)
        except Exception:
            speed = 1.0
        speed = max(0.5, min(20.0, speed))

        # Emit initial agent snapshot (iteration 0)
        await emitter(
            "agents",
            {
                "iteration": 0,
                "total_agents": len(agents),
                "agents": [_agent_snapshot(agent) for agent in agents],
            },
        )
        # Emit initial metrics so UI updates immediately
        initial_metrics = compute_metrics(agents)
        await emitter(
            "metrics",
            {
                "accepted": initial_metrics["accepted"],
                "rejected": initial_metrics["rejected"],
                "neutral": initial_metrics["neutral"],
                "acceptance_rate": initial_metrics["acceptance_rate"],
                "polarization": initial_metrics.get("polarization", 0.0),
                "total_agents": initial_metrics["total_agents"],
                "per_category": initial_metrics["per_category"],
                "iteration": 0,
                "total_iterations": num_iterations,
            },
        )

        def _friendly_category(category_id: str) -> str:
            return category_id.replace("_", " ").title()

        def _pick_phrase(seed: str, phrases: list[str]) -> str:
            value = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8], 16)
            return phrases[value % len(phrases)]

        def _normalize_msg(msg: str) -> str:
            return " ".join(msg.lower().split())

        recent_messages: List[str] = []

        def _is_template_message(message: str) -> bool:
            lowered = _normalize_msg(message)
            banned_phrases = [
                "current opinion is",
                "kept opinion",
                "not enough influence",
                "changed opinion from",
                "الرأي الحالي هو",
                "احتفظ بالرأي",
                "لم يكن هناك تأثير كاف",
                "تم تغيير الرأي من",
            ]
            return any(phrase in lowered for phrase in banned_phrases)

        def _dedupe_message(message: str, agent: Agent, iteration: int) -> str:
            normalized = _normalize_msg(message)
            if not normalized:
                return message
            repeated = any(normalized == _normalize_msg(prev) for prev in recent_messages[-30:])
            if agent.short_memory and normalized == _normalize_msg(agent.short_memory[-1]):
                repeated = True
            if not repeated:
                recent_messages.append(message)
                return message

            # If repeated, add a persona-specific twist
            category = _friendly_category(agent.category_id)
            archetype = agent.archetype_name or category
            vocab = _persona_vocab(archetype, category, language)
            insight = _research_insight()
            focal = _pick_phrase(f"{agent.agent_id}-dedupe-{iteration}", vocab)
            if language == "ar":
                message = f"{message} مع تركيز خاص على {focal}."
            else:
                message = f"{message} With a focus on {focal}."
            recent_messages.append(message)
            return message

        def _debate_message(speaker: Agent, other: Agent, iteration: int) -> str:
            category = _friendly_category(speaker.category_id)
            archetype = speaker.archetype_name or category
            vocab = _persona_vocab(archetype, category, language)
            insight = _research_insight()
            focal = _pick_phrase(f"{speaker.agent_id}-debate-{iteration}", vocab) if vocab else _idea_concerns()
            other_tag = f"Agent {other.agent_id[:4]}" if language != "ar" else f"الوكيل {other.agent_id[:4]}"
            constraints = _constraints_summary()
            if language == "ar":
                if speaker.current_opinion == "reject":
                    return (
                        f"{other_tag} شايف الفكرة جيدة، لكن {focal} ما زالت نقطة ضعف واضحة عندي. "
                        f"محتاج دليل عملي أو أرقام قبل ما أغيّر رأيي. ({constraints})"
                    )
                if speaker.current_opinion == "accept":
                    return (
                        f"{other_tag} متحفظ، لكني شايف أن {focal} يعطي أفضلية واضحة للفكرة حتى الآن. ({constraints})"
                    )
                return (
                    f"{other_tag} قال رأيه، وأنا محايد لأن تفاصيل {focal} غير محسومة حتى الآن. ({constraints})"
                )
            if speaker.current_opinion == "reject":
                return (
                    f"{other_tag} likes the idea, but I still see {focal} as a major weak spot. "
                    f"I need concrete proof before moving. ({constraints})"
                )
            if speaker.current_opinion == "accept":
                return (
                    f"{other_tag} is cautious, but I think {focal} keeps the upside credible right now. ({constraints})"
                )
            return f"{other_tag} shared a view; I'm still neutral because {focal} feels unresolved. ({constraints})"

        def _persona_vocab(archetype: str, category: str, language: str) -> list[str]:
            a = archetype.lower()
            c = category.lower()
            if "tech" in a or "developer" in a or "engineer" in c:
                return (
                    ["تحسين الكفاءة", "قابلية التوسع", "زمن الاستجابة", "استقرار النظام"]
                    if language == "ar"
                    else ["efficiency gains", "scalability", "latency and reliability", "automation potential"]
                )
            if "entrepreneur" in a or "business" in a:
                return (
                    ["العائد على الاستثمار", "طلب السوق", "هامش الربح", "تكلفة الاستحواذ"]
                    if language == "ar"
                    else ["ROI", "market demand", "profit margin", "pricing leverage"]
                )
            if "worker" in a or "employee" in c:
                return (
                    ["التوفير الشهري", "سهولة الاستخدام", "الاستقرار الوظيفي", "الموثوقية"]
                    if language == "ar"
                    else ["monthly savings", "reliability", "day-to-day usability", "job stability"]
                )
            return (
                ["ملاءمة السوق", "الثقة", "الامتثال", "تبني المستخدمين"]
                if language == "ar"
                else ["market fit", "trust", "compliance", "user adoption"]
            )

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
            idea_local = _idea_label_localized() if language == "ar" else _idea_label()
            prefix = _pick_phrase(
                f"{agent.agent_id}-{iteration}",
                [
                    "From my perspective",
                    "Given my background",
                    "As someone in this segment",
                    "In my view",
                ]
                if language != "ar"
                else [
                    "من وجهة نظري",
                    "بحكم خبرتي",
                    "كممثل لهذا النوع من الجمهور",
                    "برأيي الشخصي",
                ],
            )
            vocab = _persona_vocab(archetype, category, language)
            insight = _research_insight()
            focal = _pick_phrase(f"{agent.agent_id}-vocab-{iteration}", vocab) if vocab else _idea_concerns()
            peer = _pick_phrase(
                f"{agent.agent_id}-peer-{iteration}",
                ["Agent A", "Agent B", "Agent C"] if language != "ar" else ["الوكيل أ", "الوكيل ب", "الوكيل ج"],
            )
            if changed and prev_opinion and new_opinion:
                if new_opinion == "accept":
                    if language == "ar":
                        return (
                            f"{prefix} ({archetype}) أصبحت ميّالاً للقبول لأن {idea_local} تبدو قابلة للتنفيذ، "
                            f"ونقطة {peer} حول {focal} قللت ترددي، لكن ما زلت أراقب مخاطر {_idea_concerns()}."
                        )
                    return (
                        f"{prefix} ({archetype}), I now lean accept because {idea_local} feels feasible "
                        f"and the {focal} case is convincing after {peer}'s point, though {_idea_concerns()} still matters."
                    )
                if new_opinion == "reject":
                    if language == "ar":
                        return (
                            f"{prefix} ({archetype}) اتجهت للرفض لأن {idea_local} تثير مخاطر تخص "
                            f"{_idea_concerns()}، وتحذير {peer} عزز ذلك، ولم أجد ميزة قوية في {focal}."
                        )
                    return (
                        f"{prefix} ({archetype}), I moved to reject because {idea_local} raises "
                        f"risks around {_idea_concerns()}, and {peer}'s caution reinforced it while {focal} looked weak."
                    )
                if language == "ar":
                    return (
                        f"{prefix} ({archetype}) انتقلت للموقف المحايد تجاه {idea_local} لأن المؤشرات "
                        f"مختلطة: هناك فائدة في {focal} لكن مخاطر {_idea_concerns()} ما زالت بلا إجابة."
                    )
                return (
                    f"{prefix} ({archetype}), I moved to neutral on {idea_local} because the signals "
                    f"are mixed: {focal} looks promising but {_idea_concerns()} is still unresolved."
                )
            # Not changed
            if agent.current_opinion == "accept":
                reason = _pick_phrase(
                    f"{agent.agent_id}-accept-{iteration}",
                    [
                        f"{focal} looks strong",
                        f"{focal} is still compelling",
                        f"{focal} keeps the value clear",
                    ]
                    if language != "ar"
                    else [
                        f"{focal} تبدو قوية",
                        f"{focal} ما زالت مقنعة",
                        f"{focal} توضح القيمة بشكل كافٍ",
                    ],
                )
                if skepticism > 0.6:
                    reason = f"{focal} واضحة لكني أريد ضمانات" if language == "ar" else f"{focal} is clear, but I still want safeguards"
                if language == "ar":
                    return f"{prefix} ({archetype}) ما زلت أميل للقبول بخصوص {idea_local} لأن {reason}، مع تحفظ حول {_idea_concerns()}."
                return f"{prefix} ({archetype}), I still lean accept on {idea_local} because {reason}, though {_idea_concerns()} needs safeguards."
            if agent.current_opinion == "reject":
                reason = _pick_phrase(
                    f"{agent.agent_id}-reject-{iteration}",
                    [
                        f"{focal} risk feels too high, especially around {_idea_concerns()}",
                        f"{focal} uncertainty is still too high",
                        f"{focal} and {_idea_concerns()} are unresolved",
                    ]
                    if language != "ar"
                    else [
                        f"مخاطر {focal} مرتفعة، خصوصاً فيما يتعلق بـ {_idea_concerns()}",
                        f"عدم وضوح {focal} ما زال كبيراً",
                        f"{focal} و {_idea_concerns()} لم تُحل بعد",
                    ],
                )
                if risk_tolerance > 0.7:
                    reason = f"{focal} مرتفعة والقيمة غير واضحة" if language == "ar" else f"{focal} is high and the value is unclear"
                if language == "ar":
                    return f"{prefix} ({archetype}) أميل للرفض بخصوص {idea_local} لأن {reason}، ولا أرى ميزة حقيقية في {focal} بعد."
                return f"{prefix} ({archetype}), I'm leaning reject on {idea_local} because {reason}, and {focal} doesn't offset it yet."
            if optimism > 0.6:
                if language == "ar":
                    return (
                        f"{prefix} ({archetype}) ما زلت محايداً تجاه {idea_local}: "
                        f"أرى إمكانات في {focal}، لكن الأدلة ليست قوية بعد."
                    )
                return (
                    f"{prefix} ({archetype}), I stay neutral on {idea_local}: "
                    f"I see potential in {focal}, but the evidence is not strong yet."
                )
            if language == "ar":
                return (
                    f"{prefix} ({archetype}) ما زلت محايداً لأن بيانات {focal} غير كافية لدي الآن، "
                    f"ومخاطر {_idea_concerns()} تحتاج توضيحاً عملياً قبل الحسم."
                )
            return (
                f"{prefix} ({archetype}), I'm still neutral because {focal} evidence feels thin, "
                f"and {_idea_concerns()} still needs concrete proof."
            )

        def _research_signals_text() -> str:
            structured = user_context.get("research_structured") or {}
            signals = structured.get("signals") if isinstance(structured, dict) else []
            if isinstance(signals, list) and signals:
                return "; ".join(str(s) for s in signals[:6])
            return ""

        def _apply_research_grounding(agent: Agent, weights: Dict[str, float]) -> None:
            structured = user_context.get("research_structured") or {}
            if not isinstance(structured, dict):
                return
            competition = str(structured.get("competition_level") or "").lower()
            demand = str(structured.get("demand_level") or "").lower()
            regulatory = str(structured.get("regulatory_risk") or "").lower()
            price = str(structured.get("price_sensitivity") or "").lower()
            penalty = 0.0
            if competition in {"high", "crowded", "saturated"}:
                weights["reject"] += 0.08
                penalty += 0.05
            if demand in {"low", "weak"}:
                weights["reject"] += 0.06
                penalty += 0.04
            if regulatory in {"high", "strict"}:
                weights["reject"] += 0.06
                penalty += 0.04
            if price in {"high"}:
                weights["reject"] += 0.04
                penalty += 0.03
            if demand in {"high", "strong"}:
                weights["accept"] += 0.05
            if competition in {"low"}:
                weights["accept"] += 0.04
            if penalty > 0 and agent.current_opinion == "accept":
                agent.confidence = max(0.2, agent.confidence - penalty)
            if demand in {"high", "strong"} and agent.current_opinion == "reject":
                agent.confidence = max(0.2, agent.confidence - 0.04)

        async def _emit_reasoning(
            agent: Agent,
            iteration: int,
            influence_weights: Dict[str, float],
            changed: bool,
            prev_opinion: str,
            new_opinion: str,
            peer_label: str,
            recent_phrases: List[str],
        ) -> None:
            if changed:
                try:
                    explanation = await self._llm_reasoning(
                        agent,
                        prev_opinion,
                        new_opinion,
                        influence_weights,
                        True,
                        research_summary,
                        _research_signals_text(),
                        language,
                        idea_label_for_llm,
                        peer_label,
                        _constraints_summary(),
                        recent_phrases,
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
                if _is_template_message(explanation):
                    explanation = _human_reasoning(
                        agent,
                        iteration,
                        influence_weights,
                        True,
                        prev_opinion,
                        new_opinion,
                    )
                explanation = _dedupe_message(explanation, agent, iteration)
                agent.record_reasoning_step(
                    iteration=iteration,
                    message=explanation,
                    triggered_by="environment",
                    opinion_change={"from": prev_opinion, "to": new_opinion},
                )
            else:
                if random.random() < 0.8:
                    try:
                        explanation = await self._llm_reasoning(
                            agent,
                            agent.current_opinion,
                            agent.current_opinion,
                            influence_weights,
                            False,
                            research_summary,
                            _research_signals_text(),
                            language,
                            idea_label_for_llm,
                            peer_label,
                            _constraints_summary(),
                            recent_phrases,
                        )
                    except Exception:
                        explanation = _human_reasoning(agent, iteration, influence_weights, False)
                else:
                    explanation = _human_reasoning(agent, iteration, influence_weights, False)
                if _is_template_message(explanation):
                    explanation = _human_reasoning(agent, iteration, influence_weights, False)
                explanation = _dedupe_message(explanation, agent, iteration)
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
                    "opinion": agent.current_opinion,
                },
            )

        # Main simulation loop
        for iteration in range(1, num_iterations + 1):
            # Phase 1: Compute pairwise influences
            influences = compute_pairwise_influences(agents, self.dataset)

            # Phase 1.5: lightweight debate layer (adds direct influence and messages)
            debate_pool = random.sample(agents, k=min(len(agents), max(4, len(agents) // 3)))
            for i in range(0, len(debate_pool) - 1, 2):
                a = debate_pool[i]
                b = debate_pool[i + 1]
                if a.current_opinion == b.current_opinion:
                    continue
                # Influence boosts based on confidence and skepticism
                a_skepticism = float(a.traits.get("skepticism", 0.5))
                b_skepticism = float(b.traits.get("skepticism", 0.5))
                boost_to_a = max(0.05, 0.18 * b.confidence * (1.0 - a_skepticism))
                boost_to_b = max(0.05, 0.18 * a.confidence * (1.0 - b_skepticism))
                influences[a.agent_id][b.current_opinion] += boost_to_a
                influences[b.agent_id][a.current_opinion] += boost_to_b

                msg_a = _debate_message(a, b, iteration)
                msg_b = _debate_message(b, a, iteration)
                msg_a = _dedupe_message(msg_a, a, iteration)
                msg_b = _dedupe_message(msg_b, b, iteration)
                a.record_reasoning_step(iteration=iteration, message=msg_a, triggered_by="debate", opinion_change=None)
                b.record_reasoning_step(iteration=iteration, message=msg_b, triggered_by="debate", opinion_change=None)
                await emitter(
                    "reasoning_step",
                    {"agent_id": a.agent_id, "iteration": iteration, "message": msg_a, "opinion": a.current_opinion},
                )
                await emitter(
                    "reasoning_step",
                    {"agent_id": b.agent_id, "iteration": iteration, "message": msg_b, "opinion": b.current_opinion},
                )

            # Phase 2: Apply opinion updates
            any_changed = False
            reasoning_tasks: List[asyncio.Task] = []
            for agent in agents:
                influence_weights = influences[agent.agent_id]
                _apply_research_grounding(agent, influence_weights)
                sorted_weights = sorted(influence_weights.items(), key=lambda item: item[1], reverse=True)
                top_opinion, top_weight = sorted_weights[0]
                second_weight = sorted_weights[1][1] if len(sorted_weights) > 1 else 0.0
                diff = max(0.0, top_weight - second_weight)
                peer_label = _pick_phrase(
                    f"{agent.agent_id}-peer-{iteration}",
                    ["Agent A", "Agent B", "Agent C"] if language != "ar" else ["???????????? ??", "???????????? ??", "???????????? ??"],
                )
                prev_opinion = agent.current_opinion
                if agent.fixed_opinion:
                    new_opinion = agent.fixed_opinion
                    changed = new_opinion != prev_opinion
                else:
                    new_opinion, changed = decide_opinion_change(
                        current_opinion=agent.current_opinion,
                        influence_weights=influence_weights,
                        skepticism=agent.traits.get("skepticism", 0.0),
                        stubbornness=agent.stubbornness,
                    )
                    if not changed and influence_weights[top_opinion] > 0 and random.random() < 0.12:
                        new_opinion = top_opinion
                        changed = new_opinion != agent.current_opinion
                if changed:
                    any_changed = True
                    agent.current_opinion = new_opinion
                    agent.neutral_streak = 0
                    agent.confidence = max(0.3, agent.confidence - (0.08 + min(0.08, diff)))
                else:
                    if agent.current_opinion == "neutral":
                        agent.neutral_streak += 1
                        decay = 0.04 + min(0.04, diff / 2)
                        if agent.neutral_streak >= 2:
                            decay += 0.03
                        agent.confidence = max(0.2, agent.confidence - decay)
                    elif agent.current_opinion == top_opinion:
                        agent.neutral_streak = 0
                        agent.confidence = min(1.0, agent.confidence + 0.06 + min(0.08, diff / 2))
                    else:
                        agent.neutral_streak = 0
                        agent.confidence = max(0.25, agent.confidence - 0.05)
                reasoning_tasks.append(
                    asyncio.create_task(
                        _emit_reasoning(
                            agent,
                            iteration,
                            influence_weights,
                            changed,
                            prev_opinion,
                            new_opinion,
                            peer_label,
                            recent_messages,
                        )
                    )
                )
            if reasoning_tasks:
                await asyncio.gather(*reasoning_tasks)

            if not any_changed:
                for agent in random.sample(agents, k=max(1, len(agents) // 10)):
                    if agent.fixed_opinion:
                        continue
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
                    if agent.fixed_opinion:
                        continue
                    if agent.current_opinion != flip_to:
                        agent.current_opinion = flip_to
                        agent.confidence = max(0.3, agent.confidence - 0.1)

            # If still all-neutral, force a small split to keep realism
            if all(agent.current_opinion == "neutral" for agent in agents):
                sorted_agents = sorted(agents, key=_opinion_score, reverse=True)
                swing = max(1, len(agents) // 8)
                for agent in sorted_agents[:swing]:
                    if agent.fixed_opinion:
                        continue
                    agent.current_opinion = "accept"
                for agent in sorted_agents[-swing:]:
                    if agent.fixed_opinion:
                        continue
                    agent.current_opinion = "reject"

            # External noise: occasional wild-card shift with a human explanation
            if random.random() < 0.15:
                wild_agent = random.choice(agents)
                if wild_agent.fixed_opinion:
                    wild_agent = random.choice([a for a in agents if not a.fixed_opinion] or [wild_agent])
                wild_agent.current_opinion = random.choice(["accept", "reject"])
                wild_agent.confidence = max(0.3, wild_agent.confidence - 0.05)
                wild_message = (
                    "سمعت أخباراً متضاربة اليوم جعلتني أعيد التفكير في مخاطر المشروع."
                    if language == "ar"
                    else "I heard mixed reports today that made me reconsider the project risks."
                )
                wild_agent.record_reasoning_step(
                    iteration=iteration,
                    message=wild_message,
                    triggered_by="external_event",
                    opinion_change=None,
                )
                await emitter(
                    "reasoning_step",
                    {
                        "agent_id": wild_agent.agent_id,
                        "iteration": iteration,
                        "message": wild_message,
                        "opinion": wild_agent.current_opinion,
                    },
                )

            # Phase 4: Emit aggregated metrics

            metrics = compute_metrics(agents)
            await emitter(
                "metrics",
                {
                    "accepted": metrics["accepted"],
                    "rejected": metrics["rejected"],
                    "neutral": metrics["neutral"],
                    "acceptance_rate": metrics["acceptance_rate"],
                    "polarization": metrics.get("polarization", 0.0),
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
            await asyncio.sleep(0.25 / speed)

        # After all iterations, compute final metrics
        final_metrics = compute_metrics(agents)
        return final_metrics
