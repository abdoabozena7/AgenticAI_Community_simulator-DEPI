# creates agents from the dataset, executes a specified number of

from __future__ import annotations

import asyncio
import base64
import json
import hashlib
import pickle
import math
import random
import re
import os
import uuid
import time
from collections import Counter, deque
from typing import Callable, Dict, List, Any, Tuple, Optional

from ..core.dataset_loader import Dataset
from ..models.schemas import ReasoningStep
from .agent import Agent
from .influence import compute_pairwise_influences, decide_opinion_change
from .aggregator import compute_metrics
from ..core.ollama_client import generate_ollama
from ..core.text_encoding_guard import attempt_repair, detect_mojibake
try:
    from .llm_output_validator import LLMOutputValidator, build_default_forbidden_phrases
except Exception:  # validator is optional
    LLMOutputValidator = None  # type: ignore
    build_default_forbidden_phrases = lambda: []  # type: ignore



class ClarificationNeeded(RuntimeError):
    """Raised when the orchestrator needs a user clarification before continuing."""

    def __init__(self, payload: Dict[str, Any]) -> None:
        message = str(payload.get("reason_summary") or "Clarification is required before resuming.")
        super().__init__(message)
        self.payload = payload


class SimulationEngine:
    """Driver for executing social simulations.

    Each simulation run spawns a set of agents derived from the dataset and
    carries out multiple iterations of pairwise influence. The engine
    communicates progress through an event emitter callback which
    delivers reasoning steps and metrics updates to the caller.
    """

    def __init__(self, dataset: Dataset) -> None:
        self.dataset = dataset
        try:
            concurrency = int(os.getenv("LLM_CONCURRENCY", "1"))
        except ValueError:
            concurrency = 1
        self._llm_semaphore = asyncio.Semaphore(max(1, concurrency))
        self._llm_timeout = float(os.getenv("LLM_REASONING_TIMEOUT", "15.0"))

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

    @staticmethod
    def _serialize_random_state(state: object) -> str:
        try:
            raw = pickle.dumps(state)
            return base64.b64encode(raw).decode("ascii")
        except Exception:
            return ""

    @staticmethod
    def _deserialize_random_state(payload: Any) -> Optional[object]:
        if not payload or not isinstance(payload, str):
            return None
        try:
            raw = base64.b64decode(payload.encode("ascii"))
            return pickle.loads(raw)
        except Exception:
            return None

    @staticmethod
    def _serialize_reasoning_step(step: ReasoningStep) -> Dict[str, Any]:
        data = step.model_dump() if hasattr(step, "model_dump") else {}
        if not isinstance(data, dict):
            return {}
        return data

    def _serialize_agent_runtime(self, agent: Agent) -> Dict[str, Any]:
        return {
            "agent_id": agent.agent_id,
            "category_id": agent.category_id,
            "template_id": agent.template_id,
            "archetype_name": agent.archetype_name,
            "traits": dict(agent.traits),
            "biases": list(agent.biases),
            "base_influence_weight": float(getattr(agent, "base_influence_weight", 1.0)),
            "influence_weight": float(agent.influence_weight),
            "is_leader": bool(agent.is_leader),
            "fixed_opinion": agent.fixed_opinion,
            "initial_opinion": getattr(agent, "initial_opinion", agent.current_opinion),
            "current_opinion": agent.current_opinion,
            "confidence": float(agent.confidence),
            "stubbornness": float(getattr(agent, "stubbornness", 0.4)),
            "neutral_streak": int(getattr(agent, "neutral_streak", 0)),
            "short_memory": list(agent.short_memory[-Agent.SHORT_MEMORY_SIZE:]),
            "history": [self._serialize_reasoning_step(step) for step in (agent.history or [])][-Agent.MAX_HISTORY:],
        }

    def _restore_agents(self, payload: Any) -> List[Agent]:
        if not isinstance(payload, list):
            return []
        restored: List[Agent] = []
        for raw in payload:
            if not isinstance(raw, dict):
                continue
            category_id = str(raw.get("category_id") or "")
            template_id = str(raw.get("template_id") or "")
            template = self.dataset.template_by_id.get(template_id)
            if template is None:
                category_templates = self.dataset.templates_by_category.get(category_id) or []
                template = category_templates[0] if category_templates else None
            category = self.dataset.category_by_id.get(category_id or (template.category_id if template else ""))
            if template is None or category is None:
                continue
            initial_opinion = str(raw.get("initial_opinion") or raw.get("current_opinion") or "neutral")
            agent = Agent(template=template, category=category, initial_opinion=initial_opinion)
            agent_id = str(raw.get("agent_id") or "").strip()
            if agent_id:
                agent.agent_id = agent_id
            agent.archetype_name = str(raw.get("archetype_name") or agent.archetype_name)
            traits_raw = raw.get("traits")
            if isinstance(traits_raw, dict):
                merged_traits: Dict[str, float] = {}
                for key, value in traits_raw.items():
                    try:
                        merged_traits[str(key)] = float(value)
                    except Exception:
                        continue
                if merged_traits:
                    agent.traits = merged_traits
            biases_raw = raw.get("biases")
            if isinstance(biases_raw, list):
                agent.biases = [str(item) for item in biases_raw if str(item).strip()]
            try:
                agent.base_influence_weight = float(raw.get("base_influence_weight") or category.base_influence_weight)
            except Exception:
                agent.base_influence_weight = category.base_influence_weight
            try:
                agent.influence_weight = float(raw.get("influence_weight") or agent.influence_weight)
            except Exception:
                pass
            agent.is_leader = bool(raw.get("is_leader"))
            fixed = str(raw.get("fixed_opinion") or "").strip().lower()
            agent.fixed_opinion = fixed if fixed in Agent.VALID_OPINIONS else None
            current = str(raw.get("current_opinion") or initial_opinion).strip().lower()
            agent.current_opinion = current if current in Agent.VALID_OPINIONS else "neutral"
            init = str(raw.get("initial_opinion") or initial_opinion).strip().lower()
            agent.initial_opinion = init if init in Agent.VALID_OPINIONS else agent.current_opinion
            try:
                agent.confidence = float(raw.get("confidence") or agent.confidence)
            except Exception:
                pass
            try:
                agent.stubbornness = float(raw.get("stubbornness") or agent.stubbornness)
            except Exception:
                pass
            try:
                agent.neutral_streak = int(raw.get("neutral_streak") or 0)
            except Exception:
                agent.neutral_streak = 0
            short_memory = raw.get("short_memory")
            if isinstance(short_memory, list):
                agent.short_memory = [str(item) for item in short_memory if str(item).strip()][-Agent.SHORT_MEMORY_SIZE:]
            history_raw = raw.get("history")
            if isinstance(history_raw, list):
                rebuilt: List[ReasoningStep] = []
                for item in history_raw[-Agent.MAX_HISTORY:]:
                    if not isinstance(item, dict):
                        continue
                    try:
                        rebuilt.append(ReasoningStep(**item))
                    except Exception:
                        continue
                agent.history = rebuilt
            restored.append(agent)
        return restored

    @staticmethod
    def _serialize_task(task: Dict[str, Any]) -> Dict[str, Any]:
        agent = task.get("agent")
        return {
            "agent_id": getattr(agent, "agent_id", ""),
            "prev_opinion": task.get("prev_opinion"),
            "math_opinion": task.get("math_opinion"),
            "changed": bool(task.get("changed")),
            "role_label": task.get("role_label"),
            "phase_label": task.get("phase_label"),
            "role_guidance": task.get("role_guidance"),
            "traits_summary": task.get("traits_summary"),
            "bias_summary": task.get("bias_summary"),
            "reply_to_id": task.get("reply_to_id"),
            "reply_to_short": task.get("reply_to_short"),
            "reply_to_message": task.get("reply_to_message"),
            "length_mode": task.get("length_mode"),
            "emit_message": bool(task.get("emit_message")),
            "evidence_hint": task.get("evidence_hint"),
            "evidence_hints": task.get("evidence_hints") or [],
        }


    def _validate_llm_response(
        self,
        explanation: str,
        language: str,
        reply_to_short_id: str,
        evidence_ids: List[str],
        requires_evidence: bool,
        avoid_openers: List[str],
        recent_phrases: List[str],
    ) -> Tuple[bool, str]:
        text = explanation.strip()
        if not text:
            return False, "empty"
        # Keep this permissive enough that we don't end up with "no reasoning",
        # while still blocking ultra-short generic replies.
        if len(text) < 40 or len(text) > 800:
            return False, "length"
        opener = " ".join(text.split()[:4]).lower()
        if opener and opener in avoid_openers:
            return False, "reused opener"
        words = re.findall(r"[A-Za-z\u0600-\u06FF]+", text.lower())
        if words and len(words) >= 10:
            unique_ratio = len(set(words)) / max(1, len(words))
            if unique_ratio < 0.25:
                return False, "low diversity"
        # Do not hard-fail for missing reply tag or evidence id; prefer generating reasoning.

        banned_phrases = build_default_forbidden_phrases() + [
            "execution risks",
            "market fit",
            "evidence is inconclusive",
            "insufficient data",
        ]
        lowered = text.lower()
        if any(bp and str(bp).lower() in lowered for bp in banned_phrases):
            return False, "banned phrase"
        if language == "ar":
            latin = sum(1 for ch in text if "a" <= ch.lower() <= "z")
            arabic = sum(1 for ch in text if "\u0600" <= ch <= "\u06ff")
            if latin > arabic * 2 and latin > 40:
                return False, "mostly latin"
        return True, "ok"



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
        debug_emitter: Callable[[str, Dict[str, Any]], Any] | None = None,
    ) -> str | None:

        traits_desc = ", ".join(f"{k}: {v:.2f}" for k, v in agent.traits.items())
        bias_desc = ", ".join(agent.biases) if agent.biases else "none"
        debug = os.getenv("LLM_REASONING_DEBUG", "false").strip().lower() in {"1", "true", "yes", "on"}
        debug_stream = os.getenv("LLM_REASONING_DEBUG_STREAM", "false").strip().lower() in {"1", "true", "yes", "on"}
        memory_context = " | ".join(agent.short_memory[-6:]) if agent.short_memory else "None"

        async def _emit_debug(reason: str, stage: str, attempt: int | None = None) -> None:
            if not debug_stream or debug_emitter is None:
                return
            payload = {
                "agent_id": agent.agent_id,
                "agent_short_id": agent.agent_id[:4],
                "phase": phase_label,
                "attempt": attempt,
                "stage": stage,
                "reason": reason,
            }
            try:
                await debug_emitter("reasoning_debug", payload)
            except Exception:
                return

        def _clip(value: str, limit: int) -> str:
            value = re.sub(r"\s+", " ", (value or "").strip())
            if len(value) <= limit:
                return value
            return value[: max(0, limit - 3)].rstrip() + "..."

        def _fallback_reasoning(reason_hint: str | None = None) -> str:
            snippet_source = research_summary or research_signals or ""
            snippet = _clip(snippet_source, 160) if snippet_source else ""
            if language == "ar":
                if new_opinion == "reject":
                    base = f"ط¸â€¦ط¸â€  ط¸ث†ط·آ¬ط¸â€،ط·آ© ط¸â€ ط·آ¸ط·آ±ط¸ظ¹ ط¸ئ’ط¸â‚¬{role_label} ط·آ§ط¸â€‍ط¸ظ¾ط¸ئ’ط·آ±ط·آ© ط·آ¯ط¸ظ¹ ط¸â€¦ط·آ´ ط¸â€¦ط¸â€ ط·آ§ط·آ³ط·آ¨ط·آ© ط¸ث†ط¸â€¦ط·آ®ط·آ§ط·آ·ط·آ±ط¸â€،ط·آ§ ط¸ث†ط·آ§ط·آ¶ط·آ­ط·آ©."
                elif new_opinion == "accept":
                    base = f"ط¸â€¦ط¸â€  ط¸ث†ط·آ¬ط¸â€،ط·آ© ط¸â€ ط·آ¸ط·آ±ط¸ظ¹ ط¸ئ’ط¸â‚¬{role_label} ط·آ§ط¸â€‍ط¸ظ¾ط¸ئ’ط·آ±ط·آ© ط·آ¯ط¸ظ¹ ط¸â€¦ط¸â€¦ط¸ئ’ط¸â€  ط·ع¾ط¸â€ ط·آ¬ط·آ­ ط¸â€‍ط¸ث† ط·آ§ط·ع¾ط¸â€ ط¸ظ¾ط·آ°ط·ع¾ ط·آµط·آ­."
                else:
                    base = f"ط¸â€¦ط¸â€  ط¸ث†ط·آ¬ط¸â€،ط·آ© ط¸â€ ط·آ¸ط·آ±ط¸ظ¹ ط¸ئ’ط¸â‚¬{role_label} ط·آ£ط¸â€ ط·آ§ ط¸â€¦ط·ع¾ط·آ±ط·آ¯ط·آ¯ ط¸ث†ط¸â€‍ط·آ³ط¸â€، ط¸â€¦ط·آ­ط·ع¾ط·آ§ط·آ¬ ط·ع¾ط¸ث†ط·آ¶ط¸ظ¹ط·آ­."
                if snippet:
                    base += f" ط·آ§ط¸â€‍ط¸â€¦ط·آ¤ط·آ´ط·آ±ط·آ§ط·ع¾: {snippet}"
                if reason_hint and debug:
                    base += f" [{reason_hint}]"
                return _clip(base, 420)
            else:
                if new_opinion == "reject":
                    base = f"As {role_label}, I donأ¢â‚¬â„¢t think this idea is viable and the risks are clear."
                elif new_opinion == "accept":
                    base = f"As {role_label}, this idea could work if executed carefully."
                else:
                    base = f"As {role_label}, Iأ¢â‚¬â„¢m on the fence and need more clarity."
                if snippet:
                    base += f" Signals: {snippet}"
                if reason_hint and debug:
                    base += f" [{reason_hint}]"
                return _clip(base, 420)

        def _trim_to_limit(text: str, limit: int) -> str:
            if len(text) <= limit:
                return text
            sentences = re.split(r"(?<=[.!?ط·ع؛])\s+", text)
            trimmed = ""
            for sentence in sentences:
                if not sentence:
                    continue
                candidate = f"{trimmed} {sentence}".strip()
                if len(candidate) > limit:
                    break
                trimmed = candidate
            return trimmed if trimmed else text[:limit].rstrip()

        cleaned_cards: List[str] = []
        for card in (evidence_cards or []):
            clipped = _clip(str(card), 220)
            if clipped:
                cleaned_cards.append(clipped)
        evidence_cards = cleaned_cards[:6]

        evidence_lines = "\n".join(f"[E{i + 1}] {card}" for i, card in enumerate(evidence_cards))
        evidence_ids = [f"E{i + 1}" for i in range(len(evidence_cards))]
        requires_evidence = len(evidence_ids) > 0
        avoid_openers_block = ", ".join(avoid_openers[:6]) if avoid_openers else ""
        reply_snippet = _clip(reply_to_message or "", 220)
        research_summary = _clip(research_summary or "", 520)
        research_signals = _clip(research_signals or "", 360)
        constraints_summary = _clip(constraints_summary or "", 260)

        if language == "ar":
            opinion_map = {"accept": "ط¸â€ڑط·آ¨ط¸ث†ط¸â€‍", "reject": "ط·آ±ط¸ظ¾ط·آ¶", "neutral": "ط¸â€¦ط·آ­ط·آ§ط¸ظ¹ط·آ¯"}
            prev_label = opinion_map.get(prev_opinion, "ط¸â€¦ط·آ­ط·آ§ط¸ظ¹ط·آ¯")
            new_label = opinion_map.get(new_opinion, "ط¸â€¦ط·آ­ط·آ§ط¸ظ¹ط·آ¯")
            changed_label = "ط¸â€ ط·آ¹ط¸â€¦" if changed else "ط¸â€‍ط·آ§"
        else:
            prev_label = prev_opinion
            new_label = new_opinion
            changed_label = "yes" if changed else "no"

        human_guardrail = (
            "SYSTEM: You are {role_label}, a real person living in a society, not a data-processing bot. "
            "CRITICAL: Respond like a human, not a template. Use your instincts and be blunt if the idea feels harmful or unethical.\n"
            "TASK: Evaluate '{idea_label}' based on your traits ({traits_desc}) and your human judgment.\n"
            "STANCE: Your internal stance is {new_label}. Justify it clearly.\n"
            "RULES:\n"
            "- Use raw, blunt Egyptian Arabic (Egyptian Slang).\n"
            "- No lists, no polite boilerplate.\n"
            "- Talk like a person who just heard this news in a cafe and is reacting to it."
        ).format(role_label=role_label, idea_label=idea_label, traits_desc=traits_desc, new_label=new_label)

        recent_avoid = "; ".join(_clip(p, 120) for p in (recent_phrases or [])[-6:]) if recent_phrases else ""
        evidence_rule = ""
        if requires_evidence and evidence_ids:
            evidence_rule = evidence_ids[0]

        if language == "ar":
            prompt_lines = [
                human_guardrail,
                f"ط·آ£ط¸â€ ط·ع¾ {role_label}. ط·آ§ط¸â€‍ط¸â€¦ط·آ±ط·آ­ط¸â€‍ط·آ©: {phase_label}.",
                f"ط·آ§ط¸â€‍ط¸ظ¾ط¸ئ’ط·آ±ط·آ©: {idea_label}.",
                f"ط¸â€¦ط¸ث†ط¸â€ڑط¸ظ¾ط¸ئ’ ط·آ§ط¸â€‍ط·آ­ط·آ§ط¸â€‍ط¸ظ¹: {new_label} (ط¸ئ’ط·آ§ط¸â€ : {prev_label}ط·إ’ ط·ع¾ط·ط›ط¸ظ¹ط¸â€کط·آ±: {changed_label}).",
                f"ط·آ³ط¸â€¦ط·آ§ط·ع¾ط¸ئ’: {traits_desc}. ط·ع¾ط·آ­ط¸ظ¹ط·آ²ط·آ§ط·ع¾ط¸ئ’: {bias_desc}.",
                f"ط·آ¢ط·آ®ط·آ± ط·آ£ط¸ظ¾ط¸ئ’ط·آ§ط·آ±ط¸ئ’: {memory_context}.",
                f"ط·آ´ط·آ±ط¸ظ¹ط·آ­ط·ع¾ط¸ئ’ ط¸â€¦ط¸â€  ط·آ§ط¸â€‍ط·آ¨ط·آ­ط·آ« ط¸ظ¾ط¸â€ڑط·آ·: {research_summary or 'أ¢â‚¬â€‌'}",
                f"ط·آ¥ط·آ´ط·آ§ط·آ±ط·آ§ط·ع¾: {research_signals or 'أ¢â‚¬â€‌'}",
                f"ط·آ¨ط·آ·ط·آ§ط¸â€ڑط·آ§ط·ع¾ ط·آ§ط¸â€‍ط·آ£ط·آ¯ط¸â€‍ط·آ©:\n{evidence_lines or 'أ¢â‚¬â€‌'}",
                *(
                    [
                        f"ط·آ±ط·آ¯ ط¸â€¦ط·آ¨ط·آ§ط·آ´ط·آ±ط·آ© ط·آ¹ط¸â€‍ط¸â€° {reply_to_short_id} ط¸ث†ط·آ§ط·آ°ط¸ئ’ط·آ± {reply_to_short_id} ط·آ­ط·آ±ط¸ظ¾ط¸ظ¹ط¸â€¹ط·آ§ ط·آ¯ط·آ§ط·آ®ط¸â€‍ ط·آ§ط¸â€‍ط·آ±ط·آ¯.",
                        f"ط·آ±ط·آ³ط·آ§ط¸â€‍ط·آ© {reply_to_short_id}: \"{reply_snippet}\"",
                    ]
                    if reply_to_short_id
                    else []
                ),
                "ط¸â€ڑط¸ث†ط·آ§ط·آ¹ط·آ¯ ط·آµط·آ§ط·آ±ط¸â€¦ط·آ©:",
                "- ط·آ§ط¸ئ’ط·ع¾ط·آ¨ 1-3 ط·آ¬ط¸â€¦ط¸â€‍ ط·آ¨ط·آ§ط¸â€‍ط¸â€‍ط¸â€،ط·آ¬ط·آ© ط·آ§ط¸â€‍ط¸â€¦ط·آµط·آ±ط¸ظ¹ط·آ©.",
                "- ط¸â€¦ط¸â€¦ط¸â€ ط¸ث†ط·آ¹ ط·آ§ط¸â€‍ط¸â€ڑط¸ث†ط·آ§ط·آ¦ط¸â€¦/ط·آ§ط¸â€‍ط¸â€ ط¸â€ڑط·آ§ط·آ·/ط·آ§ط¸â€‍ط·آ§ط¸â€ڑط·ع¾ط·آ¨ط·آ§ط·آ³ط·آ§ط·ع¾.",
                "- ط¸â€‍ط·آ§ ط·ع¾ط·آ³ط·ع¾ط·آ®ط·آ¯ط¸â€¦ ط¸ئ’ط¸â€‍ط·آ§ط¸â€¦ ط·آ¹ط·آ§ط¸â€¦ ط·آ£ط¸ث† ط·آ¹ط·آ¨ط·آ§ط·آ±ط·آ§ط·ع¾ ط¸â€¦ط·آ­ط¸ظ¾ط¸ث†ط·آ¸ط·آ©.",
                f"- ط·آ§ط¸â€‍ط·ع¾ط·آ²ط¸â€¦ ط·آ¨ط¸â€¦ط·آ¬ط·آ§ط¸â€‍ط¸ئ’: {role_guidance}.",
                "- ط·آ§ط·آ¬ط·آ¹ط¸â€‍ ط¸â€¦ط¸ث†ط¸â€ڑط¸ظ¾ط¸ئ’ ط¸ث†ط·آ§ط·آ¶ط·آ­ط¸â€¹ط·آ§ ط¸ث†ط·آ§ط·آ°ط¸ئ’ط·آ± ط·آ³ط·آ¨ط·آ¨ ط¸â€¦ط·آ­ط·آ¯ط·آ¯ ط¸â€¦ط·آ±ط·ع¾ط·آ¨ط·آ· ط·آ¨ط·آ§ط¸â€‍ط·آ´ط·آ±ط¸ظ¹ط·آ­ط·آ©/ط·آ§ط¸â€‍ط·آ£ط·آ¯ط¸â€‍ط·آ©.",
                "- ط·آ§ط¸â€‍ط·آ·ط¸ث†ط¸â€‍ 160-420 ط·آ­ط·آ±ط¸ظ¾.",
                f"- ط·ع¾ط·آ¬ط¸â€ ط·آ¨ ط·آ¨ط·آ¯ط·آ§ط¸ظ¹ط·آ§ط·ع¾: {avoid_openers_block or 'أ¢â‚¬â€‌'}.",
                f"- ط¸â€‍ط·آ§ ط·ع¾ط·آ°ط¸ئ’ط·آ± ط·آ§ط¸â€‍ط¸â€ڑط¸ظ¹ط¸ث†ط·آ¯ ط·آ­ط·آ±ط¸ظ¾ط¸ظ¹ط¸â€¹ط·آ§: {constraints_summary or 'أ¢â‚¬â€‌'}.",
                f"- ط·ع¾ط·آ¬ط¸â€ ط·آ¨ ط·ع¾ط¸ئ’ط·آ±ط·آ§ط·آ± ط·آ¹ط·آ¨ط·آ§ط·آ±ط·آ§ط·ع¾ ط·آ­ط·آ¯ط¸ظ¹ط·آ«ط·آ©: {recent_avoid or 'أ¢â‚¬â€‌'}.",
            ]
            if evidence_rule:
                prompt_lines.insert(prompt_lines.index("ط¸â€ڑط¸ث†ط·آ§ط·آ¹ط·آ¯ ط·آµط·آ§ط·آ±ط¸â€¦ط·آ©:") + 1, f"- ط·آ§ط·آ°ط¸ئ’ط·آ± ط¸â€¦ط·آ¹ط·آ±ط¸ظ¾ ط·آ¯ط¸â€‍ط¸ظ¹ط¸â€‍ ط¸ث†ط·آ§ط·آ­ط·آ¯ ط·آ¹ط¸â€‍ط¸â€° ط·آ§ط¸â€‍ط·آ£ط¸â€ڑط¸â€‍ ط¸â€¦ط·آ«ط¸â€‍ {evidence_rule}.")
            prompt = "\n".join(prompt_lines)
        else:
            prompt_lines = [
                human_guardrail,
                f"You are {role_label}. Phase: {phase_label}.",
                f"Idea: {idea_label}.",
                f"Your stance: {new_label} (was: {prev_label}, changed: {changed_label}).",
                f"Traits: {traits_desc}. Biases: {bias_desc}.",
                f"Recent thoughts: {memory_context}.",
                f"Your research slice only: {research_summary or 'أ¢â‚¬â€‌'}",
                f"Signals: {research_signals or 'أ¢â‚¬â€‌'}",
                f"Evidence cards:\n{evidence_lines or 'أ¢â‚¬â€‌'}",
                *(
                    [
                        f"Reply directly to {reply_to_short_id} and include {reply_to_short_id} literally in the reply.",
                        f"{reply_to_short_id} said: \"{reply_snippet}\"",
                    ]
                    if reply_to_short_id
                    else []
                ),
                "Strict rules:",
                "- Write 1-3 sentences.",
                "- No bullets/lists/quotes.",
                "- No generic templates or boilerplate.",
                f"- Stay strictly in your domain: {role_guidance}.",
                "- Make the stance clear with a concrete, specific rationale grounded in the slice/evidence.",
                "- Length 120-420 chars.",
                f"- Avoid opener patterns: {avoid_openers_block or 'أ¢â‚¬â€‌'}.",
                f"- Do not restate constraints literally: {constraints_summary or 'أ¢â‚¬â€‌'}.",
                f"- Avoid repeating recent phrases: {recent_avoid or 'أ¢â‚¬â€‌'}.",
            ]
            if evidence_rule:
                prompt_lines.insert(prompt_lines.index("Strict rules:") + 1, f"- Include at least one evidence ID like {evidence_rule}.")
            prompt = "\n".join(prompt_lines)
        try:
            try:
                max_attempts = int(os.getenv("LLM_REASONING_ATTEMPTS", "4") or 4)
            except ValueError:
                max_attempts = 4
            max_attempts = max(1, min(8, max_attempts))
            last_reason: str | None = None
            last_candidate: str | None = None

            validator = None
            if LLMOutputValidator is not None:
                try:
                    judge_temp = float(os.getenv("LLM_JUDGE_TEMPERATURE", "0.1") or 0.1)
                except ValueError:
                    judge_temp = 0.1
                validator = LLMOutputValidator(temperature=judge_temp)

            for attempt in range(max_attempts):
                temp = 0.9 + (0.05 * attempt)
                repeat_penalty = 1.25 + (0.1 * attempt)
                seed_value = int(
                    hashlib.sha256(
                        f"{agent.agent_id}:{phase_label}:{reply_to_short_id}:{attempt}".encode("utf-8")
                    ).hexdigest()[:8],
                    16,
                )
                if language == "ar":
                    extra_nudge = "ط¸â€¦ط¸â€،ط¸â€¦: ط¸â€‍ط·آ§ ط·ع¾ط·آ®ط·ع¾ط·آ±ط·آ¹ ط¸â€¦ط·آ®ط·آ§ط·آ·ط·آ± ط·آ¹ط·آ§ط¸â€¦ط·آ© ط·آ®ط·آ§ط·آ±ط·آ¬ ط·آ§ط¸â€‍ط·آ´ط·آ±ط¸ظ¹ط·آ­ط·آ©. ط·آ§ط¸ئ’ط·ع¾ط·آ¨ ط·آ¨ط·آµط¸ظ¹ط·آ§ط·ط›ط·آ© ط·آ¬ط·آ¯ط¸ظ¹ط·آ¯ط·آ© ط·ع¾ط¸â€¦ط·آ§ط¸â€¦ط¸â€¹ط·آ§."
                else:
                    extra_nudge = "IMPORTANT: Do not invent generic risks outside the slice. Use fresh wording."

                fix = ""
                if last_reason:
                    if last_reason == "missing reply tag":
                        fix = f"FIX: Include {reply_to_short_id} literally in the reply."
                    elif last_reason == "missing evidence id" and evidence_ids:
                        fix = f"FIX: Include at least one evidence ID like {evidence_ids[0]}."
                    elif last_reason == "length":
                        fix = "FIX: Adjust length to fit the required range."
                    elif last_reason == "mostly latin":
                        fix = "FIX: Use Arabic letters; keep English to short acronyms only."
                    elif last_reason == "banned phrase":
                        fix = "FIX: Remove the forbidden phrase and rewrite from scratch."
                    else:
                        fix = f"FIX: Rewrite from scratch. (Previous rejection: {last_reason})"

                patched_prompt = prompt + "\n\n" + extra_nudge + ("\n" + fix if fix else "")

                async with self._llm_semaphore:
                    response = await asyncio.wait_for(
                        generate_ollama(
                            prompt=patched_prompt,
                            temperature=temp,
                            seed=seed_value,
                            options={
                                "repeat_penalty": repeat_penalty,
                                "frequency_penalty": 1.0,
                            },
                        ),
                        timeout=self._llm_timeout,
                    )
                explanation = response.strip()
                explanation = re.sub(r"\([^\)]*(category=|audience=|goals=|maturity=|location=|risk=)\s*[^\)]*\)", "", explanation)
                sentences = re.split(r"(?<=[.!?ط·ع؛])\s+", explanation)
                if len(sentences) > 3:
                    explanation = " ".join(sentences[:3]).strip()
                explanation = _trim_to_limit(explanation, 480)
                if explanation:
                    last_candidate = explanation

                ok, reason = self._validate_llm_response(
                    explanation=explanation,
                    language=language,
                    reply_to_short_id=reply_to_short_id,
                    evidence_ids=evidence_ids,
                    requires_evidence=requires_evidence,
                    avoid_openers=avoid_openers,
                    recent_phrases=recent_phrases,
                )
                if not ok:
                    last_reason = reason
                    if debug:
                        print(f"[llm_reasoning] {agent.agent_id[:4]} attempt {attempt + 1} rejected: {reason}")
                    await _emit_debug(reason, "validate", attempt + 1)
                    continue

                if validator is not None:
                    persona_summary = f"{role_label}; traits: {traits_desc}; biases: {bias_desc}; guidance: {role_guidance}"
                    recent = list(recent_phrases or []) + list(agent.short_memory or [])
                    res = await validator.validate(explanation, persona_summary, recent)
                    if not res.ok:
                        last_reason = "validator:" + ",".join(res.reasons)
                        if debug:
                            print(
                                f"[llm_reasoning] {agent.agent_id[:4]} attempt {attempt + 1} rejected: {last_reason}"
                            )
                        await _emit_debug(last_reason, "llm_judge", attempt + 1)
                        continue

                return explanation

            # Last-chance attempt (still LLM-generated) with a simpler prompt.
            emergency = await self._emergency_llm_generation(
                agent=agent,
                language=language,
                idea_label=idea_label,
                reply_to_short_id=reply_to_short_id,
                phase_label=phase_label,
                evidence_cards=evidence_cards,
                role_label=role_label,
                role_guidance=role_guidance,
            )
            if emergency:
                candidate = emergency.strip()
                ok, reason = self._validate_llm_response(
                    explanation=candidate,
                    language=language,
                    reply_to_short_id=reply_to_short_id,
                    evidence_ids=evidence_ids,
                    requires_evidence=requires_evidence,
                    avoid_openers=avoid_openers,
                    recent_phrases=recent_phrases,
                )
                if ok:
                    if validator is None:
                        return candidate
                    persona_summary = f"{role_label}; traits: {traits_desc}; biases: {bias_desc}; guidance: {role_guidance}"
                    res = await validator.validate(candidate, persona_summary, list(recent_phrases or []) + list(agent.short_memory or []))
                    if res.ok:
                        return candidate
                if debug:
                    print(f"[llm_reasoning] {agent.agent_id[:4]} emergency rejected: {reason}")
                await _emit_debug(reason, "emergency", None)

            if last_candidate:
                return last_candidate
            return _fallback_reasoning("no_candidate")

        except Exception as exc:
            if debug:
                print(f"[llm_reasoning] {agent.agent_id[:4]} exception: {exc}")
            return _fallback_reasoning("exception")

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
    ) -> str | None:
        debug = os.getenv("LLM_REASONING_DEBUG", "false").strip().lower() in {"1", "true", "yes", "on"}

        def _clip(value: str, limit: int) -> str:
            value = re.sub(r"\s+", " ", (value or "").strip())
            if len(value) <= limit:
                return value
            return value[: max(0, limit - 3)].rstrip() + "..."

        cleaned_cards: List[str] = []
        for card in (evidence_cards or []):
            clipped = _clip(str(card), 220)
            if clipped:
                cleaned_cards.append(clipped)
        evidence_cards = cleaned_cards[:6]

        evidence_lines = "\n".join(f"[E{i + 1}] {card}" for i, card in enumerate(evidence_cards))
        evidence_ids = [f"E{i + 1}" for i in range(len(evidence_cards))]
        requires_evidence = len(evidence_ids) > 0
        if language == "ar":
            prompt_lines = [
                f"أنت {role_label}. المرحلة: {phase_label}.",
                f"الفكرة: {idea_label}.",
                f"نقطة للنقاش: {reply_to_short_id or 'نقاش سابق'}.",
                f"أدلة متاحة:\n{evidence_lines or '-'}",
                "قواعد الرد:",
                "- اكتب 1-2 جمل طبيعية.",
                "- لا تستخدم نقاط أو تنسيق رسمي.",
                "- التزم بسياق الدور: " + role_guidance + ".",
                "- استخدم لهجة مصرية واضحة وبسيطة.",
            ]
            if requires_evidence and evidence_ids:
                prompt_lines.append(f"- اذكر دليل واحد على الأقل مثل {evidence_ids[0]}.")
            prompt = "\n".join(prompt_lines)
        else:
            prompt_lines = [
                f"You are {role_label}. Phase: {phase_label}.",
                f"Idea: {idea_label}.",
                f"Debate reference: {reply_to_short_id or 'previous point'}",
                f"Evidence:\n{evidence_lines or '-'}",
                "Rules:",
                "- Write 1-2 sentences.",
                "- No bullets/lists/quotes.",
                "- Sound like a real person, not a template.",
                f"- Stay strictly in your domain: {role_guidance}.",
                "- Keep it concise and specific.",
            ]
            if requires_evidence and evidence_ids:
                prompt_lines.insert(prompt_lines.index("Rules:") + 1, f"- Include at least one evidence ID like {evidence_ids[0]}.")
            prompt = "\n".join(prompt_lines)
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
                    timeout=self._llm_timeout,
                )
            explanation = response.strip()
            explanation = explanation[:450].rstrip()
            if language == "ar":
                latin = sum(1 for ch in explanation if "a" <= ch.lower() <= "z")
                arabic = sum(1 for ch in explanation if "\u0600" <= ch <= "\u06ff")
                if latin > arabic * 3 and latin > 40:
                    raise RuntimeError("Emergency LLM response used mostly Latin characters.")
            lowered = explanation.lower()
            if requires_evidence and not any(eid.lower() in lowered for eid in evidence_ids):
                raise RuntimeError("Emergency LLM response missing evidence id.")
            for phrase in build_default_forbidden_phrases():
                if phrase and phrase.lower() in lowered:
                    raise RuntimeError("Emergency LLM response contained forbidden phrase.")
            return explanation
        except Exception as exc:
            if debug:
                print(f"[llm_reasoning] {agent.agent_id[:4]} emergency exception: {exc}")
            return None

    async def run_simulation(
        self,
        user_context: Dict[str, Any],
        emitter: Callable[[str, Dict[str, Any]], asyncio.Future],
        resume_state: Optional[Dict[str, Any]] = None,
        checkpoint_emitter: Optional[Callable[[Dict[str, Any]], asyncio.Future]] = None,
    ) -> Dict[str, Any]:

        resume_state = resume_state or {}
        resume_active = bool(resume_state)
        checkpoint_meta = resume_state.get("meta") if isinstance(resume_state.get("meta"), dict) else {}
        should_emit_initial = not resume_active

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
        restored_rng_state = self._deserialize_random_state(resume_state.get("rng_state"))
        if restored_rng_state is not None:
            try:
                random.setstate(restored_rng_state)
            except Exception:
                random.seed(seed_value)
        else:
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
            if any(token in text for token in [
                "privacy",
                "surveillance",
                "tracking",
                "gps",
                "location",
                "bank",
                "banking",
                "account",
                "credit",
                "wallet",
                "messages",
                "email",
                "chat",
                "dm",
                "personal data",
                "pii",
                "biometric",
                "password",
                "ssn",
                "social security",
                "ط·آ®ط·آµط¸ث†ط·آµ",
                "ط·ع¾ط·آ¬ط·آ³ط·آ³",
                "ط¸â€¦ط¸ث†ط¸â€ڑط·آ¹",
                "ط·آ±ط·آ³ط·آ§ط·آ¦ط¸â€‍",
                "ط·آ¨ط¸â€ ط¸ئ’",
                "ط·آ­ط·آ³ط·آ§ط·آ¨",
                "ط·آ¨ط·آ·ط·آ§ط¸â€ڑط·آ©",
                "ط·آ¨ط¸ظ¹ط·آ§ط¸â€ ط·آ§ط·ع¾",
                "ط¸â€،ط¸ث†ط¸ظ¹ط·آ©",
                "ط·آ±ط¸â€ڑط¸â€¦ ط¸â€ڑط¸ث†ط¸â€¦ط¸ظ¹",
            ]):
                score += 0.2
            return min(0.6, score)

        idea_text = str(user_context.get("idea") or "")
        research_summary = str(user_context.get("research_summary") or "")
        research_structured = user_context.get("research_structured") or {}
        search_quality = user_context.get("search_quality") if isinstance(user_context.get("search_quality"), dict) else None
        language = str(user_context.get("language") or "ar").lower()
        run_mode = str(user_context.get("run_mode") or checkpoint_meta.get("run_mode") or "normal").strip().lower() or "normal"
        try:
            neutral_cap_pct = float(
                user_context.get("neutral_cap_pct")
                if user_context.get("neutral_cap_pct") is not None
                else checkpoint_meta.get("neutral_cap_pct", os.getenv("SIM_NEUTRAL_CAP_PCT", "0.30"))
            )
        except Exception:
            neutral_cap_pct = 0.30
        neutral_cap_pct = max(0.05, min(0.70, neutral_cap_pct))
        neutral_enforcement = str(
            user_context.get("neutral_enforcement")
            or checkpoint_meta.get("neutral_enforcement")
            or ("clarification_before_complete" if run_mode == "dev_suite" else "clarification_before_complete")
        ).strip() or "clarification_before_complete"
        try:
            max_neutral_clarifications = int(os.getenv("MAX_NEUTRAL_CLARIFICATIONS", "6"))
        except Exception:
            max_neutral_clarifications = 6
        max_neutral_clarifications = max(1, min(24, max_neutral_clarifications))
        idea_risk = _idea_risk_score(idea_text)
        regulatory_seed = ""
        if isinstance(research_structured, dict):
            regulatory_seed = str(research_structured.get("regulatory_risk") or "").lower()
        if regulatory_seed in {"high", "strict"}:
            initial_risk_bias = min(0.6, idea_risk + 0.2)
        elif regulatory_seed in {"medium", "moderate"}:
            initial_risk_bias = min(0.6, idea_risk + 0.1)
        else:
            initial_risk_bias = idea_risk

        safety_guard_enabled = str(os.getenv("SIM_SAFETY_GUARD_HARD", "1")).strip().lower() in {"1", "true", "yes", "on"}
        disable_random_stance_force = str(os.getenv("REASONING_DISABLE_RANDOM_STANCE_FORCE", "1")).strip().lower() in {"1", "true", "yes", "on"}
        policy_mode = "safety_guard_hard" if safety_guard_enabled else "normal"

        def _contains_any(source: str, items: List[str]) -> bool:
            return any(token for token in items if token and token in source)

        def _classify_hard_unsafe_policy(text: str) -> Tuple[bool, Optional[str], float]:
            normalized = (text or "").strip().lower()
            if not normalized:
                return False, None, 0.0
            score = 0.0
            reasons: List[str] = []

            invasive_data_terms = [
                "private message", "private messages", "dm", "chat history", "bank", "banking", "credit card",
                "gps", "location tracking", "political", "religious", "biometric", "surveillance", "monitoring",
                "رسائل خاصة", "الرسائل الخاصة", "سجل مشترياته", "مشتريات بنكية", "تحركاته", "gps", "آرائه السياسية", "الدينية",
                "مراقبة", "تتبع", "خصوصية",
            ]
            punitive_terms = [
                "ban", "blacklist", "block from applying", "for 5 years", "five years", "statewide ban",
                "حظر", "منع", "قائمة سوداء", "لمدة 5 سنوات", "خمس سنوات", "من التقديم",
            ]
            scoring_terms = [
                "trust score", "social score", "risk score", "درجة ثقة", "نظام نقاط", "تصنيف المتقدمين",
            ]

            if _contains_any(normalized, invasive_data_terms):
                score += 0.45
                reasons.append("invasive_data_collection")
            if _contains_any(normalized, punitive_terms):
                score += 0.35
                reasons.append("disproportionate_punitive_outcome")
            if _contains_any(normalized, scoring_terms):
                score += 0.20
                reasons.append("high_risk_automated_scoring")

            if score >= 0.55:
                return True, ",".join(reasons[:3]) or "unsafe_policy", min(1.0, score)
            return False, None, min(1.0, score)

        hard_unsafe_triggered = False
        hard_policy_reason: Optional[str] = None
        hard_policy_risk_score = 0.0
        if safety_guard_enabled:
            hard_unsafe_triggered, hard_policy_reason, hard_policy_risk_score = _classify_hard_unsafe_policy(idea_text)

        def _idea_concerns() -> str:
            text = idea_text.lower()
            concerns = []
            if any(token in text for token in ["legal", "court", "lawsuit", "police", "regulation"]):
                concerns.append("regulation and liability" if language != "ar" else "ط·آ§ط¸â€‍ط¸â€‍ط¸ث†ط·آ§ط·آ¦ط·آ­ ط¸ث†ط·آ§ط¸â€‍ط¸â€¦ط·آ³ط·آ¤ط¸ث†ط¸â€‍ط¸ظ¹ط·آ©")
            if any(token in text for token in ["predict", "prediction", "outcome"]):
                concerns.append("prediction accuracy" if language != "ar" else "ط·آ¯ط¸â€ڑط·آ© ط·آ§ط¸â€‍ط·ع¾ط¸â€ ط·آ¨ط·آ¤")
            if any(token in text for token in ["documents", "upload", "records", "photos"]):
                concerns.append("privacy and data security" if language != "ar" else "ط·آ§ط¸â€‍ط·آ®ط·آµط¸ث†ط·آµط¸ظ¹ط·آ© ط¸ث†ط·آ£ط¸â€¦ط¸â€  ط·آ§ط¸â€‍ط·آ¨ط¸ظ¹ط·آ§ط¸â€ ط·آ§ط·ع¾")
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
                        "ط·ع¾ط¸ث†ط·آ§ط¸ظ¾ط¸â€ڑ ط·آ§ط¸â€‍ط·آ³ط¸ث†ط¸â€ڑ ط¸ث†ط·ع¾ط·آ¹ط¸â€ڑط¸ظ¹ط·آ¯ط·آ§ط·ع¾ ط·آ§ط¸â€‍ط·آ¥ط·آ·ط¸â€‍ط·آ§ط¸â€ڑ",
                        "ط·آ¹ط¸ث†ط·آ§ط·آ¦ط¸â€ڑ ط·آ§ط¸â€‍ط·ع¾ط¸ث†ط·آ²ط¸ظ¹ط·آ¹ ط¸ث†ط·آµط·آ¹ط¸ث†ط·آ¨ط·آ© ط·آ§ط¸â€‍ط·ع¾ط·آ¨ط¸â€ ط¸ظ¹",
                        "ط·ع¾ط·آ¹ط¸â€ڑط¸ظ¹ط·آ¯ ط·آ§ط¸â€‍ط·آ¥ط·آ·ط¸â€‍ط·آ§ط¸â€ڑ ط¸ث†ط·آ§ط¸â€‍ط·آ¶ط·ط›ط·آ· ط·آ§ط¸â€‍ط·ع¾ط·آ´ط·ط›ط¸ظ¹ط¸â€‍ط¸ظ¹",
                        "ط¸ث†ط·آ¶ط¸ث†ط·آ­ ط·آ§ط¸â€‍ط·ع¾ط¸â€¦ط¸ث†ط·آ¶ط·آ¹ ط¸ث†ط·آ¥ط·آ¬ط¸â€،ط·آ§ط·آ¯ ط·آ§ط¸â€‍ط·ع¾ط¸â€ ط¸ظ¾ط¸ظ¹ط·آ°",
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
            if re.search(r"[\u0600-\u06FF]", raw):
                snippet = raw
                if len(snippet) > 60:
                    snippet = snippet[:57].rstrip() + "..."
                return f"الفكرة: {snippet}"
            text_local = raw.lower()
            if "legal" in text_local or "court" in text_local:
                if "predict" in text_local or "outcome" in text_local:
                    return "مساعد قانوني بالذكاء الاصطناعي يتنبأ بنتائج القضايا"
                return "مساعد قانوني بالذكاء الاصطناعي"
            if "health" in text_local or "clinic" in text_local:
                return "مساعد صحي بالذكاء الاصطناعي"
            if "finance" in text_local or "bank" in text_local:
                return "مساعد مالي بالذكاء الاصطناعي"
            if "education" in text_local or "school" in text_local:
                return "مساعد تعليمي بالذكاء الاصطناعي"
            if "e-commerce" in text_local or "commerce" in text_local or "retail" in text_local:
                return "منتج تجارة إلكترونية"
            return "الفكرة"

        # Used by the LLM prompt. Prefer the user's raw idea text when provided.
        idea_label_for_llm = idea_text.strip()
        if len(idea_label_for_llm) > 180:
            idea_label_for_llm = idea_label_for_llm[:177].rstrip() + "..."
        if not idea_label_for_llm:
            idea_label_for_llm = _idea_label_localized() if language == "ar" else _idea_label()

        def _research_insight() -> str:
            if not research_summary:
                return ""
            summary = research_summary.lower()
            city = str(user_context.get("city") or "")
            if language == "ar":
                if "competition" in summary or "saturated" in summary:
                    return f"المنافسة عالية في {city}" if city else "المنافسة عالية"
                if "demand" in summary or "market pull" in summary:
                    return "يوجد طلب واضح من السوق"
                if "regulation" in summary or "compliance" in summary:
                    return "المخاطر التنظيمية مرتفعة"
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
                parts.append(f"goals={goals}" if language != "ar" else f"الأهداف={goals}")
            if maturity:
                parts.append(f"maturity={maturity}" if language != "ar" else f"نضج الفكرة={maturity}")
            if location:
                parts.append(f"location={location}" if language != "ar" else f"المكان={location}")
            if isinstance(risk, (int, float)):
                parts.append(f"risk={risk:.2f}" if language != "ar" else f"المخاطرة={risk:.2f}")
            return "; ".join(parts)

        def _label_opinion(opinion: str) -> str:
            if language != "ar":
                return opinion
            return {"accept": "موافق", "reject": "رافض", "neutral": "محايد"}.get(opinion, "محايد")

        async def _infer_opinion_from_llm(text: str) -> str | None:
            if not text:
                return None
            if LLMOutputValidator is None:
                return None
            if stance_classifier is None:
                return None
            return await stance_classifier.classify_opinion(
                text=text,
                idea_label=idea_label_for_llm,
                language=language,
            )

        def _initial_opinion(traits: Dict[str, float]) -> str:
            _ = traits
            # Product requirement: every new simulation starts from a neutral baseline.
            return "neutral"

        requested_agents = user_context.get("agentCount")
        if isinstance(requested_agents, int) and 5 <= requested_agents <= 500:
            num_agents = requested_agents
        else:
            num_agents = random.randint(18, 24)

        agents: List[Agent] = self._restore_agents(resume_state.get("agents")) if resume_active else []
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
        if not agents:
            for _ in range(num_agents):
                template, category = random.choice(template_pool)
                agent = Agent(template=template, category=category, initial_opinion=_initial_opinion(template.traits))
                agents.append(agent)
        else:
            num_agents = len(agents)
        agent_labels: Dict[str, str] = {
            agent.agent_id: f"Agent {idx + 1}"
            for idx, agent in enumerate(agents)
        }

        def _agent_snapshot(agent: Agent) -> Dict[str, Any]:
            return {
                "agent_id": agent.agent_id,
                "agent_short_id": agent.agent_id[:4],
                "agent_label": agent_labels.get(agent.agent_id, f"Agent {agent.agent_id[:4]}"),
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

        if not resume_active:
            # Keep all agents neutral at t=0 (no pre-bias leaders/opinions).
            for agent in agents:
                agent.fixed_opinion = None
                agent.current_opinion = "neutral"
                agent.initial_opinion = "neutral"

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
        try:
            step_delay = float(os.getenv("SIMULATION_STEP_DELAY", "0.08") or 0.08)
        except Exception:
            step_delay = 0.08
        step_delay = max(0.0, step_delay)
        reasoning_scope = str(user_context.get("reasoning_scope") or "hybrid").strip().lower()
        if reasoning_scope not in {"hybrid", "full", "speakers_only"}:
            reasoning_scope = "hybrid"
        reasoning_detail = str(user_context.get("reasoning_detail") or "short").strip().lower()
        if reasoning_detail not in {"short", "full"}:
            reasoning_detail = "short"
        reasoning_engine_v2 = str(os.getenv("REASONING_ENGINE_V2", "1")).strip().lower() in {"1", "true", "yes", "on"}
        # Force sequential reasoning generation so each agent can react to
        # up-to-date dialogue context from previous agents in the same phase.
        llm_concurrency = 1
        try:
            reasoning_temp = float(os.getenv("LLM_REASONING_TEMPERATURE", "0.7") or 0.7)
        except ValueError:
            reasoning_temp = 0.7
        try:
            short_limit = int(os.getenv("LLM_SHORT_MAX_CHARS", "220") or 220)
        except ValueError:
            short_limit = 220
        try:
            full_limit = int(os.getenv("LLM_FULL_MAX_CHARS", "450") or 450)
        except ValueError:
            full_limit = 450
        try:
            reasoning_min_chars = int(os.getenv("REASONING_MIN_CHARS", "70") or 70)
        except ValueError:
            reasoning_min_chars = 70
        reasoning_min_chars = max(40, min(220, reasoning_min_chars))
        try:
            reasoning_max_retries = int(os.getenv("REASONING_MAX_RETRIES", "4") or 4)
        except ValueError:
            reasoning_max_retries = 4
        reasoning_max_retries = max(1, min(8, reasoning_max_retries))
        try:
            reasoning_context_turns = int(os.getenv("REASONING_MAX_CONTEXT_TURNS", "6") or 6)
        except ValueError:
            reasoning_context_turns = 6
        reasoning_context_turns = max(2, min(14, reasoning_context_turns))
        try:
            reasoning_min_relevance = float(os.getenv("REASONING_MIN_RELEVANCE", "0.14") or 0.14)
        except ValueError:
            reasoning_min_relevance = 0.14
        reasoning_min_relevance = max(0.02, min(0.9, reasoning_min_relevance))
        try:
            fallback_alert_threshold = float(os.getenv("REASONING_FALLBACK_ALERT_THRESHOLD", "0.10") or 0.10)
        except ValueError:
            fallback_alert_threshold = 0.10
        fallback_alert_threshold = max(0.0, min(1.0, fallback_alert_threshold))
        try:
            validator_sample_rate = float(os.getenv("LLM_VALIDATOR_SAMPLE_RATE", "0.1") or 0.1)
        except ValueError:
            validator_sample_rate = 0.1
        validator_sample_rate = max(0.0, min(1.0, validator_sample_rate))
        try:
            max_dialogue_context = int(os.getenv("SIM_MAX_DIALOGUE_CONTEXT", "60") or 60)
        except ValueError:
            max_dialogue_context = 60
        llm_semaphore = asyncio.Semaphore(llm_concurrency)
        stance_classifier = None
        if LLMOutputValidator is not None:
            try:
                judge_temp = float(os.getenv("LLM_JUDGE_TEMPERATURE", "0.1") or 0.1)
            except ValueError:
                judge_temp = 0.1
            stance_classifier = LLMOutputValidator(temperature=judge_temp)
        reasoning_stats: Dict[str, Any] = {
            "total_steps": 0,
            "fallback_steps": 0,
            "classified_steps": 0,
            "regeneration_attempts": 0,
            "rejections": {},
        }

        def _friendly_category(category_id: str) -> str:
            return category_id.replace("_", " ").title()

        def _pick_phrase(seed: str, phrases: list[str]) -> str:
            value = int(hashlib.sha256(seed.encode("utf-8")).hexdigest()[:8], 16)
            return phrases[value % len(phrases)]

        arabic_peer_tags = ["ط·آ£", "ط·آ¨", "ط·آ¬", "ط·آ¯", "ط¸â€،ط¸â‚¬", "ط¸ث†", "ط·آ²", "ط·آ­", "ط·آ·", "ط¸ظ¹"]

        recent_seed = resume_state.get("recent_messages")
        if not isinstance(recent_seed, list):
            recent_seed = []
        recent_messages: deque[str] = deque([str(item) for item in recent_seed if str(item).strip()], maxlen=200)

        def _push_recent(message: str) -> None:
            recent_messages.append(message)

        def _dedupe_message(message: str, agent: Agent, iteration: int) -> str:
            normalized = self._normalize_msg(message)
            if not normalized:
                return message
            recent_list = list(recent_messages)
            repeated = any(normalized == self._normalize_msg(prev) for prev in recent_list[-30:])
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
            "ط¸ظ¾ط¸ظ¹", "ط¸â€¦ط¸â€ ", "ط·آ¹ط¸â€‍ط¸â€°", "ط·آ¹ط¸â€ ", "ط¸â€،ط·آ°ط·آ§", "ط¸â€،ط·آ°ط¸â€،", "ط·آ°ط¸â€‍ط¸ئ’", "ط·ع¾ط¸â€‍ط¸ئ’", "ط·آ¥ط¸â€‍ط¸â€°", "ط·آ§ط¸â€‍ط¸â€°", "ط¸â€¦ط·آ¹", "ط¸â€‍ط¸ئ’ط¸â€ ", "ط¸â€‍ط·آ£ط¸â€ ", "ط¸â€‍ط·آ§ط¸â€ ",
            "ط¸â€،ط¸ث†", "ط¸â€،ط¸ظ¹", "ط¸â€،ط¸â€¦", "ط¸â€،ط¸â€ ", "ط·آ£ط¸â€ ط·ع¾", "ط·آ§ط¸â€ ط·ع¾ط¸â€¦", "ط·آ§ط¸â€ ط·آ§", "ط¸â€ ط·آ­ط¸â€ ", "ط¸ئ’ط·آ§ط¸â€ ", "ط¸ئ’ط·آ§ط¸â€ ط·ع¾", "ط¸ظ¹ط¸ئ’ط¸ث†ط¸â€ ", "ط·آ¨ط·آ³ط·آ¨ط·آ¨", "ط·آ¬ط·آ¯ط·آ§ط¸â€¹",
            "ط·آ§ط¸ث†", "ط·آ£ط¸ث†", "ط·آ«ط¸â€¦", "ط¸ئ’ط¸â€¦ط·آ§", "ط¸â€ڑط·آ¯", "ط¸â€‍ط¸â€ ", "ط¸â€‍ط·آ§", "ط¸â€¦ط·آ§", "ط¸â€‍ط¸â€¦", "ط¸â€‍ط¸â€¦ط·آ§", "ط¸â€،ط¸â€ ط·آ§ط¸ئ’", "ط¸â€،ط¸â€ ط·آ§",
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

        def _extract_reason_tag(message: str, stance_value: Optional[str] = None) -> str:
            normalized = _normalized(message)
            if not normalized:
                return "evidence_gap"
            for tag, keywords in reason_tag_keywords.items():
                if any(keyword in normalized for keyword in keywords):
                    return tag
            tokens = set(_extract_words(message))
            if hard_unsafe_triggered and (
                {"privacy", "legal", "compliance", "discrimination", "خصوصية", "قانون", "امتثال", "تمييز"} & tokens
            ):
                return "legal_compliance"
            if stance_value in {"reject", "neutral"}:
                return "evidence_gap"
            return "feasibility_scalability"

        def _build_clarification_template(reason_tag: str) -> Dict[str, Any]:
            if language == "ar":
                templates: Dict[str, Dict[str, Any]] = {
                    "privacy_surveillance": {
                        "question": "إيه حدود جمع البيانات اللي تقبلها في الفكرة؟",
                        "options": [
                            "بيانات يقدمها المستخدم بنفسه فقط",
                            "بيانات عامة فقط مع موافقة صريحة",
                            "مسموح بيانات إضافية بشرط مراجعة بشرية كاملة",
                        ],
                        "reason_summary": "أغلب الوكلاء شايفين مخاطر خصوصية ومراقبة عالية.",
                    },
                    "legal_compliance": {
                        "question": "إيه مستوى الالتزام القانوني المطلوب قبل الإطلاق؟",
                        "options": [
                            "الالتزام الكامل (GDPR/قوانين محلية) قبل أي إطلاق",
                            "إطلاق محدود مع موافقات صريحة وتدقيق شهري",
                            "نسخة تجريبية بدون قرارات مؤثرة لحين اكتمال الامتثال",
                        ],
                        "reason_summary": "الاعتراضات مركزة على المخاطر القانونية والامتثال.",
                    },
                    "ethical_discrimination": {
                        "question": "كيف تحب النظام يتعامل مع قرارات قد تسبب تمييز؟",
                        "options": [
                            "منع أي قرار آلي نهائي واعتماد مراجعة بشرية",
                            "قرار آلي مبدئي مع حق اعتراض واضح للمستخدم",
                            "إيقاف تقييم الحساسية والاكتفاء بمؤشرات غير شخصية",
                        ],
                        "reason_summary": "الوكلاء محتاجين ضمانات عدالة ومنع التمييز.",
                    },
                    "unclear_target": {
                        "question": "مين الجمهور الأساسي اللي نركز عليه أولاً؟",
                        "options": [
                            "شريحة ضيقة جدًا كمرحلة أولى",
                            "شريحتين بمتطلبات متقاربة",
                            "سوق واسع مع تخصيص لاحق",
                        ],
                        "reason_summary": "فيه غموض في الشريحة المستهدفة.",
                    },
                    "unclear_value": {
                        "question": "إيه القيمة الأساسية اللي لازم تكون واضحة للمستخدم؟",
                        "options": [
                            "توفير وقت/تكلفة بشكل مباشر",
                            "تحسين الجودة والدقة",
                            "تقليل المخاطر والامتثال",
                        ],
                        "reason_summary": "الوكلاء طالبين توضيح أقوى للقيمة المقدمة.",
                    },
                    "feasibility_scalability": {
                        "question": "إيه مستوى التعقيد الفني المقبول في النسخة الأولى؟",
                        "options": [
                            "MVP بسيط بخصائص قليلة",
                            "نطاق متوسط مع بنية قابلة للتوسع",
                            "نطاق كامل من البداية مع استثمار أكبر",
                        ],
                        "reason_summary": "الأغلبية عندها قلق من قابلية التنفيذ والتوسع.",
                    },
                    "market_demand": {
                        "question": "إزاي نثبت الطلب السوقي قبل التوسع؟",
                        "options": [
                            "Pilot صغير بعملاء حقيقيين",
                            "اختبار أسعار مع صفحة انتظار",
                            "شراكة مبكرة مع عميل مؤسسي",
                        ],
                        "reason_summary": "الاعتراضات مرتبطة بوضوح الطلب والمنافسة.",
                    },
                    "evidence_gap": {
                        "question": "أي نوع دليل تحب نركز عليه قبل استكمال النقاش؟",
                        "options": [
                            "مصادر سوق وتسعير",
                            "لوائح وقوانين",
                            "مقابلات مستخدمين وحالات استخدام",
                        ],
                        "reason_summary": "الوكلاء محتاجين أدلة أقوى قبل الحسم.",
                    },
                }
            else:
                templates = {
                    "privacy_surveillance": {
                        "question": "What data-collection boundary should this idea enforce?",
                        "options": [
                            "Only user-submitted data",
                            "Public data with explicit consent",
                            "Extended data but with mandatory human review",
                        ],
                        "reason_summary": "Most agents flagged high privacy/surveillance risk.",
                    },
                    "legal_compliance": {
                        "question": "What compliance bar must be met before launch?",
                        "options": [
                            "Full compliance before launch",
                            "Limited pilot with explicit consent and audits",
                            "No high-impact decisions until compliance is complete",
                        ],
                        "reason_summary": "Objections are concentrated around legal/compliance risk.",
                    },
                    "ethical_discrimination": {
                        "question": "How should the system avoid discriminatory outcomes?",
                        "options": [
                            "No final automated decisions, always human review",
                            "Automated draft decision with clear appeal path",
                            "Remove sensitive scoring and keep non-personal signals only",
                        ],
                        "reason_summary": "Agents are asking for fairness and anti-bias safeguards.",
                    },
                    "unclear_target": {
                        "question": "Who is the primary target segment for phase one?",
                        "options": [
                            "A narrow niche segment",
                            "Two adjacent segments",
                            "Broad market with later specialization",
                        ],
                        "reason_summary": "Target segment is still ambiguous.",
                    },
                    "unclear_value": {
                        "question": "What single value promise should lead the pitch?",
                        "options": [
                            "Clear time/cost savings",
                            "Higher quality/accuracy",
                            "Risk reduction/compliance confidence",
                        ],
                        "reason_summary": "Agents need a sharper value proposition.",
                    },
                    "feasibility_scalability": {
                        "question": "What technical scope is realistic for v1?",
                        "options": [
                            "Lean MVP with minimal scope",
                            "Mid-scope with scalable architecture",
                            "Full-scope launch with larger investment",
                        ],
                        "reason_summary": "Feasibility and scalability are major concerns.",
                    },
                    "market_demand": {
                        "question": "How should demand be validated before scaling?",
                        "options": [
                            "Small paid pilot",
                            "Pricing test + waitlist",
                            "Early enterprise design partner",
                        ],
                        "reason_summary": "Debate is blocked on demand and competitive proof.",
                    },
                    "evidence_gap": {
                        "question": "Which evidence should we prioritize before continuing?",
                        "options": [
                            "Market/pricing evidence",
                            "Regulatory/compliance evidence",
                            "User interviews and use-case validation",
                        ],
                        "reason_summary": "Agents are blocked by missing evidence.",
                    },
                }
            return templates.get(reason_tag, templates["evidence_gap"])

        def _normalize_clarification_options(raw_options: Any) -> List[Dict[str, str]]:
            normalized: List[Dict[str, str]] = []
            if isinstance(raw_options, list):
                for item in raw_options:
                    label = ""
                    option_id = ""
                    if isinstance(item, str):
                        label = item.strip()
                    elif isinstance(item, dict):
                        label = str(
                            item.get("label")
                            or item.get("text")
                            or item.get("value")
                            or ""
                        ).strip()
                        option_id = str(
                            item.get("id")
                            or item.get("option_id")
                            or ""
                        ).strip()
                    if not label:
                        continue
                    normalized.append(
                        {
                            "id": option_id or f"opt_{len(normalized) + 1}",
                            "label": label[:220],
                        }
                    )
                    if len(normalized) >= 3:
                        break
            deduped: List[Dict[str, str]] = []
            seen = set()
            for item in normalized:
                key = _normalized(item["label"])
                if not key or key in seen:
                    continue
                seen.add(key)
                deduped.append(item)
                if len(deduped) >= 3:
                    break
            return deduped

        def _extract_json_dict(raw_text: str) -> Dict[str, Any]:
            text = str(raw_text or "").strip()
            if not text:
                return {}
            candidates = [text]
            fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
            if fenced:
                candidates.append(fenced.group(1))
            match = re.search(r"(\{.*\})", text, re.DOTALL)
            if match:
                candidates.append(match.group(1))
            for candidate in candidates:
                try:
                    parsed = json.loads(candidate)
                except Exception:
                    continue
                if isinstance(parsed, dict):
                    return parsed
            return {}

        async def _generate_clarification_payload(
            *,
            reason_tag: str,
            reason_summary: str,
            snippets: List[str],
            phase_label: str,
        ) -> Dict[str, Any]:
            template = _build_clarification_template(reason_tag)
            question = str(template.get("question") or "").strip()
            options = _normalize_clarification_options(template.get("options"))
            summary_text = str(template.get("reason_summary") or reason_summary).strip() or reason_summary
            snippets_block = "\n".join([f"- {line}" for line in snippets if line]) or "-"
            language_label = "Arabic" if language == "ar" else "English"
            prompt = (
                "You generate one clarification question for a paused multi-agent debate.\n"
                "Return JSON only with keys: question, options, reason_summary.\n"
                "Rules:\n"
                "- options must be exactly 3 concise and mutually exclusive options.\n"
                "- question must be one sentence.\n"
                "- reason_summary <= 140 chars.\n"
                f"Language: {language_label}\n"
                f"Idea: {idea_label_for_llm}\n"
                f"Phase: {phase_label}\n"
                f"Top reason tag: {reason_tag}\n"
                f"Reason summary seed: {reason_summary}\n"
                f"Evidence summary: {_clip_text(research_summary or research_signals or '', 320)}\n"
                f"Representative snippets:\n{snippets_block}\n"
            )
            try:
                async with llm_semaphore:
                    raw = await generate_ollama(
                        prompt=prompt,
                        temperature=0.2,
                        response_format="json",
                    )
                parsed = _extract_json_dict(raw)
                parsed_question = str(parsed.get("question") or "").strip()
                parsed_options = _normalize_clarification_options(parsed.get("options"))
                parsed_summary = str(parsed.get("reason_summary") or "").strip()
                if parsed_question and len(parsed_options) == 3:
                    question = parsed_question[:260]
                    options = parsed_options
                if parsed_summary:
                    summary_text = parsed_summary[:180]
            except Exception:
                pass
            if len(options) < 3:
                options = _normalize_clarification_options(template.get("options"))
            while len(options) < 3:
                options.append({"id": f"opt_{len(options) + 1}", "label": f"Option {len(options) + 1}"})
            return {
                "question_id": uuid.uuid4().hex[:12],
                "question": question,
                "options": options[:3],
                "reason_tag": reason_tag,
                "reason_summary": summary_text or reason_summary,
                "created_at": int(time.time() * 1000),
                "required": True,
                "phase_label": phase_label,
            }

        def _evaluate_clarification_gate(
            *,
            phase_label: str,
            window: deque[Dict[str, Any]],
            phase_messages: int,
            window_size: int,
            cooldown_steps: int,
            step_index: int,
        ) -> Optional[Dict[str, Any]]:
            if phase_messages < window_size:
                return None
            if len(window) < window_size:
                return None
            total = len(window)
            if total <= 0:
                return None
            reject_ratio = sum(1 for item in window if item.get("opinion") == "reject") / total
            neutral_ratio = sum(1 for item in window if item.get("opinion") == "neutral") / total
            focus_items = [item for item in window if item.get("opinion") in {"reject", "neutral"}]
            if not focus_items:
                return None
            tag_counter = Counter(str(item.get("reason_tag") or "evidence_gap") for item in focus_items)
            if not tag_counter:
                return None
            top_reason_tag, top_reason_count = tag_counter.most_common(1)[0]
            top_reason_ratio = top_reason_count / max(1, len(focus_items))
            focus_ratio = len(focus_items) / total
            fallback_to_reason_tag = {
                "idea_anchor_missing": "unclear_value",
                "low_relevance": "evidence_gap",
                "validator_fail": "evidence_gap",
                "generation_failed": "evidence_gap",
                "empty_or_invalid_output": "evidence_gap",
                "no_candidate": "evidence_gap",
                "too_short": "unclear_value",
                "too_long": "unclear_value",
                "template_prefix": "unclear_value",
                "generic_template": "unclear_value",
                "reused_opener": "unclear_value",
                "safety_anchor_missing": "legal_compliance",
            }
            unresolved_fallback_reasons = set(fallback_to_reason_tag.keys())
            fallback_reasons = [
                str(item.get("fallback_reason") or "").strip().lower()
                for item in window
                if str(item.get("fallback_reason") or "").strip()
            ]
            unresolved_fallback_hits = [reason for reason in fallback_reasons if reason in unresolved_fallback_reasons]
            fallback_issue_ratio = len(unresolved_fallback_hits) / total
            fallback_counter = Counter(unresolved_fallback_hits)
            dominant_fallback_reason = ""
            dominant_fallback_ratio = 0.0
            if fallback_counter:
                dominant_fallback_reason, dominant_fallback_count = fallback_counter.most_common(1)[0]
                dominant_fallback_ratio = dominant_fallback_count / max(1, len(unresolved_fallback_hits))

            reject_neutral_convergence = (
                reject_ratio >= 0.55
                and neutral_ratio >= 0.20
                and top_reason_ratio >= 0.45
            )
            neutral_ambiguity_convergence = (
                neutral_ratio >= 0.50
                and focus_ratio >= 0.60
                and top_reason_ratio >= 0.40
            )
            fallback_quality_stall = (
                neutral_ratio >= 0.35
                and fallback_issue_ratio >= 0.45
                and (top_reason_ratio >= 0.35 or dominant_fallback_ratio >= 0.45)
            )
            if not (
                reject_neutral_convergence
                or neutral_ambiguity_convergence
                or fallback_quality_stall
            ):
                return None
            if fallback_quality_stall and dominant_fallback_reason:
                top_reason_tag = fallback_to_reason_tag.get(dominant_fallback_reason, top_reason_tag)
            same_reason = (
                top_reason_tag == last_clarification_reason_tag
                and phase_label == last_clarification_phase
            )
            if same_reason and (step_index - last_clarification_step) < cooldown_steps:
                return None
            representative: List[str] = []
            seen = set()
            for item in reversed(focus_items):
                if str(item.get("reason_tag") or "evidence_gap") != top_reason_tag:
                    continue
                text = _clip_text(str(item.get("message") or ""), 220)
                key = _normalized(text)
                if not key or key in seen:
                    continue
                seen.add(key)
                representative.append(text)
                if len(representative) >= 3:
                    break
            if not representative:
                representative = [
                    _clip_text(str(item.get("message") or ""), 220)
                    for item in focus_items[-3:]
                ]
            reason_summary = (
                f"reject_ratio={reject_ratio:.2f}, neutral_ratio={neutral_ratio:.2f}, "
                f"focus_ratio={focus_ratio:.2f}, fallback_issue_ratio={fallback_issue_ratio:.2f}, "
                f"top_reason={top_reason_tag} ({top_reason_ratio:.2f})"
            )
            return {
                "reason_tag": top_reason_tag,
                "reason_summary": reason_summary,
                "representative_snippets": representative,
                "reject_ratio": reject_ratio,
                "neutral_ratio": neutral_ratio,
                "top_reason_ratio": top_reason_ratio,
                "focus_ratio": focus_ratio,
                "fallback_issue_ratio": fallback_issue_ratio,
                "dominant_fallback_reason": dominant_fallback_reason or None,
                "dominant_fallback_ratio": dominant_fallback_ratio,
            }

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
                other_tag = f"ط·آ§ط¸â€‍ط¸ث†ط¸ئ’ط¸ظ¹ط¸â€‍ {arabic_peer_tags[tag_index]}"
            constraints = _constraints_summary()
            insight_clause = f" Also, {insight}." if insight and language != "ar" else (f" ط·آ£ط¸ظ¹ط·آ¶ط·آ§ط¸â€¹ط·إ’ {insight}." if insight else "")
            if language == "ar":
                if speaker.current_opinion == "reject":
                    return (
                        f"{other_tag} ط·آ´ط·آ§ط¸ظ¹ط¸ظ¾ ط·آ§ط¸â€‍ط¸ظ¾ط¸ئ’ط·آ±ط·آ© ط·آ¬ط¸ظ¹ط·آ¯ط·آ©ط·إ’ ط¸â€‍ط¸ئ’ط¸â€  {focal} ط¸â€¦ط·آ§ ط·آ²ط·آ§ط¸â€‍ط·ع¾ ط¸â€ ط¸â€ڑط·آ·ط·آ© ط·آ¶ط·آ¹ط¸ظ¾ ط¸ث†ط·آ§ط·آ¶ط·آ­ط·آ© ط·آ¹ط¸â€ ط·آ¯ط¸ظ¹. "
                        f"ط¸â€¦ط·آ­ط·ع¾ط·آ§ط·آ¬ ط·آ¯ط¸â€‍ط¸ظ¹ط¸â€‍ ط·آ¹ط¸â€¦ط¸â€‍ط¸ظ¹ ط·آ£ط¸ث† ط·آ£ط·آ±ط¸â€ڑط·آ§ط¸â€¦ ط¸â€ڑط·آ¨ط¸â€‍ ط¸â€¦ط·آ§ ط·آ£ط·ط›ط¸ظ¹ط¸â€کط·آ± ط·آ±ط·آ£ط¸ظ¹ط¸ظ¹. ({constraints}){insight_clause}"
                    )
                if speaker.current_opinion == "accept":
                    return (
                        f"{other_tag} ط¸â€¦ط·ع¾ط·آ­ط¸ظ¾ط·آ¸ط·إ’ ط¸â€‍ط¸ئ’ط¸â€ ط¸ظ¹ ط·آ´ط·آ§ط¸ظ¹ط¸ظ¾ ط·آ£ط¸â€  {focal} ط¸ظ¹ط·آ¹ط·آ·ط¸ظ¹ ط·آ£ط¸ظ¾ط·آ¶ط¸â€‍ط¸ظ¹ط·آ© ط¸ث†ط·آ§ط·آ¶ط·آ­ط·آ© ط¸â€‍ط¸â€‍ط¸ظ¾ط¸ئ’ط·آ±ط·آ© ط·آ­ط·ع¾ط¸â€° ط·آ§ط¸â€‍ط·آ¢ط¸â€ . ({constraints}){insight_clause}"
                    )
                return f"{other_tag} ط¸â€ڑط·آ§ط¸â€‍ ط·آ±ط·آ£ط¸ظ¹ط¸â€،ط·إ’ ط¸ث†ط·آ£ط¸â€ ط·آ§ ط¸â€¦ط·آ­ط·آ§ط¸ظ¹ط·آ¯ ط¸â€‍ط·آ£ط¸â€  ط·ع¾ط¸ظ¾ط·آ§ط·آµط¸ظ¹ط¸â€‍ {focal} ط·ط›ط¸ظ¹ط·آ± ط¸â€¦ط·آ­ط·آ³ط¸ث†ط¸â€¦ط·آ© ط·آ­ط·ع¾ط¸â€° ط·آ§ط¸â€‍ط·آ¢ط¸â€ . ({constraints}){insight_clause}"
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
                    ["ط·ع¾ط·آ­ط·آ³ط¸ظ¹ط¸â€  ط·آ§ط¸â€‍ط¸ئ’ط¸ظ¾ط·آ§ط·طŒط·آ©", "ط¸â€ڑط·آ§ط·آ¨ط¸â€‍ط¸ظ¹ط·آ© ط·آ§ط¸â€‍ط·ع¾ط¸ث†ط·آ³ط·آ¹", "ط·آ²ط¸â€¦ط¸â€  ط·آ§ط¸â€‍ط·آ§ط·آ³ط·ع¾ط·آ¬ط·آ§ط·آ¨ط·آ©", "ط·آ§ط·آ³ط·ع¾ط¸â€ڑط·آ±ط·آ§ط·آ± ط·آ§ط¸â€‍ط¸â€ ط·آ¸ط·آ§ط¸â€¦"]
                    if language == "ar"
                    else ["efficiency gains", "scalability", "latency and reliability", "automation potential"]
                )
            if "entrepreneur" in a or "business" in a:
                return (
                    ["ط·آ§ط¸â€‍ط·آ¹ط·آ§ط·آ¦ط·آ¯ ط·آ¹ط¸â€‍ط¸â€° ط·آ§ط¸â€‍ط·آ§ط·آ³ط·ع¾ط·آ«ط¸â€¦ط·آ§ط·آ±", "ط·آ·ط¸â€‍ط·آ¨ ط·آ§ط¸â€‍ط·آ³ط¸ث†ط¸â€ڑ", "ط¸â€،ط·آ§ط¸â€¦ط·آ´ ط·آ§ط¸â€‍ط·آ±ط·آ¨ط·آ­", "ط·ع¾ط¸ئ’ط¸â€‍ط¸ظ¾ط·آ© ط·آ§ط¸â€‍ط·آ§ط·آ³ط·ع¾ط·آ­ط¸ث†ط·آ§ط·آ°"]
                    if language == "ar"
                    else ["ROI", "market demand", "profit margin", "pricing leverage"]
                )
            if "worker" in a or "employee" in c:
                return (
                    ["ط·آ§ط¸â€‍ط·ع¾ط¸ث†ط¸ظ¾ط¸ظ¹ط·آ± ط·آ§ط¸â€‍ط·آ´ط¸â€،ط·آ±ط¸ظ¹", "ط·آ³ط¸â€،ط¸ث†ط¸â€‍ط·آ© ط·آ§ط¸â€‍ط·آ§ط·آ³ط·ع¾ط·آ®ط·آ¯ط·آ§ط¸â€¦", "ط·آ§ط¸â€‍ط·آ§ط·آ³ط·ع¾ط¸â€ڑط·آ±ط·آ§ط·آ± ط·آ§ط¸â€‍ط¸ث†ط·آ¸ط¸ظ¹ط¸ظ¾ط¸ظ¹", "ط·آ§ط¸â€‍ط¸â€¦ط¸ث†ط·آ«ط¸ث†ط¸â€ڑط¸ظ¹ط·آ©"]
                    if language == "ar"
                    else ["monthly savings", "reliability", "day-to-day usability", "job stability"]
                )
            return (
                ["ط·ع¾ط¸ث†ط·آ§ط¸ظ¾ط¸â€ڑ ط·آ§ط¸â€‍ط·آ³ط¸ث†ط¸â€ڑ", "ط·آ§ط¸â€‍ط·آ«ط¸â€ڑط·آ©", "ط·آ§ط¸â€‍ط·آ§ط¸â€¦ط·ع¾ط·آ«ط·آ§ط¸â€‍", "ط·ع¾ط·آ¨ط¸â€ ط¸ظ¹ ط·آ§ط¸â€‍ط¸â€¦ط·آ³ط·ع¾ط·آ®ط·آ¯ط¸â€¦ط¸ظ¹ط¸â€ "]
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
                else ["ط¸â€¦ط¸â€  ط¸ث†ط·آ¬ط¸â€،ط·آ© ط¸â€ ط·آ¸ط·آ±ط¸ظ¹", "ط·آ¨ط·آ­ط¸ئ’ط¸â€¦ ط·آ®ط·آ¨ط·آ±ط·ع¾ط¸ظ¹", "ط¸ئ’ط¸â€¦ط¸â€¦ط·آ«ط¸â€‍ ط¸â€‍ط¸â€،ط·آ°ط·آ§ ط·آ§ط¸â€‍ط¸â€ ط¸ث†ط·آ¹ ط¸â€¦ط¸â€  ط·آ§ط¸â€‍ط·آ¬ط¸â€¦ط¸â€،ط¸ث†ط·آ±", "ط·آ¨ط·آ±ط·آ£ط¸ظ¹ط¸ظ¹ ط·آ§ط¸â€‍ط·آ´ط·آ®ط·آµط¸ظ¹"],
            )
            vocab = _persona_vocab(archetype, category, language)
            insight = _research_insight()
            focal = _pick_phrase(f"{agent.agent_id}-vocab-{iteration}", vocab) if vocab else _idea_concerns()
            peer = _pick_phrase(
                f"{agent.agent_id}-peer-{iteration}",
                ["Agent A", "Agent B", "Agent C"] if language != "ar" else ["ط·آ§ط¸â€‍ط¸ث†ط¸ئ’ط¸ظ¹ط¸â€‍ ط·آ£", "ط·آ§ط¸â€‍ط¸ث†ط¸ئ’ط¸ظ¹ط¸â€‍ ط·آ¨", "ط·آ§ط¸â€‍ط¸ث†ط¸ئ’ط¸ظ¹ط¸â€‍ ط·آ¬"],
            )
            if changed and prev_opinion and new_opinion:
                if new_opinion == "accept":
                    if language == "ar":
                        return (
                            f"{prefix} ({archetype}) ط·آ£ط·آµط·آ¨ط·آ­ط·ع¾ ط¸â€¦ط¸ظ¹ط¸â€کط·آ§ط¸â€‍ط·آ§ط¸â€¹ ط¸â€‍ط¸â€‍ط¸â€ڑط·آ¨ط¸ث†ط¸â€‍ ط¸â€‍ط·آ£ط¸â€  {idea_local} ط·ع¾ط·آ¨ط·آ¯ط¸ث† ط¸â€ڑط·آ§ط·آ¨ط¸â€‍ط·آ© ط¸â€‍ط¸â€‍ط·ع¾ط¸â€ ط¸ظ¾ط¸ظ¹ط·آ°ط·إ’ "
                            f"ط¸ث†ط¸â€ ط¸â€ڑط·آ·ط·آ© {peer} ط·آ­ط¸ث†ط¸â€‍ {focal} ط¸â€ڑط¸â€‍ط¸â€‍ط·ع¾ ط·ع¾ط·آ±ط·آ¯ط·آ¯ط¸ظ¹ط·إ’ ط¸â€‍ط¸ئ’ط¸â€  ط¸â€¦ط·آ§ ط·آ²ط¸â€‍ط·ع¾ ط·آ£ط·آ±ط·آ§ط¸â€ڑط·آ¨ ط¸â€¦ط·آ®ط·آ§ط·آ·ط·آ± {_idea_concerns()}."
                        )
                    return (
                        f"{prefix} ({archetype}), I now lean accept because {idea_local} feels feasible "
                        f"and the {focal} case is convincing after {peer}'s point, though {_idea_concerns()} still matters."
                    )
                if new_opinion == "reject":
                    if language == "ar":
                        return (
                            f"{prefix} ({archetype}) ط·آ§ط·ع¾ط·آ¬ط¸â€،ط·ع¾ ط¸â€‍ط¸â€‍ط·آ±ط¸ظ¾ط·آ¶ ط¸â€‍ط·آ£ط¸â€  {idea_local} ط·ع¾ط·آ«ط¸ظ¹ط·آ± ط¸â€¦ط·آ®ط·آ§ط·آ·ط·آ± ط·ع¾ط·آ®ط·آµ "
                            f"{_idea_concerns()}ط·إ’ ط¸ث†ط·ع¾ط·آ­ط·آ°ط¸ظ¹ط·آ± {peer} ط·آ¹ط·آ²ط·آ² ط·آ°ط¸â€‍ط¸ئ’ط·إ’ ط¸ث†ط¸â€‍ط¸â€¦ ط·آ£ط·آ¬ط·آ¯ ط¸â€¦ط¸ظ¹ط·آ²ط·آ© ط¸â€ڑط¸ث†ط¸ظ¹ط·آ© ط¸ظ¾ط¸ظ¹ {focal}."
                        )
                    return (
                        f"{prefix} ({archetype}), I moved to reject because {idea_local} raises "
                        f"risks around {_idea_concerns()}, and {peer}'s caution reinforced it while {focal} looked weak."
                    )
                if language == "ar":
                    return (
                        f"{prefix} ({archetype}) ط·آ§ط¸â€ ط·ع¾ط¸â€ڑط¸â€‍ط·ع¾ ط¸â€‍ط¸â€‍ط¸â€¦ط¸ث†ط¸â€ڑط¸ظ¾ ط·آ§ط¸â€‍ط¸â€¦ط·آ­ط·آ§ط¸ظ¹ط·آ¯ ط·ع¾ط·آ¬ط·آ§ط¸â€، {idea_local} ط¸â€‍ط·آ£ط¸â€  ط·آ§ط¸â€‍ط¸â€¦ط·آ¤ط·آ´ط·آ±ط·آ§ط·ع¾ "
                        f"ط¸â€¦ط·آ®ط·ع¾ط¸â€‍ط·آ·ط·آ©: ط¸â€،ط¸â€ ط·آ§ط¸ئ’ ط¸ظ¾ط·آ§ط·آ¦ط·آ¯ط·آ© ط¸ظ¾ط¸ظ¹ {focal} ط¸â€‍ط¸ئ’ط¸â€  ط¸â€¦ط·آ®ط·آ§ط·آ·ط·آ± {_idea_concerns()} ط¸â€¦ط·آ§ ط·آ²ط·آ§ط¸â€‍ط·ع¾ ط·آ¨ط¸â€‍ط·آ§ ط·آ¥ط·آ¬ط·آ§ط·آ¨ط·آ©."
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
                    else [f"{focal} ط·ع¾ط·آ¨ط·آ¯ط¸ث† ط¸â€ڑط¸ث†ط¸ظ¹ط·آ©", f"{focal} ط¸â€¦ط·آ§ ط·آ²ط·آ§ط¸â€‍ط·ع¾ ط¸â€¦ط¸â€ڑط¸â€ ط·آ¹ط·آ©", f"{focal} ط·ع¾ط¸ث†ط·آ¶ط·آ­ ط·آ§ط¸â€‍ط¸â€ڑط¸ظ¹ط¸â€¦ط·آ© ط·آ¨ط·آ´ط¸ئ’ط¸â€‍ ط¸ئ’ط·آ§ط¸ظ¾ط¸ع†"],
                )
                if skepticism > 0.6:
                    reason = f"{focal} ط¸ث†ط·آ§ط·آ¶ط·آ­ط·آ© ط¸â€‍ط¸ئ’ط¸â€ ط¸ظ¹ ط·آ£ط·آ±ط¸ظ¹ط·آ¯ ط·آ¶ط¸â€¦ط·آ§ط¸â€ ط·آ§ط·ع¾" if language == "ar" else f"{focal} is clear, but I still want safeguards"
                if language == "ar":
                    return f"{prefix} ({archetype}) ط¸â€¦ط·آ§ ط·آ²ط¸â€‍ط·ع¾ ط·آ£ط¸â€¦ط¸ظ¹ط¸â€‍ ط¸â€‍ط¸â€‍ط¸â€ڑط·آ¨ط¸ث†ط¸â€‍ ط·آ¨ط·آ®ط·آµط¸ث†ط·آµ {idea_local} ط¸â€‍ط·آ£ط¸â€  {reason}ط·إ’ ط¸â€¦ط·آ¹ ط·ع¾ط·آ­ط¸ظ¾ط·آ¸ ط·آ­ط¸ث†ط¸â€‍ {_idea_concerns()}."
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
                        f"ط¸â€¦ط·آ®ط·آ§ط·آ·ط·آ± {focal} ط¸â€¦ط·آ±ط·ع¾ط¸ظ¾ط·آ¹ط·آ©ط·إ’ ط·آ®ط·آµط¸ث†ط·آµط·آ§ط¸â€¹ ط¸ظ¾ط¸ظ¹ط¸â€¦ط·آ§ ط¸ظ¹ط·ع¾ط·آ¹ط¸â€‍ط¸â€ڑ ط·آ¨ط¸â‚¬ {_idea_concerns()}",
                        f"ط·آ¹ط·آ¯ط¸â€¦ ط¸ث†ط·آ¶ط¸ث†ط·آ­ {focal} ط¸â€¦ط·آ§ ط·آ²ط·آ§ط¸â€‍ ط¸ئ’ط·آ¨ط¸ظ¹ط·آ±ط·آ§ط¸â€¹",
                        f"{focal} ط¸ث† {_idea_concerns()} ط¸â€‍ط¸â€¦ ط·ع¾ط¸عˆط·آ­ط¸â€‍ ط·آ¨ط·آ¹ط·آ¯",
                    ],
                )
                if risk_tolerance > 0.7:
                    reason = f"{focal} ط¸â€¦ط·آ±ط·ع¾ط¸ظ¾ط·آ¹ط·آ© ط¸ث†ط·آ§ط¸â€‍ط¸â€ڑط¸ظ¹ط¸â€¦ط·آ© ط·ط›ط¸ظ¹ط·آ± ط¸ث†ط·آ§ط·آ¶ط·آ­ط·آ©" if language == "ar" else f"{focal} is high and the value is unclear"
                if language == "ar":
                    return f"{prefix} ({archetype}) ط·آ£ط¸â€¦ط¸ظ¹ط¸â€‍ ط¸â€‍ط¸â€‍ط·آ±ط¸ظ¾ط·آ¶ ط·آ¨ط·آ®ط·آµط¸ث†ط·آµ {idea_local} ط¸â€‍ط·آ£ط¸â€  {reason}ط·إ’ ط¸ث†ط¸â€‍ط·آ§ ط·آ£ط·آ±ط¸â€° ط¸â€¦ط¸ظ¹ط·آ²ط·آ© ط·آ­ط¸â€ڑط¸ظ¹ط¸â€ڑط¸ظ¹ط·آ© ط¸ظ¾ط¸ظ¹ {focal} ط·آ¨ط·آ¹ط·آ¯."
                return f"{prefix} ({archetype}), I'm leaning reject on {idea_local} because {reason}, and {focal} doesn't offset it yet."

            if optimism > 0.6:
                if language == "ar":
                    return f"{prefix} ({archetype}) ط¸â€¦ط·آ§ ط·آ²ط¸â€‍ط·ع¾ ط¸â€¦ط·آ­ط·آ§ط¸ظ¹ط·آ¯ط·آ§ط¸â€¹ ط·ع¾ط·آ¬ط·آ§ط¸â€، {idea_local}: ط·آ£ط·آ±ط¸â€° ط·آ¥ط¸â€¦ط¸ئ’ط·آ§ط¸â€ ط·آ§ط·ع¾ ط¸ظ¾ط¸ظ¹ {focal}ط·إ’ ط¸â€‍ط¸ئ’ط¸â€  ط·آ§ط¸â€‍ط·آ£ط·آ¯ط¸â€‍ط·آ© ط¸â€‍ط¸ظ¹ط·آ³ط·ع¾ ط¸â€ڑط¸ث†ط¸ظ¹ط·آ© ط·آ¨ط·آ¹ط·آ¯."
                return f"{prefix} ({archetype}), I stay neutral on {idea_local}: I see potential in {focal}, but the evidence is not strong yet."

            if language == "ar":
                return (
                    f"{prefix} ({archetype}) ط¸â€¦ط·آ§ ط·آ²ط¸â€‍ط·ع¾ ط¸â€¦ط·آ­ط·آ§ط¸ظ¹ط·آ¯ط·آ§ط¸â€¹ ط¸â€‍ط·آ£ط¸â€  ط·آ¨ط¸ظ¹ط·آ§ط¸â€ ط·آ§ط·ع¾ {focal} ط·ط›ط¸ظ¹ط·آ± ط¸ئ’ط·آ§ط¸ظ¾ط¸ظ¹ط·آ© ط¸â€‍ط·آ¯ط¸ظ¹ ط·آ§ط¸â€‍ط·آ¢ط¸â€ ط·إ’ "
                    f"ط¸ث†ط¸â€¦ط·آ®ط·آ§ط·آ·ط·آ± {_idea_concerns()} ط·ع¾ط·آ­ط·ع¾ط·آ§ط·آ¬ ط·ع¾ط¸ث†ط·آ¶ط¸ظ¹ط·آ­ط·آ§ط¸â€¹ ط·آ¹ط¸â€¦ط¸â€‍ط¸ظ¹ط·آ§ط¸â€¹ ط¸â€ڑط·آ¨ط¸â€‍ ط·آ§ط¸â€‍ط·آ­ط·آ³ط¸â€¦."
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
            if idea_risk > 0:
                base_risk_boost = idea_risk * (0.18 + (0.22 * (1.0 - risk_tolerance)))
                weights["reject"] += base_risk_boost
                penalty += base_risk_boost * 0.35
            if competition in {"high", "crowded", "saturated"}:
                weights["reject"] += 0.24 * negative_scale
                penalty += 0.12 * negative_scale
            if competition in {"medium", "moderate"}:
                weights["reject"] += 0.14 * negative_scale
            if demand in {"low", "weak"}:
                weights["reject"] += 0.22 * negative_scale
                penalty += 0.12 * negative_scale
            if demand in {"medium", "moderate"}:
                weights["reject"] += 0.12 * negative_scale
            if regulatory in {"high", "strict"}:
                weights["reject"] += 0.32 * negative_scale
                penalty += 0.18 * negative_scale
            if regulatory in {"medium", "moderate"}:
                weights["reject"] += 0.18 * negative_scale
            if price in {"high"}:
                weights["reject"] += 0.14 * negative_scale
                penalty += 0.08 * negative_scale
            if demand in {"high", "strong"}:
                weights["accept"] += 0.18 * positive_scale
            if competition in {"low"}:
                weights["accept"] += 0.14 * positive_scale
            if penalty > 0 and agent.current_opinion == "accept":
                agent.confidence = max(0.2, agent.confidence - penalty)
            if demand in {"high", "strong"} and agent.current_opinion == "reject":
                agent.confidence = max(0.2, agent.confidence - (0.04 * positive_scale))

        # Dialogue orchestration (formal state machine)
        phase_order = [
            "Intake",
            "Research Digest",
            "Agent Init",
            "Deliberation",
            "Convergence",
            "Verdict",
            "Summary",
        ]
        phase_key_map = {
            "Intake": "intake",
            "Research Digest": "research_digest",
            "Agent Init": "agent_init",
            "Deliberation": "deliberation",
            "Convergence": "convergence",
            "Verdict": "verdict",
            "Summary": "summary",
        }

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
            # Ensure we don't sample only one opinion when others exist.
            opinions_present = {a.current_opinion for a in agents}
            selected_opinions = {a.current_opinion for a in selected}
            missing = [op for op in opinions_present if op not in selected_opinions]
            if missing and selected:
                selected_counts = Counter(a.current_opinion for a in selected)
                for op in missing:
                    candidates = [a for a in agents if a.current_opinion == op and a not in selected]
                    if not candidates:
                        continue
                    max_op = max(selected_counts, key=selected_counts.get)
                    replace_idx = next((i for i, a in enumerate(selected) if a.current_opinion == max_op), None)
                    if replace_idx is None:
                        continue
                    selected[replace_idx] = random.choice(candidates)
                    selected_counts[max_op] = max(0, selected_counts[max_op] - 1)
                    selected_counts[op] = selected_counts.get(op, 0) + 1
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
                evidence_by_role[role] = _dedupe(combined)[:6]
            return evidence_by_role

        evidence_by_role = _build_role_evidence(evidence_cards)
        used_openers_seed = resume_state.get("used_openers")
        used_openers: set[str] = set(
            str(item).strip().lower()
            for item in (used_openers_seed or [])
            if str(item).strip()
        )
        dialogue_seed = resume_state.get("dialogue_history")
        if not isinstance(dialogue_seed, list):
            dialogue_seed = []
        dialogue_history: deque[Dict[str, Any]] = deque(
            [item for item in dialogue_seed if isinstance(item, dict)],
            maxlen=max_dialogue_context,
        )

        def _pick_reply_target(speaker: Agent) -> Tuple[str, str, str]:
            candidates = [h for h in dialogue_history if h.get("agent_id") != speaker.agent_id]
            if candidates:
                diff = [c for c in candidates if c.get("opinion") != speaker.current_opinion]
                target = diff[-1] if diff else candidates[-1]
                return target["agent_id"], target["short_id"], target["message"]
            # No prior dialogue: do not force a reply-to reference on the very first message.
            fallback_msg = evidence_cards[0] if evidence_cards else (idea_text.strip() or "the idea")
            if len(fallback_msg) > 220:
                fallback_msg = fallback_msg[:217].rstrip() + "..."
            return "", "", fallback_msg

        def _init_metrics_state() -> Tuple[Dict[str, int], Dict[str, Dict[str, int]]]:
            counts: Dict[str, int] = {"accept": 0, "reject": 0, "neutral": 0}
            breakdown: Dict[str, Dict[str, int]] = {}
            for agent in agents:
                op = agent.current_opinion
                if op not in counts:
                    op = "neutral"
                counts[op] += 1
                cat = agent.category_id
                if cat not in breakdown:
                    breakdown[cat] = {"accept": 0, "reject": 0, "neutral": 0}
                breakdown[cat][op] += 1
            return counts, breakdown

        resume_metrics_counts = resume_state.get("metrics_counts")
        resume_metrics_breakdown = resume_state.get("metrics_breakdown")
        if isinstance(resume_metrics_counts, dict) and isinstance(resume_metrics_breakdown, dict):
            metrics_counts = {
                "accept": int(resume_metrics_counts.get("accept") or 0),
                "reject": int(resume_metrics_counts.get("reject") or 0),
                "neutral": int(resume_metrics_counts.get("neutral") or 0),
            }
            metrics_breakdown: Dict[str, Dict[str, int]] = {}
            for category_id, values in resume_metrics_breakdown.items():
                if not isinstance(values, dict):
                    continue
                metrics_breakdown[str(category_id)] = {
                    "accept": int(values.get("accept") or 0),
                    "reject": int(values.get("reject") or 0),
                    "neutral": int(values.get("neutral") or 0),
                }
        else:
            metrics_counts, metrics_breakdown = _init_metrics_state()

        def _apply_metrics_change(category_id: str, prev: str, new: str) -> None:
            if prev == new:
                return
            if prev not in metrics_counts:
                prev = "neutral"
            if new not in metrics_counts:
                new = "neutral"
            metrics_counts[prev] = max(0, metrics_counts.get(prev, 0) - 1)
            metrics_counts[new] = metrics_counts.get(new, 0) + 1
            if category_id not in metrics_breakdown:
                metrics_breakdown[category_id] = {"accept": 0, "reject": 0, "neutral": 0}
            metrics_breakdown[category_id][prev] = max(0, metrics_breakdown[category_id].get(prev, 0) - 1)
            metrics_breakdown[category_id][new] = metrics_breakdown[category_id].get(new, 0) + 1

        def _build_metrics_payload(iteration_value: int) -> Dict[str, Any]:
            total = len(agents)
            accepted = metrics_counts.get("accept", 0)
            rejected = metrics_counts.get("reject", 0)
            neutral = metrics_counts.get("neutral", 0)
            acceptance_rate = accepted / total if total > 0 else 0.0
            decided = accepted + rejected
            if decided > 0:
                balance = 1.0 - (abs(accepted - rejected) / decided)
                polarization = max(0.0, min(1.0, balance * (decided / total)))
            else:
                polarization = 0.0
            per_category = {k: v.get("accept", 0) for k, v in metrics_breakdown.items()}
            return {
                "accepted": accepted,
                "rejected": rejected,
                "neutral": neutral,
                "acceptance_rate": acceptance_rate,
                "polarization": polarization,
                "total_agents": total,
                "per_category": per_category,
                "iteration": iteration_value,
                "total_iterations": effective_total_iterations,
            }

        def _clip_text(value: str, limit: int) -> str:
            value = re.sub(r"\s+", " ", (value or "").strip())
            if len(value) <= limit:
                return value
            return value[: max(0, limit - 3)].rstrip() + "..."

        def _compact_traits(traits: Dict[str, float]) -> str:
            optimism = float(traits.get("optimism", 0.5))
            skepticism = float(traits.get("skepticism", 0.5))
            risk_tolerance = float(traits.get("risk_tolerance", 0.5))
            stubbornness = float(traits.get("stubbornness", 0.4))
            return f"optimism={optimism:.2f}, skepticism={skepticism:.2f}, risk={risk_tolerance:.2f}, stubborn={stubbornness:.2f}"

        def _detect_output_language() -> str:
            has_ar = bool(re.search(r"[\u0600-\u06FF]", idea_text or ""))
            has_en = bool(re.search(r"[A-Za-z]", idea_text or ""))
            if has_ar and has_en:
                return "mixed"
            if language in {"ar", "en"}:
                return language
            if has_ar and not has_en:
                return "ar"
            if has_en and not has_ar:
                return "en"
            return "ar"

        output_language = _detect_output_language()
        clarification_history_seed = checkpoint_meta.get("clarification_history")
        clarification_history: List[Dict[str, Any]] = []
        if isinstance(clarification_history_seed, list):
            for item in clarification_history_seed:
                if isinstance(item, dict):
                    clarification_history.append(dict(item))
        pending_clarification_seed = checkpoint_meta.get("pending_clarification")
        pending_clarification_state: Optional[Dict[str, Any]] = (
            dict(pending_clarification_seed)
            if isinstance(pending_clarification_seed, dict)
            else None
        )
        try:
            last_clarification_step = int(checkpoint_meta.get("last_clarification_step") or 0)
        except Exception:
            last_clarification_step = 0
        last_clarification_reason_tag = str(checkpoint_meta.get("last_clarification_reason_tag") or "").strip()
        last_clarification_phase = str(checkpoint_meta.get("last_clarification_phase") or "").strip()
        try:
            clarification_count = int(checkpoint_meta.get("clarification_count") or 0)
        except Exception:
            clarification_count = 0
        clarification_notice_sent = bool(checkpoint_meta.get("clarification_notice_sent"))
        telemetry_seed = resume_state.get("reasoning_telemetry") if isinstance(resume_state.get("reasoning_telemetry"), dict) else {}
        try:
            clarification_total_steps = int(
                telemetry_seed.get("total_steps")
                or checkpoint_meta.get("total_reasoning_steps")
                or 0
            )
        except Exception:
            clarification_total_steps = 0

        reason_tag_keywords: Dict[str, List[str]] = {
            "privacy_surveillance": [
                "privacy", "surveillance", "tracking", "gps", "messages", "private chat", "bank", "banking",
                "pii", "personal data", "monitor", "مراقبة", "خصوصية", "تتبع", "تحركات", "رسائل خاصة", "بيانات شخصية",
            ],
            "legal_compliance": [
                "legal", "law", "gdpr", "eeoc", "compliance", "regulation", "liability", "audit", "policy",
                "قانون", "امتثال", "تشريعات", "لائحة", "تنظيم", "مساءلة", "تدقيق",
            ],
            "ethical_discrimination": [
                "ethic", "ethical", "discrimination", "bias", "fairness", "unfair", "تمييز", "تحيز", "عدالة", "أخلاقي",
            ],
            "unclear_target": [
                "target audience", "segment", "customer", "persona", "who will use", "من هو العميل", "الجمهور", "الشريحة",
            ],
            "unclear_value": [
                "value proposition", "why now", "unclear value", "problem fit", "need clearer benefit",
                "القيمة", "غير واضح", "الفائدة", "حل المشكلة",
            ],
            "feasibility_scalability": [
                "feasible", "feasibility", "scalability", "latency", "infrastructure", "implementation",
                "maintenance", "complexity", "deploy", "تشغيل", "قابلية", "توسع", "تنفيذ", "تعقيد",
            ],
            "market_demand": [
                "market", "demand", "competition", "pricing", "cac", "roi", "sales", "traction",
                "السوق", "الطلب", "منافسة", "تسعير", "عوائد",
            ],
            "evidence_gap": [
                "evidence", "source", "citation", "proof", "missing data", "insufficient data", "need data",
                "أدلة", "مصدر", "إثبات", "بيانات غير كافية",
            ],
        }
        # Keep a stable text fallback for prompts even when structured research is missing.
        try:
            research_signals = _research_signals_text()
        except Exception:
            research_signals = ""

        def _normalized(text: str) -> str:
            return re.sub(r"\s+", " ", (text or "").strip().lower())

        def _extract_text_from_llm_output(raw_value: Any) -> str:
            raw_text = str(raw_value or "").strip()
            if not raw_text:
                return ""
            candidates = [raw_text]
            fenced = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", raw_text, re.DOTALL)
            if fenced:
                candidates.append(fenced.group(1).strip())
            for pattern in (r"(\{.*\})", r"(\[.*\])"):
                match = re.search(pattern, raw_text, re.DOTALL)
                if match:
                    candidates.append(match.group(1).strip())
            for candidate in candidates:
                try:
                    parsed = json.loads(candidate)
                except Exception:
                    continue
                if isinstance(parsed, dict):
                    for key in ("message", "text", "response", "content"):
                        value = parsed.get(key)
                        if isinstance(value, str) and value.strip():
                            return value.strip()
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict):
                            value = item.get("message") or item.get("text")
                            if isinstance(value, str) and value.strip():
                                return value.strip()
            if raw_text.startswith('"') and raw_text.endswith('"'):
                try:
                    return str(json.loads(raw_text))
                except Exception:
                    pass
            return raw_text

        template_signatures = {
            _normalized("كمختص"),
            _normalized("as a"),
            _normalized("I need more clarity"),
            _normalized("this could work if executed carefully"),
            _normalized("this is too risky to accept as-is"),
        }
        generic_signatures = {
            _normalized("As a specialist"),
            _normalized("Based on the available data"),
            _normalized("I need more concrete detail before deciding"),
            _normalized("كمختص"),
            _normalized("أنا محتاج توضيح أكتر قبل ما أحكم"),
        }

        def _build_reasoning_prompt(task: Dict[str, Any]) -> str:
            context_turns = list(dialogue_history)[-reasoning_context_turns:]
            context_lines: List[str] = []
            for turn in context_turns:
                short_id = str(turn.get("short_id") or "")[:4]
                msg = _clip_text(str(turn.get("message") or ""), 180)
                if short_id and msg:
                    context_lines.append(f"- {short_id}: {msg}")
            role_label = str(task.get("role_label") or "Participant")
            role_guidance = str(task.get("role_guidance") or "")
            evidence_hints = task.get("evidence_hints") or []
            if not isinstance(evidence_hints, list):
                evidence_hints = []
            evidence_hints = [str(item).strip() for item in evidence_hints if str(item).strip()][:2]
            reply_to_short = str(task.get("reply_to_short") or "")
            reply_hint = _clip_text(str(task.get("reply_to_message") or ""), 180)
            style_hint = {
                "ar": "Arabic (Egyptian colloquial), natural and direct.",
                "en": "English, natural spoken tone.",
                "mixed": "Natural mixed Arabic-English only if it feels organic.",
            }[output_language]
            lines = [
                "You are one agent in a social simulation debate.",
                f"Idea: {idea_label_for_llm}",
                f"Role: {role_label}",
                f"Phase: {task.get('phase_label') or 'debate'}",
                f"Role guidance: {role_guidance}",
                f"Traits: {task.get('traits_summary')}",
                f"Biases: {task.get('bias_summary')}",
                f"Current stance hint: {task.get('math_opinion')}",
                f"Style language: {style_hint}",
                f"Reasoning length mode: {task.get('length_mode')}",
                "Write 2-4 concise, natural sentences.",
                "No templates, no bullet lists, no boilerplate.",
                "Ground the reasoning in concrete details from context/evidence.",
            ]
            if hard_unsafe_triggered:
                lines.extend(
                    [
                        "Policy mode is HARD SAFETY GATE.",
                        "The idea appears high-risk; explicitly address legal, ethical, privacy, and discrimination impact.",
                        "Do not endorse harmful surveillance/punitive behavior.",
                    ]
                )
            if research_summary or research_signals:
                lines.append(f"Research summary: {_clip_text(research_summary or research_signals, 280)}")
            if context_lines:
                lines.append("Recent debate context:")
                lines.extend(context_lines)
            if evidence_hints:
                lines.append("Evidence hints:")
                lines.extend([f"- {hint}" for hint in evidence_hints])
            if reply_to_short:
                lines.append(f"Reply target short id: {reply_to_short}")
                lines.append(f"Reply target message: {reply_hint}")
                lines.append("Address the reply target's argument naturally without adding IDs or metadata markers.")
            lines.append("Return plain text only.")
            return "\n".join(lines)

        def _compute_relevance_score(text: str, task: Dict[str, Any]) -> float:
            message_tokens = set(_extract_words(text))
            if not message_tokens:
                return 0.0
            references: List[str] = []
            references.extend(_extract_words(idea_label_for_llm))
            references.extend(_extract_words(str(task.get("evidence_hint") or "")))
            references.extend(_extract_words(str(task.get("reply_to_message") or "")))
            references.extend(_extract_words(str(research_summary or research_signals or "")))
            reference_tokens = set(references)
            if not reference_tokens:
                return 0.5
            overlap = len(message_tokens & reference_tokens)
            base_score = overlap / max(1, min(len(message_tokens), len(reference_tokens)))
            if task.get("reply_to_short") and task.get("reply_to_message"):
                reply_tokens = set(_extract_words(str(task.get("reply_to_message") or "")))
                if reply_tokens:
                    reply_overlap = len(message_tokens & reply_tokens) / max(1, len(reply_tokens))
                    base_score = (base_score * 0.7) + (reply_overlap * 0.3)
            return max(0.0, min(1.0, base_score))

        def _validate_generated_reasoning(text: str, task: Dict[str, Any]) -> Tuple[bool, str, float]:
            content = _normalized(text)
            relevance_score = _compute_relevance_score(text, task)
            if not content:
                return False, "empty", relevance_score
            if len(content) < reasoning_min_chars:
                return False, "too_short", relevance_score
            if len(content) > full_limit:
                return False, "too_long", relevance_score
            if any(content.startswith(sig) for sig in template_signatures):
                return False, "template_prefix", relevance_score
            if any(sig in content for sig in generic_signatures):
                return False, "generic_template", relevance_score
            opener = " ".join(content.split()[:4]).strip()
            if opener and opener in used_openers:
                return False, "reused_opener", relevance_score
            message_tokens = set(_extract_words(text))
            idea_tokens = set(_extract_words(idea_label_for_llm))
            if idea_tokens and not (message_tokens & idea_tokens):
                return False, "idea_anchor_missing", relevance_score
            if hard_unsafe_triggered:
                safety_tokens = {
                    "privacy", "ethical", "ethic", "legal", "compliance", "discrimination", "bias", "consent",
                    "خصوصية", "أخلاقي", "قانون", "امتثال", "تمييز", "تحيز", "موافقة",
                }
                if not (message_tokens & safety_tokens):
                    return False, "safety_anchor_missing", relevance_score
            if relevance_score < reasoning_min_relevance:
                return False, "low_relevance", relevance_score
            return True, "ok", relevance_score

        async def _generate_reasoning_text(task: Dict[str, Any]) -> Tuple[str, int, str, float]:
            try:
                prompt = _build_reasoning_prompt(task)
            except Exception:
                prompt = (
                    "You are one agent in a social simulation debate.\n"
                    f"Idea: {idea_label_for_llm}\n"
                    f"Role: {task.get('role_label') or 'Participant'}\n"
                    "Write 2-4 concise, natural sentences tied to the idea.\n"
                    "Return plain text only."
                )
            last_reason = "unknown"
            last_relevance = 0.0
            for attempt in range(1, reasoning_max_retries + 1):
                patched_prompt = prompt
                if attempt > 1:
                    patched_prompt += (
                        "\n\nRewrite with different wording. "
                        f"Previous rejection reason: {last_reason}. "
                        "Avoid repeating previous structure."
                    )
                try:
                    seed_value = int(
                        hashlib.sha256(
                            f"{task['agent'].agent_id}:{task.get('phase_label','')}:{task.get('reply_to_short','')}:{attempt}".encode("utf-8")
                        ).hexdigest()[:8],
                        16,
                    )
                    async with llm_semaphore:
                        raw = await generate_ollama(
                            prompt=patched_prompt,
                            temperature=min(1.15, reasoning_temp + (attempt - 1) * 0.08),
                            seed=seed_value,
                            options={
                                "repeat_penalty": min(1.8, 1.15 + (attempt - 1) * 0.1),
                                "frequency_penalty": 0.7,
                            },
                        )
                except Exception:
                    last_reason = "llm_error"
                    continue
                text = _clip_text(_extract_text_from_llm_output(raw), full_limit)
                ok, reason, relevance_score = _validate_generated_reasoning(text, task)
                last_relevance = relevance_score
                if ok:
                    opener = " ".join(_normalized(text).split()[:4]).strip()
                    if opener:
                        used_openers.add(opener)
                    return text, attempt, "ok", relevance_score
                last_reason = reason
                reasoning_stats["rejections"][reason] = int(reasoning_stats["rejections"].get(reason, 0)) + 1
            return "", reasoning_max_retries, last_reason, last_relevance

        def _build_single_prompt(task: Dict[str, Any]) -> str:
            idea = idea_label_for_llm
            insight = _clip_text(research_summary or research_signals or "", 220)
            language_note = "Arabic (Egyptian slang)" if language == "ar" else "English"
            payload = {
                "agent_id": task["agent"].agent_id,
                "role": task["role_label"],
                "traits": task["traits_summary"],
                "biases": task["bias_summary"],
                "prior_stance": task["math_opinion"],
                "reply_to": task.get("reply_to_short") or "",
                "reply_hint": task.get("reply_to_message") or "",
                "length": task["length_mode"],
                "evidence": task.get("evidence_hint") or "",
            }
            return (
                "You are generating human reasoning for a social simulation.\n"
                "Return JSON ONLY: {\"agent_id\": string, \"stance\": \"accept|reject|neutral\", \"confidence\": 0-1, \"message\": string}.\n"
                "Use language: "
                + language_note
                + ".\n"
                "Length rules: short=1-2 sentences, max "
                + str(short_limit)
                + " chars. full=2-4 sentences, max "
                + str(full_limit)
                + " chars.\n"
                "If reply_to is empty, do NOT mention any other agent.\n"
                "Use prior_stance as a hint, but decide stance based on meaning.\n\n"
                "IDEA: "
                + idea
                + "\n"
                + ("RESEARCH: " + insight + "\n" if insight else "")
                + "TASK JSON:\n"
                + json.dumps(payload, ensure_ascii=False)
            )

        def _normalize_stance(value: Any) -> str | None:
            stance = str(value or "").strip().lower()
            if stance in {"accept", "reject", "neutral"}:
                return stance
            return None

        def _resolve_stance_semantic(
            stance_value: str | None,
            preferred_value: str | None,
            previous_value: str | None = None,
        ) -> str:
            """
            Resolve stance without random forcing.
            Priority: LLM/classifier stance -> computed preferred -> previous state -> neutral.
            """
            stance_norm = _normalize_stance(stance_value)
            preferred_norm = _normalize_stance(preferred_value)
            previous_norm = _normalize_stance(previous_value)
            resolved = stance_norm or preferred_norm or previous_norm or "neutral"
            if not disable_random_stance_force:
                # Backward-compatible branch for emergency rollback only.
                return resolved
            return resolved

        def _decode_llm_json(raw_value: Any) -> Dict[str, Any]:
            raw_text = str(raw_value or "").strip()
            if not raw_text:
                raise RuntimeError("Empty LLM response")
            candidates = [raw_text]
            fenced = re.search(r"```(?:json)?\s*(\{.*?\}|\[.*?\])\s*```", raw_text, re.DOTALL)
            if fenced:
                candidates.append(fenced.group(1).strip())
            for pattern in (r"(\{.*\})", r"(\[.*\])"):
                match = re.search(pattern, raw_text, re.DOTALL)
                if match:
                    candidates.append(match.group(1).strip())
            for candidate in candidates:
                try:
                    parsed = json.loads(candidate)
                except Exception:
                    continue
                if isinstance(parsed, dict):
                    return parsed
                if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                    return parsed[0]
            raise RuntimeError("Unable to parse LLM JSON response")

        async def _run_single(task: Dict[str, Any]) -> Dict[str, Any]:
            prompt = _build_single_prompt(task)
            async with llm_semaphore:
                raw = await generate_ollama(
                    prompt=prompt,
                    temperature=reasoning_temp,
                    response_format="json",
                )
            data = _decode_llm_json(raw)
            stance = _normalize_stance(data.get("stance"))
            message = str(data.get("message") or "").strip()
            conf_val = data.get("confidence")
            try:
                confidence = float(conf_val)
            except Exception:
                confidence = 0.5
            return {
                "stance": stance,
                "message": message,
                "confidence": max(0.0, min(1.0, confidence)),
                "source": "llm",
            }

        def _fallback_message(role_label: str, stance: str, evidence_hint: str) -> str:
            if language == "ar":
                if stance == "reject":
                    base = f"كمختص {role_label}، أنا شايف الفكرة دي خطرة ومش هتنفع بالشكل ده."
                elif stance == "accept":
                    base = f"كمختص {role_label}، الفكرة دي ممكن تمشي لو التنفيذ مضبوط."
                else:
                    base = f"كمختص {role_label}، أنا محتاج توضيح أكتر قبل ما أحكم."
                if hard_unsafe_triggered:
                    base += " السبب الأساسي: مخاطر خصوصية/قانونية وتمييز عالية تتطلب رفض أو تحفّظ واضح."
                if evidence_hint:
                    base += f" مؤشر: {evidence_hint}"
                return _clip_text(base, full_limit)
            if stance == "reject":
                base = f"As {role_label}, this is risky as-is."
            elif stance == "accept":
                base = f"As {role_label}, this could work with disciplined execution."
            else:
                base = f"As {role_label}, I need more concrete detail before deciding."
            if hard_unsafe_triggered:
                base += " Core concern: serious privacy/legal/discrimination risk."
            if evidence_hint:
                base += f" Signal: {evidence_hint}"
            return _clip_text(base, full_limit)

        def _sanitize_reasoning_text(
            raw_text: str,
            role_label: str,
            stance: str,
            evidence_hint: str,
        ) -> Tuple[str, Optional[str]]:
            text = str(raw_text or "").strip()
            if not text:
                return "", None
            guard = detect_mojibake(text)
            if not bool(guard.get("flag")):
                return text, None
            repaired = str(attempt_repair(text) or "").strip()
            repaired = _clip_text(repaired, full_limit)
            repaired_guard = detect_mojibake(repaired) if repaired else {"flag": True}
            if repaired and not bool(repaired_guard.get("flag")):
                return repaired, "repaired"
            return _fallback_message(role_label, stance, evidence_hint), "fallback"

        async def _infer_stance_from_llm(text: str) -> str | None:
            if stance_classifier is None:
                return None
            return await stance_classifier.classify_opinion(
                text=text,
                idea_label=idea_label_for_llm,
                language=language,
            )

        async def _infer_stance_with_confidence(text: str) -> Tuple[str | None, float | None]:
            if stance_classifier is None:
                return None, None
            if hasattr(stance_classifier, "classify_opinion_with_confidence"):
                stance, conf = await stance_classifier.classify_opinion_with_confidence(
                    text=text,
                    idea_label=idea_label_for_llm,
                    language=language,
                )
                return stance, conf
            stance = await stance_classifier.classify_opinion(
                text=text,
                idea_label=idea_label_for_llm,
                language=language,
            )
            return stance, None

        def _apply_policy_guard(stance_value: str | None) -> Tuple[str, bool, Optional[str], bool]:
            stance_norm = _normalize_stance(stance_value) or "neutral"
            if not (safety_guard_enabled and hard_unsafe_triggered):
                return stance_norm, False, None, False
            if stance_norm == "accept":
                return "reject", True, hard_policy_reason or "unsafe_policy", True
            if stance_norm not in {"reject", "neutral"}:
                return "neutral", True, hard_policy_reason or "unsafe_policy", True
            return stance_norm, True, hard_policy_reason or "unsafe_policy", False

        async def _enforce_neutral_cap_before_complete(phase_label_hint: str) -> None:
            nonlocal pending_clarification_state
            nonlocal last_clarification_step
            nonlocal last_clarification_reason_tag
            nonlocal last_clarification_phase
            nonlocal clarification_count
            if neutral_enforcement != "clarification_before_complete":
                return
            neutral_ratio = metrics_counts.get("neutral", 0) / max(1, len(agents))
            if neutral_ratio <= neutral_cap_pct:
                return
            if clarification_count >= max_neutral_clarifications:
                raise RuntimeError(
                    "Neutral cap gate failed after clarification cycles "
                    f"(neutral={neutral_ratio:.2f}, cap={neutral_cap_pct:.2f}, max={max_neutral_clarifications})"
                )
            reason_summary = (
                f"Neutral ratio is still high ({neutral_ratio:.0%}) above cap ({neutral_cap_pct:.0%}). "
                "Need one focused clarification before completion."
                if language != "ar"
                else f"نسبة الحياد ما زالت مرتفعة ({neutral_ratio:.0%}) أعلى من الحد ({neutral_cap_pct:.0%}). "
                "نحتاج توضيحًا مركزًا قبل الإنهاء."
            )
            snippets = [str(msg) for msg in list(recent_messages)[-3:]]
            clarification_payload = await _generate_clarification_payload(
                reason_tag="evidence_gap",
                reason_summary=reason_summary,
                snippets=snippets,
                phase_label=phase_label_hint,
            )
            pending_clarification_state = clarification_payload
            last_clarification_step = int(clarification_total_steps)
            last_clarification_reason_tag = str(clarification_payload.get("reason_tag") or "evidence_gap")
            last_clarification_phase = phase_label_hint
            clarification_count += 1
            clarification_history.append(
                {
                    "question_id": clarification_payload.get("question_id"),
                    "phase_label": phase_label_hint,
                    "reason_tag": clarification_payload.get("reason_tag"),
                    "reason_summary": clarification_payload.get("reason_summary"),
                    "created_at": clarification_payload.get("created_at"),
                }
            )
            raise ClarificationNeeded(clarification_payload)

        total_iterations = len(phase_order)
        effective_total_iterations = total_iterations
        checkpoint_event_seq = int(checkpoint_meta.get("event_seq") or 0)

        def _next_event_seq() -> int:
            nonlocal checkpoint_event_seq
            checkpoint_event_seq += 1
            return checkpoint_event_seq

        async def _emit_event(event_type: str, payload: Dict[str, Any]) -> None:
            if "event_seq" not in payload:
                payload = {**payload, "event_seq": _next_event_seq()}
            await emitter(event_type, payload)

        if should_emit_initial:
            # Emit initial agent snapshot (iteration 0) after emit helpers are ready.
            await _emit_event(
                "agents",
                {
                    "iteration": 0,
                    "total_agents": len(agents),
                    "agents": [_agent_snapshot(agent) for agent in agents],
                },
            )

            # Emit zeroed initial metrics so UI starts from a clean state.
            await _emit_event(
                "metrics",
                {
                    "accepted": 0,
                    "rejected": 0,
                    "neutral": len(agents),
                    "acceptance_rate": 0.0,
                    "polarization": 0.0,
                    "total_agents": len(agents),
                    "per_category": {},
                    "iteration": 0,
                    "total_iterations": num_iterations,
                },
            )

        agent_index: Dict[str, Agent] = {agent.agent_id: agent for agent in agents}

        def _hydrate_task(raw_task: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            if not isinstance(raw_task, dict):
                return None
            agent_id = str(raw_task.get("agent_id") or "").strip()
            agent = agent_index.get(agent_id)
            if agent is None:
                return None
            role_label = str(raw_task.get("role_label") or (agent.archetype_name or agent.category_id))
            phase_label = str(raw_task.get("phase_label") or "")
            role_guidance = str(raw_task.get("role_guidance") or "")
            prev_opinion = str(raw_task.get("prev_opinion") or agent.current_opinion)
            if prev_opinion not in Agent.VALID_OPINIONS:
                prev_opinion = "neutral"
            math_opinion = str(raw_task.get("math_opinion") or agent.current_opinion)
            if math_opinion not in Agent.VALID_OPINIONS:
                math_opinion = prev_opinion
            return {
                "agent": agent,
                "prev_opinion": prev_opinion,
                "math_opinion": math_opinion,
                "changed": bool(raw_task.get("changed")),
                "role_label": role_label,
                "phase_label": phase_label,
                "role_guidance": role_guidance,
                "traits_summary": str(raw_task.get("traits_summary") or _compact_traits(agent.traits)),
                "bias_summary": str(raw_task.get("bias_summary") or (", ".join(agent.biases[:2]) if agent.biases else "none")),
                "reply_to_id": str(raw_task.get("reply_to_id") or ""),
                "reply_to_short": str(raw_task.get("reply_to_short") or ""),
                "reply_to_message": str(raw_task.get("reply_to_message") or ""),
                "length_mode": "full" if str(raw_task.get("length_mode") or "") == "full" else "short",
                "emit_message": bool(raw_task.get("emit_message", True)),
                "evidence_hint": str(raw_task.get("evidence_hint") or ""),
                "evidence_hints": raw_task.get("evidence_hints") or [],
            }

        async def _emit_checkpoint(
            *,
            status_value: str,
            next_iteration: int,
            current_iteration: int = 0,
            phase_label: Optional[str] = None,
            phase_key: Optional[str] = None,
            phase_progress_pct: Optional[float] = None,
            tasks: Optional[List[Dict[str, Any]]] = None,
            next_task_index: int = 0,
            last_error: Optional[str] = None,
            status_reason: Optional[str] = None,
            last_step_uid: Optional[str] = None,
        ) -> None:
            if checkpoint_emitter is None:
                return
            serialized_tasks = [self._serialize_task(task) for task in (tasks or [])]
            payload = {
                "version": 1,
                "seed_value": seed_value,
                "rng_state": self._serialize_random_state(random.getstate()),
                "agents": [self._serialize_agent_runtime(agent) for agent in agents],
                "metrics_counts": dict(metrics_counts),
                "metrics_breakdown": {
                    str(key): {
                        "accept": int(values.get("accept") or 0),
                        "reject": int(values.get("reject") or 0),
                        "neutral": int(values.get("neutral") or 0),
                    }
                    for key, values in metrics_breakdown.items()
                    if isinstance(values, dict)
                },
                "recent_messages": list(recent_messages),
                "dialogue_history": list(dialogue_history),
                "used_openers": sorted(used_openers),
                "reasoning_telemetry": dict(reasoning_stats),
                "meta": {
                    "status": status_value,
                    "status_reason": status_reason or status_value,
                    "policy_mode": policy_mode,
                    "policy_reason": hard_policy_reason if hard_unsafe_triggered else None,
                    "search_quality": search_quality,
                    "run_mode": run_mode,
                    "neutral_cap_pct": float(neutral_cap_pct),
                    "neutral_enforcement": neutral_enforcement,
                    "clarification_count": int(clarification_count),
                    "last_error": last_error,
                    "next_iteration": max(1, int(next_iteration)),
                    "current_iteration": max(0, int(current_iteration)),
                    "phase_label": phase_label,
                    "current_phase_key": phase_key,
                    "phase_progress_pct": float(phase_progress_pct) if phase_progress_pct is not None else None,
                    "event_seq": int(checkpoint_event_seq),
                    "next_task_index": max(0, int(next_task_index)),
                    "current_tasks": serialized_tasks,
                    "total_iterations": total_iterations,
                    "pending_clarification": pending_clarification_state,
                    "last_clarification_step": int(last_clarification_step),
                    "last_clarification_reason_tag": last_clarification_reason_tag or None,
                    "last_clarification_phase": last_clarification_phase or None,
                    "clarification_notice_sent": bool(clarification_notice_sent),
                    "clarification_history": clarification_history[-30:],
                    "total_reasoning_steps": int(clarification_total_steps),
                    "phase_cursor": int(current_iteration),
                    "last_reasoning_step_uid": last_step_uid or None,
                    "agent_state_ref": "agents_table",
                },
            }
            try:
                await checkpoint_emitter(payload)
            except Exception:
                return

        resume_next_iteration = int(checkpoint_meta.get("next_iteration") or 1)
        resume_next_iteration = max(1, min(total_iterations + 1, resume_next_iteration))
        resume_current_iteration = int(checkpoint_meta.get("current_iteration") or 0)
        resume_tasks_payload = checkpoint_meta.get("current_tasks")
        if not isinstance(resume_tasks_payload, list):
            resume_tasks_payload = []
        resume_task_index = int(checkpoint_meta.get("next_task_index") or 0)
        resume_task_index = max(0, resume_task_index)
        last_reasoning_step_uid = str(checkpoint_meta.get("last_reasoning_step_uid") or "").strip() or None

        if resume_current_iteration < 1 and resume_tasks_payload:
            resume_current_iteration = resume_next_iteration
        if resume_current_iteration > total_iterations:
            resume_current_iteration = 0

        start_iteration = resume_current_iteration if resume_current_iteration > 0 else resume_next_iteration
        if start_iteration > total_iterations:
            await _enforce_neutral_cap_before_complete("Finalization Gate")
            final_metrics = compute_metrics(agents)
            await _emit_checkpoint(
                status_value="completed",
                next_iteration=total_iterations + 1,
                current_iteration=0,
                phase_key="completed",
                phase_progress_pct=100.0,
                tasks=[],
                next_task_index=0,
                status_reason="completed",
                last_step_uid=last_reasoning_step_uid,
            )
            return final_metrics

        await _emit_checkpoint(
            status_value="running",
            next_iteration=start_iteration,
            current_iteration=resume_current_iteration,
            phase_label=phase_order[start_iteration - 1] if 0 < start_iteration <= total_iterations else None,
            phase_key=phase_key_map.get(phase_order[start_iteration - 1], "intake") if 0 < start_iteration <= total_iterations else None,
            phase_progress_pct=((max(1, start_iteration) - 1) / max(1, total_iterations)) * 100.0,
            tasks=[],
            next_task_index=resume_task_index if resume_current_iteration else 0,
            status_reason="running",
            last_step_uid=last_reasoning_step_uid,
        )

        for iteration in range(start_iteration, total_iterations + 1):
            phase_label = phase_order[iteration - 1]
            phase_key = phase_key_map.get(phase_label, f"phase_{iteration}")
            phase_start_progress = ((iteration - 1) / max(1, total_iterations)) * 100.0
            await _emit_event(
                "phase_update",
                {
                    "phase_key": phase_key,
                    "phase_label": phase_label,
                    "progress_pct": phase_start_progress,
                    "status": "running",
                },
            )
            opinion_changes: Dict[str, Tuple[str, str, bool]] = {}
            tasks: List[Dict[str, Any]] = []
            next_task_index = 0
            using_resume_tasks = (
                iteration == resume_current_iteration
                and bool(resume_tasks_payload)
            )

            reasoning_phase = phase_key in {"deliberation", "convergence"}

            if not reasoning_phase:
                # Non-dialogue phases: emit entry + completion checkpoints and move on.
                await _emit_checkpoint(
                    status_value="running",
                    next_iteration=iteration,
                    current_iteration=iteration,
                    phase_label=phase_label,
                    phase_key=phase_key,
                    phase_progress_pct=phase_start_progress,
                    tasks=[],
                    next_task_index=0,
                    status_reason="running",
                    last_step_uid=last_reasoning_step_uid,
                )
                await _emit_event(
                    "phase_update",
                    {
                        "phase_key": phase_key,
                        "phase_label": phase_label,
                        "progress_pct": phase_start_progress,
                        "status": "running",
                    },
                )
                await _emit_checkpoint(
                    status_value="running",
                    next_iteration=iteration + 1,
                    current_iteration=0,
                    phase_label=None,
                    phase_key=phase_key,
                    phase_progress_pct=(iteration / max(1, total_iterations)) * 100.0,
                    tasks=[],
                    next_task_index=0,
                    status_reason="running",
                    last_step_uid=last_reasoning_step_uid,
                )
                await _emit_event(
                    "phase_update",
                    {
                        "phase_key": phase_key,
                        "phase_label": phase_label,
                        "progress_pct": (iteration / max(1, total_iterations)) * 100.0,
                        "status": "completed",
                    },
                )
                if step_delay > 0:
                    await asyncio.sleep(step_delay / speed)
                continue

            if using_resume_tasks:
                for raw_task in resume_tasks_payload:
                    hydrated = _hydrate_task(raw_task)
                    if hydrated is not None:
                        tasks.append(hydrated)
                next_task_index = min(max(0, resume_task_index), len(tasks))
            else:
                phase_intensity = 0.85 + (0.1 * iteration)
                influences = compute_pairwise_influences(agents, self.dataset)
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
                            inertia=agent.confidence * 0.35,
                        )
                    # Keep state transitions tied to emitted reasoning messages.
                    opinion_changes[agent.agent_id] = (prev_opinion, new_opinion, changed)

                if num_agents <= 40 or reasoning_scope == "full":
                    speakers = list(agents)
                    random.shuffle(speakers)
                else:
                    base_speakers = int(math.ceil(0.12 * max(1, num_agents)))
                    dynamic_speakers = min(80, max(24, base_speakers))
                    if phase_label in {"Deliberation", "Convergence"}:
                        dynamic_speakers = min(num_agents, max(dynamic_speakers, 36))
                    speakers = _select_speakers(min(num_agents, dynamic_speakers))
                speaker_ids = {agent.agent_id for agent in speakers}

                for agent in agents:
                    prev_opinion, math_opinion, changed = opinion_changes[agent.agent_id]
                    role_key, role_label, role_guidance = agent_roles[agent.agent_id]
                    is_speaker = agent.agent_id in speaker_ids
                    if reasoning_scope == "full":
                        length_mode = "full"
                    elif reasoning_scope == "hybrid" and is_speaker:
                        length_mode = "full"
                    else:
                        length_mode = reasoning_detail
                    if reasoning_scope == "full":
                        emit_message = True
                    else:
                        emit_message = bool(is_speaker)
                    evidence_pool = evidence_by_role.get(role_key) or evidence_cards
                    evidence_hint = _clip_text(str(evidence_pool[0]), 120) if evidence_pool else ""
                    evidence_hints = [_clip_text(str(item), 120) for item in (evidence_pool[:2] if evidence_pool else [])]
                    tasks.append(
                        {
                            "agent": agent,
                            "prev_opinion": prev_opinion,
                            "math_opinion": math_opinion,
                            "changed": changed,
                            "role_label": role_label,
                            "phase_label": phase_label,
                            "role_guidance": role_guidance,
                            "traits_summary": _compact_traits(agent.traits),
                            "bias_summary": ", ".join(agent.biases[:2]) if agent.biases else "none",
                            "reply_to_id": "",
                            "reply_to_short": "",
                            "reply_to_message": "",
                            "length_mode": length_mode,
                            "emit_message": emit_message,
                            "evidence_hint": evidence_hint,
                            "evidence_hints": evidence_hints,
                        }
                    )

            active_speakers = max(1, sum(1 for item in tasks if bool(item.get("emit_message"))))
            clarification_window_cap = min(80, active_speakers)
            clarification_window_size = max(
                1,
                min(
                    clarification_window_cap,
                    max(12, int(math.ceil(0.2 * active_speakers))),
                ),
            )
            clarification_cooldown_steps = min(
                max(4, int(math.ceil(0.08 * active_speakers))),
                max(4, active_speakers),
            )
            phase_clarification_window: deque[Dict[str, Any]] = deque(maxlen=clarification_window_size)
            phase_reasoning_messages = 0

            await _emit_checkpoint(
                status_value="running",
                next_iteration=iteration,
                current_iteration=iteration,
                phase_label=phase_label,
                phase_key=phase_key,
                phase_progress_pct=phase_start_progress,
                tasks=tasks,
                next_task_index=next_task_index,
                status_reason="running",
                last_step_uid=last_reasoning_step_uid,
            )

            tasks_to_process = tasks[next_task_index:]
            processed_index = next_task_index

            for task in tasks_to_process:
                agent = task["agent"]
                prev_opinion = task["prev_opinion"]
                role_label = task["role_label"]
                length_mode = task["length_mode"]
                emit_message = task["emit_message"]
                step_uid = f"{iteration}:{processed_index}:{agent.agent_id}"
                reply_to_id = ""
                reply_to_short = ""
                reply_to_msg = ""
                if length_mode == "full":
                    reply_to_id, reply_to_short, reply_to_msg = _pick_reply_target(agent)
                task["reply_to_id"] = reply_to_id
                task["reply_to_short"] = reply_to_short
                task["reply_to_message"] = reply_to_msg
                message = ""
                confidence = 0.58
                stance = task["math_opinion"]
                opinion_source = "llm"
                fallback_reason: Optional[str] = None
                relevance_score: Optional[float] = None
                attempts_used = 1
                policy_guard = False
                policy_reason: Optional[str] = None
                stance_locked = False
                reason_tag: Optional[str] = None
                clarification_triggered = False
                clarification_payload: Optional[Dict[str, Any]] = None

                if emit_message:
                    reasoning_stats["total_steps"] = int(reasoning_stats.get("total_steps", 0)) + 1
                    if reasoning_engine_v2:
                        message, attempts_used, generation_reason, generated_relevance = await _generate_reasoning_text(task)
                        relevance_score = generated_relevance if generated_relevance > 0 else None
                        reasoning_stats["regeneration_attempts"] = int(reasoning_stats.get("regeneration_attempts", 0)) + max(0, attempts_used - 1)
                        if message:
                            classified_stance, classified_conf = await _infer_stance_with_confidence(message)
                            if classified_stance:
                                stance = classified_stance
                                confidence = float(classified_conf) if isinstance(classified_conf, (int, float)) else 0.68
                                confidence = max(0.0, min(1.0, confidence))
                                opinion_source = "llm_classified"
                                reasoning_stats["classified_steps"] = int(reasoning_stats.get("classified_steps", 0)) + 1
                            else:
                                stance = task["math_opinion"]
                                confidence = 0.58
                                opinion_source = "llm"
                            stance = _resolve_stance_semantic(
                                stance_value=stance,
                                preferred_value=task["math_opinion"],
                                previous_value=prev_opinion,
                            )
                        else:
                            fallback_reason = generation_reason or "generation_failed"
                            stance = _resolve_stance_semantic(
                                stance_value=task["math_opinion"],
                                preferred_value=task["math_opinion"],
                                previous_value=prev_opinion,
                            )
                            message = _fallback_message(role_label, stance, task.get("evidence_hint") or "")
                            opinion_source = "fallback"
                            confidence = 0.32
                            reasoning_stats["fallback_steps"] = int(reasoning_stats.get("fallback_steps", 0)) + 1
                    else:
                        try:
                            result = await _run_single(task)
                        except Exception:
                            result = {"stance": None, "message": "", "confidence": 0.0, "source": "fallback"}

                        stance = _normalize_stance(result.get("stance"))
                        message = str(result.get("message") or "").strip()
                        if message:
                            relevance_score = _compute_relevance_score(message, task)
                        try:
                            confidence = float(result.get("confidence") or 0.0)
                        except Exception:
                            confidence = 0.0
                        confidence = max(0.0, min(1.0, confidence))
                        opinion_source = str(result.get("source", "llm") or "llm")

                        if not stance and message:
                            inferred = await _infer_stance_from_llm(message)
                            stance = inferred or task["math_opinion"]
                            if inferred:
                                opinion_source = "llm_classified"
                                reasoning_stats["classified_steps"] = int(reasoning_stats.get("classified_steps", 0)) + 1
                        if not stance:
                            stance = task["math_opinion"]
                        stance = _resolve_stance_semantic(
                            stance_value=stance,
                            preferred_value=task["math_opinion"],
                            previous_value=prev_opinion,
                        )
                        if not message:
                            message = _fallback_message(role_label, stance, task.get("evidence_hint") or "")
                            opinion_source = "fallback"
                            fallback_reason = "empty_or_invalid_output"
                            reasoning_stats["fallback_steps"] = int(reasoning_stats.get("fallback_steps", 0)) + 1
                else:
                    # Keep non-speaker agents stable to avoid hidden, unexplained stance jumps.
                    stance = _resolve_stance_semantic(
                        stance_value=prev_opinion,
                        preferred_value=task["math_opinion"],
                        previous_value=prev_opinion,
                    )
                    confidence = max(0.25, min(1.0, float(agent.confidence)))
                    opinion_source = "llm"

                stance, policy_guard, policy_reason, stance_locked = _apply_policy_guard(stance)

                limit = full_limit if length_mode == "full" else short_limit
                message = _clip_text(message, limit)
                sanitized_state: Optional[str] = None
                if message:
                    message, sanitized_state = _sanitize_reasoning_text(
                        raw_text=message,
                        role_label=role_label,
                        stance=stance,
                        evidence_hint=task.get("evidence_hint") or "",
                    )
                    if sanitized_state == "fallback":
                        if opinion_source != "fallback":
                            reasoning_stats["fallback_steps"] = int(reasoning_stats.get("fallback_steps", 0)) + 1
                        opinion_source = "fallback"
                        fallback_reason = fallback_reason or "encoding_mojibake"
                        confidence = min(confidence, 0.35)
                    elif sanitized_state == "repaired":
                        fallback_reason = fallback_reason or "encoding_repaired"
                if emit_message:
                    reason_tag = _extract_reason_tag(message, stance)

                # Optional sampling validator (no rejection by default)
                if emit_message and validator_sample_rate > 0 and stance_classifier is not None:
                    if random.random() < validator_sample_rate:
                        try:
                            res = await stance_classifier.validate(message, role_label, list(recent_messages))
                            if not res.ok:
                                opinion_source = "fallback"
                                message = _fallback_message(role_label, stance, task.get("evidence_hint") or "")
                                fallback_reason = "validator_fail"
                                reasoning_stats["fallback_steps"] = int(reasoning_stats.get("fallback_steps", 0)) + 1
                        except Exception:
                            pass

                agent.current_opinion = stance
                changed = prev_opinion != stance
                if changed:
                    agent.confidence = max(0.25, agent.confidence - 0.08)
                else:
                    if stance == "neutral":
                        agent.confidence = max(0.2, agent.confidence - 0.03)
                    else:
                        agent.confidence = min(1.0, agent.confidence + 0.03)

                opinion_changes[agent.agent_id] = (prev_opinion, stance, changed)
                _apply_metrics_change(agent.category_id, prev_opinion, stance)

                if message:
                    _push_recent(message)

                if emit_message:
                    clarification_total_steps += 1
                    phase_reasoning_messages += 1
                    phase_clarification_window.append(
                        {
                            "opinion": stance,
                            "reason_tag": reason_tag or "evidence_gap",
                            "fallback_reason": fallback_reason,
                            "message": message,
                        }
                    )
                    gate = _evaluate_clarification_gate(
                        phase_label=phase_label,
                        window=phase_clarification_window,
                        phase_messages=phase_reasoning_messages,
                        window_size=clarification_window_size,
                        cooldown_steps=clarification_cooldown_steps,
                        step_index=clarification_total_steps,
                    )
                    if gate:
                        clarification_payload = await _generate_clarification_payload(
                            reason_tag=str(gate.get("reason_tag") or "evidence_gap"),
                            reason_summary=str(gate.get("reason_summary") or ""),
                            snippets=[str(item) for item in (gate.get("representative_snippets") or [])],
                            phase_label=phase_label,
                        )
                        clarification_triggered = True
                        pending_clarification_state = clarification_payload
                        last_clarification_step = clarification_total_steps
                        last_clarification_reason_tag = str(clarification_payload.get("reason_tag") or "")
                        last_clarification_phase = phase_label
                        clarification_count += 1
                        clarification_history.append(
                            {
                                "question_id": clarification_payload.get("question_id"),
                                "phase_label": phase_label,
                                "reason_tag": clarification_payload.get("reason_tag"),
                                "reason_summary": clarification_payload.get("reason_summary"),
                                "created_at": clarification_payload.get("created_at"),
                            }
                        )

                if emit_message:
                    agent.record_reasoning_step(
                        iteration=iteration,
                        message=message,
                        triggered_by="phase_dialogue",
                        phase=phase_label,
                        reply_to_agent_id=reply_to_id or None,
                        opinion_change={"from": prev_opinion, "to": stance} if changed else None,
                    )
                    await _emit_event(
                        "reasoning_step",
                        {
                            "step_uid": step_uid,
                            "agent_id": agent.agent_id,
                            "agent_short_id": agent.agent_id[:4],
                            "agent_label": agent_labels.get(agent.agent_id, f"Agent {agent.agent_id[:4]}"),
                            "archetype": role_label,
                            "iteration": iteration,
                            "phase": phase_label,
                            "reply_to_agent_id": reply_to_id or None,
                            "reply_to_short_id": reply_to_short or None,
                            "message": message,
                            "opinion": stance,
                            "stance_before": prev_opinion,
                            "stance_after": stance,
                            "opinion_source": opinion_source,
                            "stance_confidence": confidence,
                            "reasoning_length": length_mode,
                            "fallback_reason": fallback_reason,
                            "relevance_score": relevance_score,
                            "policy_guard": policy_guard,
                            "policy_reason": policy_reason,
                            "stance_locked": stance_locked,
                            "reason_tag": reason_tag,
                            "clarification_triggered": clarification_triggered,
                        },
                    )
                    last_reasoning_step_uid = step_uid
                    if length_mode == "full":
                        dialogue_history.append(
                            {
                                "agent_id": agent.agent_id,
                                "short_id": agent.agent_id[:4],
                                "message": message,
                                "opinion": stance,
                            }
                        )

                processed_index += 1
                await _emit_checkpoint(
                    status_value="running",
                    next_iteration=iteration,
                    current_iteration=iteration,
                    phase_label=phase_label,
                    phase_key=phase_key,
                    phase_progress_pct=phase_start_progress,
                    tasks=tasks,
                    next_task_index=processed_index,
                    status_reason="running",
                    last_step_uid=last_reasoning_step_uid,
                )

                await _emit_event("metrics", _build_metrics_payload(iteration))
                await _emit_checkpoint(
                    status_value="running",
                    next_iteration=iteration,
                    current_iteration=iteration,
                    phase_label=phase_label,
                    phase_key=phase_key,
                    phase_progress_pct=phase_start_progress,
                    tasks=tasks,
                    next_task_index=processed_index,
                    status_reason="running",
                    last_step_uid=last_reasoning_step_uid,
                )
                if clarification_triggered and clarification_payload:
                    raise ClarificationNeeded(clarification_payload)
                if step_delay > 0:
                    await asyncio.sleep(step_delay / speed)

            await _emit_event("metrics", _build_metrics_payload(iteration))
            await _emit_event(
                "agents",
                {
                    "iteration": iteration,
                    "total_agents": len(agents),
                    "agents": [_agent_snapshot(agent) for agent in agents],
                },
            )
            await _emit_checkpoint(
                status_value="running",
                next_iteration=iteration + 1,
                current_iteration=0,
                phase_label=None,
                phase_key=phase_key,
                phase_progress_pct=(iteration / max(1, total_iterations)) * 100.0,
                tasks=[],
                next_task_index=0,
                status_reason="running",
                last_step_uid=last_reasoning_step_uid,
            )
            await _emit_event(
                "phase_update",
                {
                    "phase_key": phase_key,
                    "phase_label": phase_label,
                    "progress_pct": (iteration / max(1, total_iterations)) * 100.0,
                    "status": "completed",
                },
            )
            if step_delay > 0:
                await asyncio.sleep(step_delay / speed)

            if using_resume_tasks:
                resume_tasks_payload = []
                resume_current_iteration = 0

            neutral_ratio = metrics_counts.get("neutral", 0) / max(1, len(agents))
            if phase_key == "convergence" and neutral_ratio <= 0.10:
                effective_total_iterations = max(1, iteration)
                await _emit_event("metrics", _build_metrics_payload(iteration))
                await _emit_checkpoint(
                    status_value="running",
                    next_iteration=effective_total_iterations + 1,
                    current_iteration=0,
                    phase_label=None,
                    phase_key=phase_key,
                    phase_progress_pct=100.0,
                    tasks=[],
                    next_task_index=0,
                    status_reason="running",
                    last_step_uid=last_reasoning_step_uid,
                )
                await _emit_event(
                    "phase_update",
                    {
                        "phase_key": phase_key,
                        "phase_label": phase_label,
                        "progress_pct": 100.0,
                        "status": "completed",
                        "reason": "neutral_target_reached",
                    },
                )

        await _enforce_neutral_cap_before_complete("Finalization Gate")
        # After all iterations, compute final metrics
        final_metrics = compute_metrics(agents)
        final_metrics["total_iterations"] = effective_total_iterations
        total_steps = int(reasoning_stats.get("total_steps") or 0)
        fallback_steps = int(reasoning_stats.get("fallback_steps") or 0)
        fallback_ratio = (fallback_steps / total_steps) if total_steps > 0 else 0.0
        final_metrics["reasoning_telemetry"] = {
            **dict(reasoning_stats),
            "fallback_ratio": fallback_ratio,
            "engine_v2": reasoning_engine_v2,
            "policy_mode": policy_mode,
            "policy_guard_triggered": bool(hard_unsafe_triggered),
            "policy_risk_score": float(hard_policy_risk_score),
        }
        if fallback_ratio > fallback_alert_threshold:
            print(
                f"[reasoning] warning: high fallback ratio for simulation: "
                f"{fallback_steps}/{max(1, total_steps)} = {fallback_ratio:.2%}"
            )
        await _emit_checkpoint(
            status_value="completed",
            next_iteration=effective_total_iterations + 1,
            current_iteration=0,
            phase_label=None,
            phase_key="completed",
            phase_progress_pct=100.0,
            tasks=[],
            next_task_index=0,
            status_reason="completed",
            last_step_uid=last_reasoning_step_uid,
        )
        await _emit_event(
            "phase_update",
            {
                "phase_key": "completed",
                "phase_label": "Completed",
                "progress_pct": 100.0,
                "status": "completed",
            },
        )
        return final_metrics


