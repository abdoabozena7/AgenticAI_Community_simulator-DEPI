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
        self._llm_semaphore = asyncio.Semaphore(1)

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
        reply_to_agent_id: str,
        reply_to_short_id: str,
        reply_to_message: str,
        phase_label: str,
        evidence_cards: List[str],
        role_label: str,
        role_guidance: str,
        constraints_summary: str,
        recent_phrases: List[str],
        avoid_openers: List[str],
    ) -> str:

        traits_desc = ", ".join(f"{k}: {v:.2f}" for k, v in agent.traits.items())
        bias_desc = ", ".join(agent.biases) if agent.biases else "none"
        response_language = "Arabic" if language == "ar" else "English"
        memory_context = " | ".join(agent.short_memory[-6:]) if agent.short_memory else "None"

        def _is_mostly_latin(text: str) -> bool:
            if not text:
                return False
            latin = sum(1 for ch in text if "a" <= ch.lower() <= "z")
            arabic = sum(1 for ch in text if "\u0600" <= ch <= "\u06ff")
            return latin > arabic * 3 and latin > 40

        def _trim_to_limit(text: str, limit: int) -> str:
            if len(text) <= limit:
                return text
            sentences = re.split(r'(?<=[.!؟])\s+', text)
            trimmed = ""
            for sentence in sentences:
                if not sentence:
                    continue
                candidate = f"{trimmed} {sentence}".strip()
                if len(candidate) > limit:
                    break
                trimmed = candidate
            return trimmed if trimmed else text[:limit].rstrip()

        evidence_lines = "\n".join(
            f"[E{i + 1}] {card}" for i, card in enumerate(evidence_cards)
        )
        evidence_ids = [f"E{i + 1}" for i in range(len(evidence_cards))]
        avoid_openers_block = ", ".join(avoid_openers[:6]) if avoid_openers else ""
        reply_snippet = (reply_to_message or "").strip()
        if len(reply_snippet) > 220:
            reply_snippet = reply_snippet[:217].rstrip() + "..."

        prompt = (
            f"You are {role_label}. Phase: {phase_label}. "
            f"Idea: {idea_label}. "
            f"Your traits: {traits_desc}. Biases: {bias_desc}. "
            f"Your last thoughts: {memory_context}. "
            f"Directly reply to agent {reply_to_short_id} and mention {reply_to_short_id} explicitly. "
            f"Agent {reply_to_short_id} said: \"{reply_snippet}\" "
            f"Evidence cards:\n{evidence_lines}\n"
            "Rules: Write 1-3 sentences in Egyptian Arabic. "
            "Rules: Use at least ONE evidence ID (E1..En) exactly in your reply. "
            f"Rules: Stay strictly in your domain: {role_guidance}. "
            "Rules: Arabic is required, but short technical acronyms are allowed (API, ROI, CAC, Backend, GDPR). "
            "Rules: No bullet points, no lists, no quotes, no generic templates. "
            "Rules: Length must be 280-450 characters. "
            f"Rules: Avoid these opener patterns: {avoid_openers_block}. "
            f"Constraints (do not list): {constraints_summary}. "
            f"Recent phrases to avoid: {'; '.join(recent_phrases[-6:]) if recent_phrases else 'None'}."
        )
        try:
            best_explanation = ""
            for attempt in range(5):
                temp = 0.85 + (0.05 * attempt)
                repeat_penalty = 1.3 + (0.1 * attempt)
                seed_value = int(
                    hashlib.sha256(
                        f"{agent.agent_id}:{phase_label}:{reply_to_short_id}:{attempt}".encode("utf-8")
                    ).hexdigest()[:8],
                    16,
                )
                extra_nudge = (
                    "Rule: Open with a fresh, non-repetitive clause and avoid the wordy filler. "
                    "Rule: Make the response feel adversarial or defensive, not neutral."
                )
                patched_prompt = prompt + " " + extra_nudge

                async with self._llm_semaphore:
                    response = await asyncio.wait_for(
                        generate_ollama(
                            prompt=patched_prompt,
                            temperature=temp,
                            seed=seed_value,
                            options={
                                "repeat_penalty": repeat_penalty,
                                "frequency_penalty": 0.9,
                            },
                        ),
                        timeout=7.0,
                    )
                explanation = response.strip()
                explanation = re.sub(r"\([^\)]*(category=|audience=|goals=|maturity=|location=|risk=)\s*[^\)]*\)", "", explanation)
                sentences = re.split(r'(?<=[.!؟])\s+', explanation)
                if len(sentences) > 3:
                    explanation = " ".join(sentences[:3]).strip()
                explanation = _trim_to_limit(explanation, 450)

                if len(explanation) < 280:
                    best_explanation = best_explanation or explanation
                    continue
                if response_language == "Arabic" and _is_mostly_latin(explanation):
                    best_explanation = best_explanation or explanation
                    continue
                if not any(eid in explanation for eid in evidence_ids):
                    best_explanation = best_explanation or explanation
                    continue
                if reply_to_short_id not in explanation:
                    best_explanation = best_explanation or explanation
                    continue
                opener = " ".join(explanation.split()[:4]).lower()
                if opener and opener in avoid_openers:
                    best_explanation = best_explanation or explanation
                    continue
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

                if LLMOutputValidator is not None:
                    validator = LLMOutputValidator(
                        forbidden_phrases=build_default_forbidden_phrases(),
                        similarity_threshold=0.8,
                        min_chars=60,
                        max_chars=480,
                    )
                    recent = list(recent_phrases or []) + list(agent.short_memory or [])
                    res = validator.validate(explanation, recent)
                    if not res.ok:
                        best_explanation = best_explanation or explanation
                        continue

                return explanation

            return await self._emergency_llm_generation(
                agent=agent,
                language=language,
                idea_label=idea_label,
                reply_to_short_id=reply_to_short_id,
                phase_label=phase_label,
                evidence_cards=evidence_cards,
                role_label=role_label,
                role_guidance=role_guidance,
            )

        except Exception:
            raise


    async def _emergency_llm_generation(
        self,
        agent: Agent,
        language: str,
        idea_label: str,
        reply_to_short_id: str,
        phase_label: str,
        evidence_cards: List[str],
        role_label: str,
        role_guidance: str,
    ) -> str:
        response_language = "Arabic" if language == "ar" else "English"
        evidence_lines = "\n".join(
            f"[E{i + 1}] {card}" for i, card in enumerate(evidence_cards)
        )
        evidence_ids = [f"E{i + 1}" for i in range(len(evidence_cards))]
        prompt = (
            f"You are {role_label}. Phase: {phase_label}. Idea: {idea_label}. "
            f"Reply directly to agent {reply_to_short_id} and mention {reply_to_short_id}. "
            "Write 1-2 sentences in Egyptian Arabic. "
            "Use at least one evidence ID (E1..En). "
            f"Stay in your domain: {role_guidance}. "
            "Length 220-420 characters. "
            f"Evidence:\n{evidence_lines}\n"
            f"Respond in {response_language}."
        )
        try:
            async with self._llm_semaphore:
                response = await asyncio.wait_for(
                    generate_ollama(
                        prompt=prompt,
                        temperature=1.1,
                        options={
                            "repeat_penalty": 1.6,
                            "frequency_penalty": 0.9,
                        },
                    ),
                    timeout=5.0,
                )
            explanation = response.strip()
            explanation = explanation[:450].rstrip()
            if response_language == "Arabic":
                latin = sum(1 for ch in explanation if "a" <= ch.lower() <= "z")
                arabic = sum(1 for ch in explanation if "\u0600" <= ch <= "\u06ff")
                if latin > arabic * 3 and latin > 40:
                    raise RuntimeError("Emergency LLM response used mostly Latin characters.")
            if not any(eid in explanation for eid in evidence_ids):
                raise RuntimeError("Emergency LLM response missing evidence id.")
            if reply_to_short_id not in explanation:
                raise RuntimeError("Emergency LLM response missing reply target.")
            for phrase in build_default_forbidden_phrases():
                if phrase and phrase in explanation:
                    raise RuntimeError("Emergency LLM response contained forbidden phrase.")
            return explanation
        except Exception:
            fallback_id = evidence_ids[0] if evidence_ids else "E1"
            return (
                f"Replying to {reply_to_short_id}, I still see this through my lens; "
                f"{fallback_id} keeps my stance steady for now."
            )

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
                "agent_short_id": agent.agent_id[:4],
                "category_id": agent.category_id,
                "template_id": agent.template_id,
                "archetype_name": agent.archetype_name,
                "traits": dict(agent.traits),
                "biases": list(agent.biases),
                "influence_weight": agent.influence_weight,
                "is_leader": agent.is_leader,
                "fixed_opinion": agent.fixed_opinion,
                "initial_opinion": getattr(agent, "initial_opinion", agent.current_opinion),
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

        # Determine number of iterations (phased narrative)
        # Fixed 4-phase dialogue orchestration
        num_iterations = 4

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
            if "employee" in category or "worker" in archetype:
                return "employee"
            return "consumer"


        def _slice_research_for_agent(agent: Agent) -> Tuple[str, str]:
            summary = research_summary or ""
            signals = research_structured.get("signals") if isinstance(research_structured, dict) else []
            signals_list = [str(s) for s in signals] if isinstance(signals, list) else []
            if not summary and not signals_list:
                return "", ""

            focus = _agent_focus(agent)
            keywords = {
                "tech": ["latency", "scalability", "performance", "throughput", "reliability", "uptime", "api", "backend", "server", "security", "infrastructure"],
                "health": ["patient", "safety", "ethic", "clinical", "privacy", "consent", "care", "harm", "mental"],
                "policy": ["regulation", "law", "compliance", "liability", "privacy", "audit", "gdpr"],
                "business": ["market", "pricing", "roi", "competition", "demand", "margin", "acquisition", "growth", "cac"],
                "employee": ["budget", "stability", "workflow", "training", "support", "salary", "workload"],
                "consumer": ["price", "cost", "usability", "convenience", "support", "trust", "onboarding"],
            }
            directives = {
                "tech": "Focus: APIs, backend latency, scalability, reliability, security.",
                "business": "Focus: ROI, CAC, pricing, demand, competition.",
                "health": "Focus: patient safety, ethics, privacy, psychological impact.",
                "policy": "Focus: regulation, compliance, liability, auditability.",
                "employee": "Focus: stability, budget impact, workload, operational friction.",
                "consumer": "Focus: usability, trust, support, onboarding, price sensitivity.",
            }
            focus_keywords = keywords.get(focus, [])

            def _contains_any(text: str, keys: List[str]) -> bool:
                if not keys:
                    return False
                hay = text.lower()
                return any(k in hay for k in keys)

            sentences = [s.strip() for s in re.split(r"[.!?]", summary) if s.strip()]
            focus_sent = [s for s in sentences if _contains_any(s, focus_keywords)]
            if not focus_sent and sentences:
                start = int(hashlib.sha256((agent.agent_id + idea_text).encode("utf-8")).hexdigest()[:8], 16) % len(sentences)
                focus_sent = [sentences[start]]
            summary_slice = " ".join(focus_sent[:2]) if focus_sent else ""

            focus_signals = [s for s in signals_list if _contains_any(s, focus_keywords)]
            if not focus_signals and signals_list:
                start = int(hashlib.sha256((agent.agent_id + str(len(signals_list))).encode("utf-8")).hexdigest()[:8], 16) % len(signals_list)
                count = min(2, len(signals_list))
                focus_signals = [signals_list[(start + i) % len(signals_list)] for i in range(count)]
            signals_slice = "; ".join(focus_signals[:2]) if focus_signals else ""

            focus_directive = directives.get(focus, "")
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

        # Dialogue orchestration (4 phases)
        phase_order = [
            "Information Shock",
            "Polarization Phase",
            "Clash of Values",
            "Resolution Pressure",
        ]

        def _build_evidence_cards() -> List[str]:
            cards: List[str] = []
            raw_cards = user_context.get("evidence_cards") or user_context.get("reports") or []
            if isinstance(raw_cards, list):
                cards.extend([str(c).strip() for c in raw_cards if str(c).strip()])
            elif raw_cards:
                cards.append(str(raw_cards).strip())

            structured = user_context.get("research_structured") or {}
            if isinstance(structured, dict):
                summary = str(structured.get("summary") or "").strip()
                if summary:
                    for sentence in re.split(r"[.!?]", summary):
                        sentence = sentence.strip()
                        if len(sentence) > 12:
                            cards.append(sentence)
                signals = structured.get("signals") or []
                if isinstance(signals, list):
                    cards.extend([str(s).strip() for s in signals if str(s).strip()])
                for key in ("competition_level", "demand_level", "regulatory_risk", "price_sensitivity"):
                    value = structured.get(key)
                    if value:
                        cards.append(f"{key.replace('_', ' ')}: {value}")

            if research_summary:
                for sentence in re.split(r"[.!?]", research_summary):
                    sentence = sentence.strip()
                    if len(sentence) > 12:
                        cards.append(sentence)

            if not cards:
                cards = [
                    "Market signals show mixed demand and adoption friction.",
                    "Privacy concerns remain unresolved across early feedback.",
                    "Operational rollout appears complex for current infrastructure.",
                    "Pricing sensitivity could affect early uptake in key segments.",
                ]

            seen = set()
            unique_cards = []
            for card in cards:
                if card and card not in seen:
                    seen.add(card)
                    unique_cards.append(card)
            return unique_cards[:8]

        evidence_cards = _build_evidence_cards()

        role_guidance_map = {
            "tech": "architecture, latency, security, backend, APIs",
            "business": "ROI, CAC, market demand, pricing, competition",
            "employee": "stability, budget impact, workload, operational friction",
            "health": "ethics, privacy, patient safety, psychological impact",
            "policy": "law, compliance, regulatory risk, auditability",
            "consumer": "trust, usability, cost-to-value, support",
        }
        role_keywords = {
            "tech": ["latency", "scalability", "performance", "api", "backend", "server", "security"],
            "business": ["roi", "cac", "market", "pricing", "competition", "demand", "margin", "revenue"],
            "employee": ["budget", "stability", "workflow", "training", "salary", "workload"],
            "health": ["ethic", "privacy", "patient", "safety", "clinical", "harm", "mental"],
            "policy": ["law", "regulation", "compliance", "liability", "gdpr", "audit"],
            "consumer": ["price", "cost", "usability", "trust", "support", "onboarding"],
        }
        role_fallback_evidence = {
            "tech": [
                "Engineering memo flags backend latency spikes under peak usage.",
                "Security review notes gaps in API audit trails.",
            ],
            "business": [
                "Market brief highlights ROI sensitivity tied to CAC growth.",
                "Competitive scan shows crowded positioning at current pricing.",
            ],
            "employee": [
                "Internal notes highlight training load and workflow disruption.",
                "Operational feedback flags budget constraints for rollout support.",
            ],
            "health": [
                "Ethics note raises concerns about privacy and patient consent.",
                "Clinical feedback points to psychological stress risks.",
            ],
            "policy": [
                "Compliance memo stresses regulatory exposure and auditability gaps.",
                "Legal review warns about liability if safeguards are unclear.",
            ],
            "consumer": [
                "User feedback mentions trust barriers and onboarding friction.",
                "Support notes show anxiety about transparency and control.",
            ],
        }

        def _role_for_agent(agent: Agent) -> Tuple[str, str, str]:
            archetype = agent.archetype_name or agent.category_id or "Participant"
            archetype_lower = archetype.lower()
            category = (agent.category_id or "").lower()
            bias_text = " ".join(agent.biases).lower()
            if "regulation" in bias_text or "compliance" in bias_text or "policy" in archetype_lower:
                role_key = "policy"
            elif "engineer" in category or "tech" in archetype_lower or "developer" in archetype_lower:
                role_key = "tech"
            elif "doctor" in category or "health" in archetype_lower:
                role_key = "health"
            elif "business" in category or "entrepreneur" in archetype_lower:
                role_key = "business"
            elif "employee" in category or "worker" in archetype_lower:
                role_key = "employee"
            else:
                role_key = "consumer"
            label = archetype
            if role_key == "policy" and "Policy" not in label:
                label = f"{label} (Policy Guardian)" if label else "Policy Guardian"
            guidance = role_guidance_map.get(role_key, role_guidance_map["consumer"])
            return role_key, label, guidance

        agent_roles: Dict[str, Tuple[str, str, str]] = {}
        role_buckets: Dict[str, List[Agent]] = {k: [] for k in role_guidance_map.keys()}
        for agent in agents:
            role_key, role_label, role_guidance = _role_for_agent(agent)
            agent_roles[agent.agent_id] = (role_key, role_label, role_guidance)
            role_buckets.setdefault(role_key, []).append(agent)

        role_rotations = {k: 0 for k in role_buckets.keys()}

        def _pick_role_agent(role: str) -> Agent:
            pool = role_buckets.get(role) or agents
            if not pool:
                return random.choice(agents)
            idx = role_rotations.get(role, 0) % len(pool)
            role_rotations[role] = role_rotations.get(role, 0) + 1
            return pool[idx]

        def _select_speakers(count: int) -> List[Agent]:
            selected: List[Agent] = []
            priority_roles = ["tech", "business", "employee", "health", "policy"]
            for role in priority_roles:
                if len(selected) >= count:
                    break
                if role_buckets.get(role):
                    candidate = _pick_role_agent(role)
                    if candidate not in selected:
                        selected.append(candidate)
            available_roles = [r for r in priority_roles if role_buckets.get(r)] or list(role_buckets.keys())
            while len(selected) < count and len(selected) < len(agents):
                role = random.choice(available_roles) if available_roles else None
                candidate = _pick_role_agent(role) if role else random.choice(agents)
                if candidate not in selected:
                    selected.append(candidate)
            return selected

        def _build_role_evidence(cards: List[str]) -> Dict[str, List[str]]:
            evidence_by_role = {k: [] for k in role_guidance_map.keys()}
            general: List[str] = []
            for card in cards:
                low = card.lower()
                matched = False
                for role, keys in role_keywords.items():
                    if any(k in low for k in keys):
                        evidence_by_role[role].append(card)
                        matched = True
                if not matched:
                    general.append(card)

            def _dedupe(items: List[str]) -> List[str]:
                seen = set()
                out: List[str] = []
                for item in items:
                    if item and item not in seen:
                        seen.add(item)
                        out.append(item)
                return out

            for role in evidence_by_role:
                combined = evidence_by_role[role] + general
                if len(combined) < 3:
                    combined += role_fallback_evidence.get(role, role_fallback_evidence["consumer"])
                evidence_by_role[role] = _dedupe(combined)[:6]
            return evidence_by_role

        evidence_by_role = _build_role_evidence(evidence_cards)
        used_openers: set[str] = set()
        dialogue_history: List[Dict[str, Any]] = []

        def _pick_reply_target(speaker: Agent) -> Tuple[str, str, str]:
            candidates = [h for h in dialogue_history if h.get("agent_id") != speaker.agent_id]
            if candidates:
                diff = [c for c in candidates if c.get("opinion") != speaker.current_opinion]
                target = diff[-1] if diff else candidates[-1]
                return target["agent_id"], target["short_id"], target["message"]
            others = [a for a in agents if a.agent_id != speaker.agent_id]
            fallback = random.choice(others) if others else speaker
            fallback_msg = evidence_cards[0] if evidence_cards else "prior note"
            return fallback.agent_id, fallback.agent_id[:4], fallback_msg

        total_iterations = len(phase_order)
        for iteration, phase_label in enumerate(phase_order, start=1):
            phase_intensity = 0.85 + (0.1 * iteration)
            influences = compute_pairwise_influences(agents, self.dataset)
            opinion_changes: Dict[str, Tuple[str, str, bool]] = {}
            for agent in agents:
                influence_weights = influences[agent.agent_id]
                _apply_research_grounding(agent, influence_weights)
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
                        phase_intensity=phase_intensity,
                    )
                agent.current_opinion = new_opinion
                if changed:
                    agent.confidence = max(0.25, agent.confidence - 0.08)
                else:
                    if new_opinion == "neutral":
                        agent.confidence = max(0.2, agent.confidence - 0.03)
                    else:
                        agent.confidence = min(1.0, agent.confidence + 0.03)
                opinion_changes[agent.agent_id] = (prev_opinion, new_opinion, changed)

            speakers = _select_speakers(7)
            for speaker in speakers:
                prev_opinion, new_opinion, changed = opinion_changes[speaker.agent_id]
                role_key, role_label, role_guidance = agent_roles[speaker.agent_id]
                reply_to_id, reply_to_short, reply_to_msg = _pick_reply_target(speaker)
                sliced_summary, sliced_signals = _slice_research_for_agent(speaker)
                evidence_pool = evidence_by_role.get(role_key) or evidence_cards
                explanation = await self._llm_reasoning(
                    agent=speaker,
                    prev_opinion=prev_opinion,
                    new_opinion=new_opinion,
                    influence_weights=influences[speaker.agent_id],
                    changed=changed,
                    research_summary=sliced_summary,
                    research_signals=sliced_signals,
                    language=language,
                    idea_label=idea_label_for_llm,
                    reply_to_agent_id=reply_to_id,
                    reply_to_short_id=reply_to_short,
                    reply_to_message=reply_to_msg,
                    phase_label=phase_label,
                    evidence_cards=evidence_pool,
                    role_label=role_label,
                    role_guidance=role_guidance,
                    constraints_summary=_constraints_summary(),
                    recent_phrases=recent_messages,
                    avoid_openers=list(used_openers),
                )

                opener = " ".join(explanation.split()[:4]).lower()
                if opener:
                    used_openers.add(opener)
                recent_messages.append(explanation)
                if len(recent_messages) > 200:
                    del recent_messages[:-200]

                speaker.record_reasoning_step(
                    iteration=iteration,
                    message=explanation,
                    triggered_by="phase_dialogue",
                    phase=phase_label,
                    reply_to_agent_id=reply_to_id,
                    opinion_change={"from": prev_opinion, "to": new_opinion} if changed else None,
                )
                await emitter(
                    "reasoning_step",
                    {
                        "agent_id": speaker.agent_id,
                        "agent_short_id": speaker.agent_id[:4],
                        "archetype": role_label,
                        "iteration": iteration,
                        "phase": phase_label,
                        "reply_to_agent_id": reply_to_id,
                        "message": explanation,
                        "opinion": speaker.current_opinion,
                    },
                )
                dialogue_history.append(
                    {
                        "agent_id": speaker.agent_id,
                        "short_id": speaker.agent_id[:4],
                        "message": explanation,
                        "opinion": speaker.current_opinion,
                    }
                )
                await asyncio.sleep(0.2 / speed)

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
                    "total_iterations": total_iterations,
                },
            )
            await emitter(
                "agents",
                {
                    "iteration": iteration,
                    "total_agents": len(agents),
                    "agents": [_agent_snapshot(agent) for agent in agents],
                },
            )
            await asyncio.sleep(0.2 / speed)

        # After all iterations, compute final metrics
        final_metrics = compute_metrics(agents)
        return final_metrics
