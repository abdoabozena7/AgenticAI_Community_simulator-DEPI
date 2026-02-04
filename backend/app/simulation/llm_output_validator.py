"""
LLM-powered validator for agent reasoning.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import List

from ..core.ollama_client import generate_ollama

logger = logging.getLogger("llm_validator")


@dataclass
class ValidationResult:
    ok: bool
    reasons: List[str]
    critique: str = ""


class LLMOutputValidator:
    """An LLM-powered judge that evaluates reasoning quality and naturalness."""

    def __init__(self, temperature: float = 0.1) -> None:
        self.temperature = temperature

    async def validate(self, text: str, persona_summary: str, recent_history: List[str]) -> ValidationResult:
        """Ask the LLM to judge if the response is robotic, repetitive, or unnatural."""
        t = (text or "").strip()
        if not t or len(t) < 30:
            return ValidationResult(ok=False, reasons=["too_short"], critique="")

        history_snippet = " | ".join(recent_history[-8:]) if recent_history else "No previous messages."

        judge_prompt = (
            "You are a 'Human Reasoning Judge' for a social simulation. Your goal is to reject robotic, repetitive, or corporate AI speech.\n\n"
            "AGENT PERSONA: " + persona_summary + "\n"
            "RECENT DEBATE: " + history_snippet + "\n\n"
            "MESSAGE TO JUDGE: \"" + t + "\"\n\n"
            "CRITERIA:\n"
            "1. NO TEMPLATES: Does it use robotic openers or canned phrasing? (Reject if YES)\n"
            "2. NO CORPORATE JARGON: Does it sound like a business memo instead of a person? (Reject if YES)\n"
            "3. UNIQUE VOICE: Is it distinct from the last few messages in the debate? (Reject if it's an echo)\n"
            "4. HUMAN REACTION: Does it feel like a real person reacting to the idea, not a neutral policy summary? (Reject if not)\n\n"
            "RETURN JSON ONLY: {\"ok\": boolean, \"reasons\": [\"string\"], \"critique\": \"string\"}"
        )

        try:
            raw_response = await generate_ollama(
                prompt=judge_prompt,
                temperature=self.temperature,
                response_format="json",
            )
            raw_response = raw_response.strip()
            data = json.loads(raw_response)
            return ValidationResult(
                ok=bool(data.get("ok", False)),
                reasons=list(data.get("reasons", [])) if isinstance(data.get("reasons", []), list) else [],
                critique=str(data.get("critique", "")) if data.get("critique") is not None else "",
            )
        except Exception as e:
            logger.error(f"LLM Judge error: {e}")
            return ValidationResult(ok=True, reasons=[], critique="Validation bypassed")

    async def classify_opinion(self, text: str, idea_label: str, language: str = "en") -> str | None:
        """Ask the LLM to classify stance (accept/reject/neutral) with no keyword matching."""
        t = (text or "").strip()
        if not t:
            return None
        is_arabic = bool(re.search(r"[\u0600-\u06FF]", t))
        lang_note = "Arabic" if (language == "ar" or is_arabic) else "English"
        prompt = (
            "You are a stance classifier for a social simulation.\n"
            "Decide the stance expressed by the MESSAGE toward the IDEA.\n"
            "No keyword matching. Use your understanding of meaning.\n\n"
            f"IDEA: {idea_label}\n"
            f"LANGUAGE: {lang_note}\n"
            f"MESSAGE: \"{t}\"\n\n"
            "Return JSON ONLY: {\"stance\": \"accept|reject|neutral\", \"confidence\": 0.0-1.0}\n"
            "If the message is mixed, pick the dominant stance. Use neutral only if clearly mixed or uncertain."
        )
        try:
            raw_response = await generate_ollama(
                prompt=prompt,
                temperature=self.temperature,
                response_format="json",
            )
            data = json.loads((raw_response or "").strip())
            stance = str(data.get("stance", "")).strip().lower()
            if stance in {"accept", "reject", "neutral"}:
                return stance
            return None
        except Exception as e:
            logger.error(f"LLM stance error: {e}")
            return None


def build_default_forbidden_phrases() -> List[str]:
    """Empty list because the LLM is now the judge."""
    return []
