from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Iterable, List


def _norm(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"\s+", " ", s)
    # Arabic-friendly normalization (minimal, safer for meaning)
    # Remove tatweel and diacritics only; keep hamza forms and taa marbuta intact.
    s = s.replace("\u0640", "")
    s = re.sub(r"[\u064B-\u0652\u0670]", "", s)
    return s


def _tokenize(s: str) -> List[str]:
    return re.findall(r"[A-Za-z0-9\u0600-\u06FF]+", s)


@dataclass
class ValidationResult:
    ok: bool
    reasons: List[str]
    matched_phrases: List[str]


class LLMOutputValidator:
    def __init__(
        self,
        forbidden_phrases: Iterable[str],
        similarity_threshold: float = 0.75,
        min_chars: int = 12,
        max_chars: int = 260,
    ) -> None:
        self.forbidden = [p for p in (forbidden_phrases or []) if p]
        self.similarity_threshold = similarity_threshold
        self.min_chars = min_chars
        self.max_chars = max_chars

    def validate(self, text: str, recent_texts: Iterable[str]) -> ValidationResult:
        reasons: List[str] = []
        matched: List[str] = []
        t = (text or "").strip()
        nt = _norm(t)

        if len(t) < self.min_chars:
            reasons.append("too_short")
        if len(t) > self.max_chars:
            reasons.append("too_long")

        for p in self.forbidden:
            if _norm(p) in nt:
                matched.append(p)
        if matched:
            reasons.append("forbidden_phrase")

        recent = list(recent_texts or [])
        tokens_t = _tokenize(nt)
        for r in recent[-6:]:
            nr = _norm(r)
            if not nr:
                continue
            char_sim = SequenceMatcher(None, nt, nr).ratio()
            tok_sim = 0.0
            if tokens_t:
                tokens_r = _tokenize(nr)
                if tokens_r:
                    tok_sim = SequenceMatcher(None, tokens_t, tokens_r).ratio()
            sim = max(char_sim, tok_sim)
            if sim >= self.similarity_threshold:
                reasons.append(f"too_similar:{sim:.2f}")
                break

        return ValidationResult(ok=(len(reasons) == 0), reasons=reasons, matched_phrases=matched)


def build_default_forbidden_phrases() -> List[str]:
    return [
        # the "virus"
        "المعلومات المتوفرة",
        "لا توفر حجة حاسمة",
        "تغير موقفي",
        "ما زلت على رأيي",
        # existing clichés (keep aligned with engine)
        "مخاطر التنفيذ",
        "ملاءمة السوق",
        "الأدلة غير حاسمة",
        "البيانات غير كافية",
        "البيانات المتاحة لا تكفي",
    ]
