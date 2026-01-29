"""
Simple context persistence for simulations (JSONL).

Stores user context and research signals for later inspection.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


_STORE_PATH = Path(__file__).resolve().parents[1] / "data" / "context_store.jsonl"


def save_context(simulation_id: str, payload: Dict[str, Any]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "id": simulation_id,
        "ts": datetime.utcnow().isoformat() + "Z",
        "context": payload,
    }
    with _STORE_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def load_context(simulation_id: str) -> Optional[Dict[str, Any]]:
    if not _STORE_PATH.exists():
        return None
    with _STORE_PATH.open("r", encoding="utf-8") as handle:
        for line in handle:
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if record.get("id") == simulation_id:
                return record
    return None
