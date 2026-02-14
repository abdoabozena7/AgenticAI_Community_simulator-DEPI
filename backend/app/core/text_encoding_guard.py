"""
Helpers to detect and mitigate mojibake/corrupted text output.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List


_ASCII_MOJIBAKE_TOKENS = (
    "Ã",
    "Â",
    "â€",
    "â€™",
    "â€œ",
    "â€\x9d",
    "ï¿½",
)


def detect_mojibake(text: str) -> Dict[str, Any]:
    value = str(text or "")
    lowered = value.lower()
    reasons: List[str] = []
    hits = 0

    for token in _ASCII_MOJIBAKE_TOKENS:
        token_l = token.lower()
        if token_l in lowered:
            count = lowered.count(token_l)
            hits += count
            reasons.append(f"token:{token}x{count}")

    # Arabic mojibake signature: common broken chain such as "ط..." / "ظ..."
    broken_ar = re.findall(r"(?:ط|ظ)[^\u0600-\u06FF\s]", value)
    if broken_ar:
        hits += len(broken_ar)
        reasons.append(f"broken_ar:{len(broken_ar)}")

    if "\ufffd" in value:
        hits += value.count("\ufffd")
        reasons.append("replacement_char")

    score = min(1.0, hits / max(1, len(value) // 10))
    return {
        "flag": bool(hits >= 2),
        "score": float(score),
        "reasons": reasons,
    }


def attempt_repair(text: str) -> str:
    value = str(text or "")

    # Remove explicit replacement chars first.
    cleaned = value.replace("\ufffd", "").replace("ï¿½", "")

    # Best-effort latin1 -> utf8 recovery used in many mojibake cases.
    if any(token in value for token in ("Ã", "Â", "â€", "Ø", "Ù", "ط", "ظ")):
        try:
            candidate = value.encode("latin1", errors="ignore").decode("utf-8", errors="ignore")
            if candidate:
                cleaned = candidate
        except Exception:
            pass

    cleaned = " ".join(cleaned.split())
    return cleaned.strip()
