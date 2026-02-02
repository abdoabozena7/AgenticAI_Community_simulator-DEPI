# creates agents from the dataset, executes a specified number of

from __future__ import annotations

import asyncio
import json
import hashlib
import random
import re
from typing import Callable, Dict, List, Any, Tuple

from ..core.dataset_loader import Dataset
from ..models.schemas import ReasoningStep
from .agent import Agent
from .influence import compute_pairwise_influences, decide_opinion_change
from .aggregator import compute_metrics
from ..core.ollama_client import generate_ollama
try:
    from .llm_output_validator import LLMOutputValidator, build_default_forbidden_phrases
except Exception:  # validator is optional
    LLMOutputValidator = None  # type: ignore
    build_default_forbidden_phrases = lambda: []  # type: ignore



class SimulationEngine:
    """Driver for executing social simulations.

    Each simulation run spawns a set of agents derived from the dataset and
    carries out multiple iterations of pairwise influence. The engine
    communicates progress through an event emitter callback which
    delivers reasoning steps and metrics updates to the caller.
    """

    def __init__(self, dataset: Dataset) -> None:
        self.dataset = dataset
        self._llm_semaphore = asyncio.Semaphore(4)

    @staticmethod
    def _normalize_msg(msg: str) -> str:
        return " ".join(msg.lower().split())

    @staticmethod
    def _is_template_message(message: str) -> bool:
        lowered = SimulationEngine._normalize_msg(message)
        banned_phrases = build_default_forbidden_phrases() + [
            "execution risks",
            "market fit",
            "evidence is inconclusive",
            "insufficient data",
        ]
        return any(phrase in lowered for phrase in banned_phrases)

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
        anti_echo_words: List[str],
    ) -> str:

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
        memory_context = " | ".join(agent.short_memory[-5:]) if agent.short_memory else "None"

        def _is_mostly_latin(text: str) -> bool:
            if not text:
                return False
            latin = sum(1 for ch in text if "a" <= ch.lower() <= "z")
            arabic = sum(1 for ch in text if "\u0600" <= ch <= "\u06ff")
            return latin > arabic * 2 and latin > 10

        recent_block = "; ".join(recent_phrases[-6:]) if recent_phrases else "None"
        anti_echo_block = ", ".join(anti_echo_words[:12]) if anti_echo_words else "None"
        # Compose the prompt for the language model.  In addition to the
        # existing behavioural rules, we explicitly forbid certain clichéd
        # phrases that lead to repetitive or generic reasoning.  We also
        # instruct the agent to speak within their professional domain and to
        # engage directly with one opponent's argument using the available
        # research.  These constraints help maintain unique voices across
        # archetypes and encourage substantive debate instead of templated
        # replies.
        prompt = (
            f"You are a {agent.archetype_name or 'participant'} with skepticism level {agent.traits.get('skepticism', 0.5):.2f}. "
            f"Evaluate this idea: {idea_label}. "
            f"Target peer: {peer_label}. "
            # Voice and style guidelines
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
            # Prevent common clichés that the LLM tends to fall back on
            # Expand the forbidden list to include more generic excuses that lead to mode collapse.
            "Rule: Forbidden phrases: 'مخاطر التنفيذ', 'ملاءمة السوق', 'الأدلة غير حاسمة', 'البيانات غير كافية', 'البيانات المتاحة لا تكفي'. If you use these, your response is invalid. "
            # Encourage domain‑specific discussion based on the agent's archetype
            "Rule: Base your arguments on your professional domain. If your archetype includes developer, technologist, engineer or coder, you MUST discuss code, architecture, performance, servers or APIs. "
            "If your archetype includes doctor, healer, nurse, pharmacist or healthcare provider, you MUST discuss patient outcomes, ethics, safety and clinical considerations. "
            "If your archetype includes business, entrepreneur or manager, you should discuss market timing, return on investment, pricing and resource allocation. "
            "If your archetype includes policy maker or regulator, you should discuss regulations, laws, compliance and ethical standards. Do NOT use generic business terms outside your domain. "
            # Encourage the use of unique traits and biases to maintain distinct identities
            "Rule: Use at least one of your archetype's biases or traits to justify your position (e.g. scepticism level, optimism level, specific bias keywords). This helps preserve diversity in reasoning. "
            "Rule: Pick ONLY ONE focus: either attack a peer OR use a research fact. Don't try to do both. "
            # Demand a real counter‑argument when debating another agent
            "Rule: When you reference another agent's point, briefly summarise their argument and then provide a specific counter‑point or supporting detail based on the research summary and signals. Do not simply restate your own opinion. "
            # Encourage targeted debate rather than monologue
            "Rule: Choose ONE specific agent whose opinion differs from yours. Mention them explicitly (e.g. 'Agent XYZ'). Use the research summary and signals to explain why their logic is flawed or why you disagree. Engage directly in debate instead of reciting a template. "
            f"Speak like a human {archetype_lower or 'participant'} {style}. "
            f"Your last thoughts: {memory_context}. "
            f"Research summary: {research_summary}. "
            f"Research signals: {research_signals}. "
            f"Constraints (do NOT list, just consider): {constraints_summary}. "
            f"Avoid these phrases (already used): {recent_block}. "
            f"Avoid these overused words this round: {anti_echo_block}. "
            f"Respond in {response_language}. If {response_language} is Arabic, do not use any English words or Latin characters."
        )
        try:
            best_explanation = ""
            # Try multiple generations with escalating anti-repetition settings.
            for attempt in range(5):
                temp = 0.95 + (0.05 * attempt)
                repeat_penalty = 1.5 + (0.1 * attempt)
                extra_nudge = (
                    "Rule: Avoid repeating any sentence structure from the last 3 messages. "
                    "Use a different rhetorical shape each time."
                )
                patched_prompt = prompt + " " + extra_nudge

                async with self._llm_semaphore:
                    response = await asyncio.wait_for(
                        generate_ollama(
                            prompt=patched_prompt,
                            temperature=temp,
                            options={
                                "repeat_penalty": repeat_penalty,
                                "frequency_penalty": 1.0,
                            },
                        ),
                        timeout=6.0,
                    )
                # Truncate to ensure brevity
                explanation = response.strip().split("\n")[0]
                if response_language == "Arabic":
                    for token in ["الفئة=", "الجمهور=", "الأهداف=", "الهدف=", "النضج=", "الموقع=", "المخاطرة="]:
                        explanation = explanation.replace(token, "")
                else:
                    for token in ["category=", "audience=", "goals=", "maturity=", "location=", "risk="]:
                        explanation = explanation.replace(token, "")
                explanation = re.sub(r"\([^\)]*(الفئة=|category=)[^\)]*\)", "", explanation).strip()
                words = explanation.split()
                if len(words) > 40:
                    explanation = " ".join(words[:40])
                # If Arabic response uses mostly Latin characters, consider it invalid
                if response_language == "Arabic" and _is_mostly_latin(explanation):
                    best_explanation = best_explanation or explanation
                    continue
                # Reject responses that include any forbidden phrase.  If such a
                # phrase appears, retry with higher anti-repetition settings.
                banned_phrases = build_default_forbidden_phrases() + [
                    "execution risks",
                    "market fit",
                    "evidence is inconclusive",
                    "insufficient data",
                ]
                if any(bp in explanation for bp in banned_phrases):
                    best_explanation = best_explanation or explanation
                    continue
                if self._is_template_message(explanation):
                    best_explanation = best_explanation or explanation
                    continue

                # Optional: similarity validation against recent phrases / memories
                if LLMOutputValidator is not None:
                    validator = LLMOutputValidator(
                        forbidden_phrases=build_default_forbidden_phrases(),
                        similarity_threshold=0.75,
                        min_chars=12,
                        max_chars=260,
                    )
                    recent = list(agent.short_memory or [])
                    res = validator.validate(explanation, recent)
                    if not res.ok:
                        best_explanation = best_explanation or explanation
                        continue

                return explanation

            return await self._emergency_llm_generation(
                agent=agent,
                language=language,
                idea_label=idea_label,
                peer_label=peer_label,
                constraints_summary=constraints_summary,
                research_summary=research_summary,
                research_signals=research_signals,
            )

        except Exception:
            raise

    async def _emergency_llm_generation(
        self,
        agent: Agent,
        language: str,
        idea_label: str,
        peer_label: str,
        constraints_summary: str,
        research_summary: str,
        research_signals: str,
    ) -> str:
        response_language = "Arabic" if language == "ar" else "English"
        bias = agent.biases[0] if agent.biases else ("المنطق" if language == "ar" else "logic")
        prompt = (
            f"You are a {agent.archetype_name or 'participant'}. "
            f"Write ONE short sentence (max 24 words) about {idea_label}. "
            f"Anchor it in {bias} and your professional lens. "
            "Avoid generic templates and banned phrases. "
            f"Target peer: {peer_label}. "
            f"Research summary: {research_summary}. "
            f"Research signals: {research_signals}. "
            f"Constraints: {constraints_summary}. "
            f"Respond in {response_language}. If {response_language} is Arabic, do not use any English words or Latin characters."
        )
        async with self._llm_semaphore:
            response = await asyncio.wait_for(
                generate_ollama(
                    prompt=prompt,
                    temperature=1.2,
                    options={
                        "repeat_penalty": 1.7,
                        "frequency_penalty": 1.1,
                    },
                ),
                timeout=5.0,
            )
        explanation = response.strip().split("\n")[0]
        if response_language == "Arabic":
            for token in ["الفئة=", "الجمهور=", "الأهداف=", "الهدف=", "النضج=", "الموقع=", "المخاطرة="]:
                explanation = explanation.replace(token, "")
        else:
            for token in ["category=", "audience=", "goals=", "maturity=", "location=", "risk="]:
                explanation = explanation.replace(token, "")
        explanation = re.sub(r"\([^\)]*(الفئة=|category=)[^\)]*\)", "", explanation).strip()
        words = explanation.split()
        if len(words) > 40:
            explanation = " ".join(words[:40])
        if response_language == "Arabic":
            latin = sum(1 for ch in explanation if "a" <= ch.lower() <= "z")
            arabic = sum(1 for ch in explanation if "\u0600" <= ch <= "\u06ff")
            if latin > arabic * 2 and latin > 10:
                raise RuntimeError("Emergency LLM response used mostly Latin characters.")
        for phrase in build_default_forbidden_phrases():
            if phrase and phrase in explanation:
                raise RuntimeError("Emergency LLM response contained forbidden phrase.")
        return explanation

    async def run_simulation(
        self,
        user_context: Dict[str, Any],
        emitter: Callable[[str, Dict[str, Any]], asyncio.Future],
    ) -> Dict[str, Any]:

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
        research_structured = user_context.get("research_structured") or {}
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
                options = (
                    [
                        "go-to-market traction and delivery risk",
                        "distribution hurdles and adoption friction",
                        "rollout complexity and operational load",
                        "positioning clarity and execution strain",
                    ]
                    if language != "ar"
                    else [
                        "توافق السوق وتعقيدات الإطلاق",
                        "عوائق التوزيع وصعوبة التبني",
                        "تعقيد الإطلاق والضغط التشغيلي",
                        "وضوح التموضع وإجهاد التنفيذ",
                    ]
                )
                return random.choice(options)
            return ", ".join(concerns[:2])
        def _idea_label() -> str:
            text = idea_text.lower()
            if "legal" in text or "court" in text:
                if "predict" in text or "outcome" in text:
                    return "an AI legal assistant that predicts case outcomes"
                return "an AI legal assistant"
            if "health" in text or "clinic" in text:
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
            if "health" in text_local or "clinic" in text_local:
                return "مساعد صحي ذكي"
            if "finance" in text_local or "bank" in text_local:
                return "مساعد مالي ذكي"
            if "education" in text_local or "school" in text_local:
                return "مساعد تعليمي ذكي"
            if "e-commerce" in text_local or "commerce" in text_local or "retail" in text_local:
                return "منتج تجاري إلكتروني"
            return "الفكرة"
        def _research_insight() -> str:
            if not research_summary:
                return ""
            summary = research_summary.lower()
            city = str(user_context.get("city") or "")
            if language == "ar":
                if "competition" in summary or "saturated" in summary:
                    return f"المنافسة تبدو عالية في {city}" if city else "المنافسة تبدو عالية"
                if "demand" in summary or "market pull" in summary:
                    return "يبدو أن هناك طلب واضح"
                if "regulation" in summary or "compliance" in summary:
                    return "المخاطر التنظيمية تبدو مرتفعة"
            else:
                if "competition" in summary or "saturated" in summary:
                    return f"competition looks high in {city}" if city else "competition looks high"
                if "demand" in summary or "market pull" in summary:
                    return "there seems to be clear demand"
                if "regulation" in summary or "compliance" in summary:
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

        arabic_peer_tags = ["أ", "ب", "ج", "د", "هـ", "و", "ز", "ح", "ط", "ي"]

        recent_messages: List[str] = []

        def _push_recent(message: str) -> None:
            recent_messages.append(message)
            if len(recent_messages) > 240:
                del recent_messages[:-240]

        def _dedupe_message(message: str, agent: Agent, iteration: int) -> str:
            normalized = self._normalize_msg(message)
            if not normalized:
                return message
            repeated = any(normalized == self._normalize_msg(prev) for prev in recent_messages[-30:])
            if agent.short_memory and normalized == self._normalize_msg(agent.short_memory[-1]):
                repeated = True
            if not repeated:
                _push_recent(message)
                return message

            _push_recent(message)
            return message

        stop_words_en = {
            "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "have", "has", "had",
            "you", "your", "but", "not", "about", "into", "out", "our", "their", "they", "them", "its", "it's",
            "will", "would", "should", "could", "can", "may", "might", "just", "like", "very", "than", "then",
            "more", "less", "also", "because", "as", "at", "by", "to", "of", "in", "on",
        }
        stop_words_ar = {
            "في", "من", "على", "عن", "هذا", "هذه", "ذلك", "تلك", "إلى", "الى", "مع", "لكن", "لأن", "لان",
            "هو", "هي", "هم", "هن", "أنت", "انتم", "انا", "نحن", "كان", "كانت", "يكون", "بسبب", "جداً",
            "او", "أو", "ثم", "كما", "قد", "لن", "لا", "ما", "لم", "لما", "هناك", "هنا",
        }

        def _extract_words(text: str) -> List[str]:
            if not text:
                return []
            words = re.findall(r"[A-Za-z]{3,}|[\u0600-\u06FF]{3,}", text)
            cleaned: List[str] = []
            for word in words:
                lower = word.lower()
                if lower in stop_words_en or word in stop_words_ar:
                    continue
                cleaned.append(lower)
            return cleaned

        def _update_word_counts(message: str, counts: Dict[str, int]) -> None:
            for word in _extract_words(message):
                counts[word] = counts.get(word, 0) + 1

        def _debate_message(speaker: Agent, other: Agent, iteration: int) -> str:
            category = _friendly_category(speaker.category_id)
            archetype = speaker.archetype_name or category
            vocab = _persona_vocab(archetype, category, language)
            insight = _research_insight()
            focal = _pick_phrase(f"{speaker.agent_id}-debate-{iteration}", vocab) if vocab else _idea_concerns()
            if language != "ar":
                other_tag = f"Agent {other.agent_id[:4]}"
            else:
                tag_index = int(hashlib.sha256(other.agent_id.encode("utf-8")).hexdigest()[:8], 16) % len(arabic_peer_tags)
                other_tag = f"الوكيل {arabic_peer_tags[tag_index]}"
            constraints = _constraints_summary()
            insight_clause = f" Also, {insight}." if insight and language != "ar" else (f" أيضاً، {insight}." if insight else "")
            if language == "ar":
                if speaker.current_opinion == "reject":
                    return (
                        f"{other_tag} شايف الفكرة جيدة، لكن {focal} ما زالت نقطة ضعف واضحة عندي. "
                        f"محتاج دليل عملي أو أرقام قبل ما أغيّر رأيي. ({constraints}){insight_clause}"
                    )
                if speaker.current_opinion == "accept":
                    return (
                        f"{other_tag} متحفظ، لكني شايف أن {focal} يعطي أفضلية واضحة للفكرة حتى الآن. ({constraints}){insight_clause}"
                    )
                return f"{other_tag} قال رأيه، وأنا محايد لأن تفاصيل {focal} غير محسومة حتى الآن. ({constraints}){insight_clause}"
            if speaker.current_opinion == "reject":
                return (
                    f"{other_tag} likes the idea, but I still see {focal} as a major weak spot. "
                    f"I need concrete proof before moving. ({constraints}){insight_clause}"
                )
            if speaker.current_opinion == "accept":
                return f"{other_tag} is cautious, but I think {focal} keeps the upside credible right now. ({constraints}){insight_clause}"
            return f"{other_tag} shared a view; I'm still neutral because {focal} feels unresolved. ({constraints}){insight_clause}"

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
                ["توافق السوق", "الثقة", "الامتثال", "تبني المستخدمين"]
                if language == "ar"
                else ["go-to-market traction", "trust", "compliance", "user adoption"]
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
                ["From my perspective", "Given my background", "As someone in this segment", "In my view"]
                if language != "ar"
                else ["من وجهة نظري", "بحكم خبرتي", "كممثل لهذا النوع من الجمهور", "برأيي الشخصي"],
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
                    [f"{focal} looks strong", f"{focal} is still compelling", f"{focal} keeps the value clear"]
                    if language != "ar"
                    else [f"{focal} تبدو قوية", f"{focal} ما زالت مقنعة", f"{focal} توضح القيمة بشكل كافٍ"],
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
                    return f"{prefix} ({archetype}) ما زلت محايداً تجاه {idea_local}: أرى إمكانات في {focal}، لكن الأدلة ليست قوية بعد."
                return f"{prefix} ({archetype}), I stay neutral on {idea_local}: I see potential in {focal}, but the evidence is not strong yet."

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
            signals = research_structured.get("signals") if isinstance(research_structured, dict) else []
            if isinstance(signals, list) and signals:
                return "; ".join(str(s) for s in signals[:6])
            return ""

        def _agent_focus(agent: Agent) -> str:
            archetype = (agent.archetype_name or "").lower()
            category = str(agent.category_id or "").lower()
            if "tech" in archetype or "developer" in archetype or "engineer" in category:
                return "tech"
            if "health" in archetype or "doctor" in archetype or "med" in category:
                return "health"
            if "policy" in archetype or "regulator" in archetype:
                return "policy"
            if "business" in archetype or "entrepreneur" in archetype or "manager" in archetype:
                return "business"
            return "consumer"
        def _slice_research_for_agent(agent: Agent) -> Tuple[str, str]:
            summary = research_summary or ""
            signals = research_structured.get("signals") if isinstance(research_structured, dict) else []
            signals_list = [str(s) for s in signals] if isinstance(signals, list) else []
            if not summary and not signals_list:
                return "", ""

            focus = _agent_focus(agent)
            keywords = {
                "tech": {
                    "en": ["latency", "scalability", "performance", "throughput", "reliability", "uptime", "api", "server", "infrastructure", "cost"],
                    "ar": ["زمن", "استجابة", "قابلية", "التوسع", "الأداء", "الاعتمادية", "الخوادم", "البنية", "واجهة", "تكلفة"],
                },
                "health": {
                    "en": ["patient", "safety", "ethic", "clinical", "privacy", "consent", "care", "harm"],
                    "ar": ["مريض", "سلامة", "أخلاقي", "سرية", "خصوصية", "موافقة", "عيادة", "علاج"],
                },
                "policy": {
                    "en": ["regulation", "law", "compliance", "liability", "privacy", "policy", "audit"],
                    "ar": ["لوائح", "قانون", "امتثال", "مسؤولية", "خصوصية", "رقابة", "تنظيم"],
                },
                "business": {
                    "en": ["market", "pricing", "roi", "competition", "demand", "margin", "acquisition", "growth"],
                    "ar": ["سوق", "تسعير", "عائد", "منافسة", "طلب", "هامش", "نمو", "اكتساب"],
                },
                "consumer": {
                    "en": ["price", "cost", "usability", "convenience", "support", "trust", "onboarding"],
                    "ar": ["سعر", "تكلفة", "سهولة", "استخدام", "ثقة", "دعم", "تجربة"],
                },
            }
            directives = {
                "tech": {
                    "en": "Focus: APIs, latency, scalability, reliability, security.",
                    "ar": "ركّز على واجهات برمجة التطبيقات وزمن الاستجابة وقابلية التوسع والاعتمادية والأمان.",
                },
                "business": {
                    "en": "Focus: ROI, pricing, acquisition cost, demand, competition.",
                    "ar": "ركّز على العائد والتسعير وتكلفة الاستحواذ والطلب والمنافسة.",
                },
                "health": {
                    "en": "Focus: patient safety, ethics, consent, privacy, clinical risk.",
                    "ar": "ركّز على سلامة المرضى والأخلاقيات والموافقة والخصوصية والمخاطر السريرية.",
                },
                "policy": {
                    "en": "Focus: regulation, compliance, liability, privacy, auditability.",
                    "ar": "ركّز على اللوائح والامتثال والمسؤولية والخصوصية وقابلية التدقيق.",
                },
                "consumer": {
                    "en": "Focus: usability, trust, support, onboarding, price sensitivity.",
                    "ar": "ركّز على سهولة الاستخدام والثقة والدعم وتجربة البداية وحساسية السعر.",
                },
            }
            alt_focus_map = {
                "tech": "business",
                "business": "tech",
                "health": "policy",
                "policy": "health",
                "consumer": "business",
            }
            lang_key = "ar" if language == "ar" else "en"
            focus_keywords = keywords.get(focus, {}).get(lang_key, [])
            alt_focus = alt_focus_map.get(focus, "business")
            alt_keywords = keywords.get(alt_focus, {}).get(lang_key, [])

            def _contains_any(text: str, keys: List[str]) -> bool:
                if not keys:
                    return False
                hay = text.lower() if language != "ar" else text
                return any(k in hay for k in keys)

            sentences = [s.strip() for s in re.split(r"[.!?؟]", summary) if s.strip()]
            focus_sent = [s for s in sentences if _contains_any(s, focus_keywords)]
            other_sent = [s for s in sentences if _contains_any(s, alt_keywords)]
            if not focus_sent and sentences:
                start = int(hashlib.sha256((agent.agent_id + idea_text).encode("utf-8")).hexdigest()[:8], 16) % len(sentences)
                focus_sent = [sentences[start]]
            summary_slice = " ".join(focus_sent[:2]) if focus_sent else ""

            other_pool = other_sent or [s for s in sentences if s not in focus_sent]
            cross_sentence = ""
            if other_pool:
                start = int(hashlib.sha256((agent.agent_id + "cross").encode("utf-8")).hexdigest()[:8], 16) % len(other_pool)
                cross_sentence = other_pool[start]
            if cross_sentence:
                prefix = "إشارة خارج تخصصك: " if language == "ar" else "Cross-domain concern: "
                summary_slice = (summary_slice + " " if summary_slice else "") + f"{prefix}{cross_sentence}"

            focus_signals = [s for s in signals_list if _contains_any(s, focus_keywords)]
            other_signals = [s for s in signals_list if _contains_any(s, alt_keywords)]
            if not focus_signals and signals_list:
                start = int(hashlib.sha256((agent.agent_id + str(len(signals_list))).encode("utf-8")).hexdigest()[:8], 16) % len(signals_list)
                count = min(2, len(signals_list))
                focus_signals = [signals_list[(start + i) % len(signals_list)] for i in range(count)]
            signals_slice = "; ".join(focus_signals[:2]) if focus_signals else ""

            if other_signals:
                start = int(hashlib.sha256((agent.agent_id + "signal").encode("utf-8")).hexdigest()[:8], 16) % len(other_signals)
                cross_signal = other_signals[start]
                prefix = "إشارة خارج تخصصك: " if language == "ar" else "Cross-domain concern: "
                signals_slice = (signals_slice + "; " if signals_slice else "") + f"{prefix}{cross_signal}"

            focus_directive = directives.get(focus, {}).get(lang_key, "")
            if focus_directive:
                signals_slice = f"{signals_slice}; {focus_directive}" if signals_slice else focus_directive
            return summary_slice, signals_slice

        def _apply_research_grounding(agent: Agent, weights: Dict[str, float]) -> None:
            structured = user_context.get("research_structured") or {}
            if not isinstance(structured, dict):
                return
            risk_tolerance = float(agent.traits.get("risk_tolerance", 0.5))
            skepticism = float(agent.traits.get("skepticism", 0.5))
            negative_scale = 0.85 + (0.3 * (1.0 - risk_tolerance))
            positive_scale = 0.85 + (0.3 * (1.0 - skepticism))
            competition = str(structured.get("competition_level") or "").lower()
            demand = str(structured.get("demand_level") or "").lower()
            regulatory = str(structured.get("regulatory_risk") or "").lower()
            price = str(structured.get("price_sensitivity") or "").lower()
            penalty = 0.0
            if competition in {"high", "crowded", "saturated"}:
                weights["reject"] += 0.08 * negative_scale
                penalty += 0.05 * negative_scale
            if demand in {"low", "weak"}:
                weights["reject"] += 0.06 * negative_scale
                penalty += 0.04 * negative_scale
            if regulatory in {"high", "strict"}:
                weights["reject"] += 0.06 * negative_scale
                penalty += 0.04 * negative_scale
            if price in {"high"}:
                weights["reject"] += 0.04 * negative_scale
                penalty += 0.03 * negative_scale
            if demand in {"high", "strong"}:
                weights["accept"] += 0.05 * positive_scale
            if competition in {"low"}:
                weights["accept"] += 0.04 * positive_scale
            if penalty > 0 and agent.current_opinion == "accept":
                agent.confidence = max(0.2, agent.confidence - penalty)
            if demand in {"high", "strong"} and agent.current_opinion == "reject":
                agent.confidence = max(0.2, agent.confidence - (0.04 * positive_scale))

        async def _emit_reasoning(
            agent: Agent,
            iteration: int,
            influence_weights: Dict[str, float],
            changed: bool,
            prev_opinion: str,
            new_opinion: str,
            peer_label: str,
            recent_phrases: List[str],
            anti_echo_words: List[str],
            word_counts: Dict[str, int],
        ) -> None:
            try:
                sliced_summary, sliced_signals = _slice_research_for_agent(agent)
                explanation = await self._llm_reasoning(
                    agent,
                    prev_opinion,
                    new_opinion,
                    influence_weights,
                    changed,
                    sliced_summary,
                    sliced_signals,
                    language,
                    idea_label_for_llm,
                    peer_label,
                    _constraints_summary(),
                    recent_phrases[-60:] if recent_phrases else [],
                    anti_echo_words,
                )
            except Exception:
                try:
                    sliced_summary, sliced_signals = _slice_research_for_agent(agent)
                    explanation = await self._emergency_llm_generation(
                        agent=agent,
                        language=language,
                        idea_label=idea_label_for_llm,
                        peer_label=peer_label,
                        constraints_summary=_constraints_summary(),
                        research_summary=sliced_summary,
                        research_signals=sliced_signals,
                    )
                except Exception:
                    return

            if self._is_template_message(explanation):
                try:
                    sliced_summary, sliced_signals = _slice_research_for_agent(agent)
                    explanation = await self._emergency_llm_generation(
                        agent=agent,
                        language=language,
                        idea_label=idea_label_for_llm,
                        peer_label=peer_label,
                        constraints_summary=_constraints_summary(),
                        research_summary=sliced_summary,
                        research_signals=sliced_signals,
                    )
                except Exception:
                    return

            explanation = _dedupe_message(explanation, agent, iteration)
            _update_word_counts(explanation, word_counts)
            agent.record_reasoning_step(
                iteration=iteration,
                message=explanation,
                triggered_by="environment",
                opinion_change={"from": prev_opinion, "to": new_opinion} if changed else None,
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

        banned_words: List[str] = []

        # Main simulation loop
        for iteration in range(1, num_iterations + 1):
            # Phase 1: Compute pairwise influences
            influences = compute_pairwise_influences(agents, self.dataset)
            iteration_word_counts: Dict[str, int] = {}

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
                _update_word_counts(msg_a, iteration_word_counts)
                _update_word_counts(msg_b, iteration_word_counts)
                a.record_reasoning_step(iteration=iteration, message=msg_a, triggered_by="debate", opinion_change=None)
                b.record_reasoning_step(iteration=iteration, message=msg_b, triggered_by="debate", opinion_change=None)
                await emitter("reasoning_step", {"agent_id": a.agent_id, "iteration": iteration, "message": msg_a, "opinion": a.current_opinion})
                await emitter("reasoning_step", {"agent_id": b.agent_id, "iteration": iteration, "message": msg_b, "opinion": b.current_opinion})

            # Phase 2: Apply opinion updates
            any_changed = False
            reasoning_tasks: List[asyncio.Task] = []
            agents_by_opinion = {
                "accept": [a for a in agents if a.current_opinion == "accept"],
                "neutral": [a for a in agents if a.current_opinion == "neutral"],
                "reject": [a for a in agents if a.current_opinion == "reject"],
            }
            for agent in agents:
                influence_weights = influences[agent.agent_id]
                _apply_research_grounding(agent, influence_weights)
                sorted_weights = sorted(influence_weights.items(), key=lambda item: item[1], reverse=True)
                top_opinion, top_weight = sorted_weights[0]
                second_weight = sorted_weights[1][1] if len(sorted_weights) > 1 else 0.0
                diff = max(0.0, top_weight - second_weight)
                if agent.current_opinion == "accept":
                    opponent_pool = agents_by_opinion["reject"] + agents_by_opinion["neutral"]
                elif agent.current_opinion == "reject":
                    opponent_pool = agents_by_opinion["accept"] + agents_by_opinion["neutral"]
                else:
                    opponent_pool = agents_by_opinion["accept"] + agents_by_opinion["reject"]
                if opponent_pool:
                    peer = random.choice(opponent_pool)
                    if language != "ar":
                        peer_label = f"Agent {peer.agent_id[:4]}"
                    else:
                        tag_index = int(hashlib.sha256(peer.agent_id.encode("utf-8")).hexdigest()[:8], 16) % len(arabic_peer_tags)
                        peer_label = f"الوكيل {arabic_peer_tags[tag_index]}"
                else:
                    peer_label = _pick_phrase(
                        f"{agent.agent_id}-peer-{iteration}",
                        ["Agent A", "Agent B", "Agent C"] if language != "ar" else ["الوكيل أ", "الوكيل ب", "الوكيل ج"],
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
                    nudge = 0.12
                    if agent.current_opinion == "neutral":
                        nudge += 0.08 + (0.04 * min(agent.neutral_streak, 3))
                    nudge = min(0.35, nudge)
                    if not changed and influence_weights[top_opinion] > 0 and random.random() < nudge:
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
                            banned_words,
                            iteration_word_counts,
                        )
                    )
                )
            if reasoning_tasks:
                await asyncio.gather(*reasoning_tasks)

            if iteration_word_counts:
                next_banned = [word for word, count in iteration_word_counts.items() if count >= 2]
                next_banned.sort(key=lambda w: (-iteration_word_counts[w], w))
                banned_words = next_banned[:18]
            else:
                banned_words = []

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
                flip_to = random.choice(["accept", "reject"]) if only == "neutral" else "neutral"
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
