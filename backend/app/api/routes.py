"""
REST API routes for the social simulation backend.

This module defines endpoints to start a simulation and retrieve final
metrics. The simulation runs asynchronously in the background and
emits events over WebSocket as it progresses. State is cached in
memory so clients can poll the REST API for the latest snapshot when
WebSocket connectivity is unavailable.
"""

from __future__ import annotations

import asyncio
import os
import json
from datetime import datetime
import uuid
from typing import Any, Dict, Optional, List
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, status, Header

from ..core.dataset_loader import Dataset
from ..core import auth as auth_core
from ..simulation.engine import SimulationEngine, ClarificationNeeded
from ..simulation.preflight import preflight_next, preflight_finalize
from ..core.ollama_client import generate_ollama
from ..core.context_store import save_context
from ..core.web_search import search_web
from ..core.page_fetch import fetch_page
from ..core import db as db_core
from ..api.websocket import manager
from pathlib import Path
import hashlib


router = APIRouter(prefix="/simulation")

# Global dictionaries to track simulation tasks, results, and live state
_simulation_tasks: Dict[str, asyncio.Task] = {}
_simulation_results: Dict[str, Dict[str, Any]] = {}
_simulation_state: Dict[str, Dict[str, Any]] = {}
_simulation_pause_reasons: Dict[str, str] = {}
_PAUSE_STATUS_REASONS = {
    "paused_manual",
    "interrupted",
    "paused_search_failed",
    "paused_research_review",
    "paused_credits_exhausted",
    "paused_clarification_needed",
}

# Reference to the loaded dataset (set in main module at startup)
dataset: Optional[Dataset] = None


def _auth_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "false").lower() in {"1", "true", "yes"}


def _preflight_required() -> bool:
    return os.getenv("SIM_PREFLIGHT_REQUIRED", "0").lower() in {"1", "true", "yes", "on"}


async def _resolve_user(authorization: Optional[str], require: bool = False) -> Optional[Dict[str, Any]]:
    if not authorization or not authorization.lower().startswith("bearer "):
        if require:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
        return None
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user:
        if require:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
        return None
    return user


async def _ensure_simulation_access(simulation_id: str, user: Dict[str, Any]) -> None:
    role = (user.get("role") or "").lower()
    if role == "admin":
        return
    owner_id = await db_core.get_simulation_owner(simulation_id)
    if owner_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
    if int(owner_id) != int(user.get("id") or 0):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


def _normalize_clarification_options(raw_options: Any) -> List[Dict[str, str]]:
    options: List[Dict[str, str]] = []
    if isinstance(raw_options, list):
        for item in raw_options:
            label = ""
            option_id = ""
            if isinstance(item, str):
                label = item.strip()
            elif isinstance(item, dict):
                label = str(item.get("label") or item.get("text") or item.get("value") or "").strip()
                option_id = str(item.get("id") or item.get("option_id") or "").strip()
            if not label:
                continue
            normalized = " ".join(label.lower().split())
            if normalized in {"option 1", "option 2", "option 3", "اختيار 1", "اختيار 2", "اختيار 3"}:
                continue
            if any(" ".join(existing["label"].lower().split()) == normalized for existing in options):
                continue
            options.append({"id": option_id or f"opt_{len(options) + 1}", "label": label[:220]})
            if len(options) >= 3:
                break
    return options


def _clarification_fallback_template(reason_tag: str, language: str, reason_summary: str) -> Dict[str, Any]:
    is_ar = str(language or "en").lower() == "ar"
    templates: Dict[str, Dict[str, Any]] = {
        "privacy_surveillance": {
            "decision_axis": "privacy_scope",
            "question_ar": "في فكرتك الحالية، ما الحدّ المقبول لجمع البيانات قبل الانتقال للمرحلة التالية؟",
            "question_en": "For this idea, what data-collection boundary should be enforced before continuing?",
            "options_ar": [
                "نكتفي ببيانات يقدّمها المستخدم بنفسه فقط",
                "نستخدم بيانات عامة فقط بعد موافقة صريحة موثقة",
                "نضيف بيانات إضافية لكن مع مراجعة بشرية إلزامية",
            ],
            "options_en": [
                "Only use data explicitly provided by the user",
                "Use public data only with explicit documented consent",
                "Allow extended data only with mandatory human review",
            ],
        },
        "legal_compliance": {
            "decision_axis": "compliance_boundary",
            "question_ar": "ما مستوى الامتثال القانوني المطلوب قبل إطلاق النسخة القادمة من الفكرة؟",
            "question_en": "What legal-compliance threshold must be met before the next rollout step?",
            "options_ar": [
                "امتثال كامل قبل أي إطلاق",
                "Pilot محدود مع موافقات صريحة وتدقيق شهري",
                "تجميد أي قرار مؤثر حتى اكتمال الامتثال",
            ],
            "options_en": [
                "Full compliance before any launch",
                "Limited pilot with explicit consent and monthly audits",
                "Freeze high-impact decisions until compliance is complete",
            ],
        },
        "unclear_value": {
            "decision_axis": "value_proposition",
            "question_ar": "ما القيمة الأوضح التي تريد أن يحسم الوكلاء النقاش بناءً عليها؟",
            "question_en": "Which value promise should agents use as the primary decision criterion?",
            "options_ar": [
                "توفير تكلفة مباشر وقابل للقياس",
                "رفع الجودة/الدقة بشكل واضح",
                "تقليل المخاطر والامتثال كأولوية",
            ],
            "options_en": [
                "Measurable direct cost savings",
                "Clear quality and accuracy uplift",
                "Risk reduction and compliance confidence first",
            ],
        },
        "evidence_gap": {
            "decision_axis": "evidence_priority",
            "question_ar": "أي نوع دليل نحتاجه أولًا حتى يقرر الوكلاء دون بقاء حياد مرتفع؟",
            "question_en": "Which evidence should be prioritized first so agents can decide without staying neutral?",
            "options_ar": [
                "دليل سوق وتسعير من مصادر موثوقة",
                "دليل قانوني/تنظيمي مباشر",
                "دليل استخدام فعلي من Pilot محدود",
            ],
            "options_en": [
                "Market and pricing proof from trusted sources",
                "Direct legal and regulatory evidence",
                "Real usage evidence from a limited pilot",
            ],
        },
    }
    template = templates.get(reason_tag) or templates["evidence_gap"]
    question = template["question_ar"] if is_ar else template["question_en"]
    options_seed = template["options_ar"] if is_ar else template["options_en"]
    options = [{"id": f"opt_{idx + 1}", "label": str(label)} for idx, label in enumerate(options_seed[:3])]
    return {
        "question": question,
        "options": options,
        "decision_axis": template.get("decision_axis") or "evidence_priority",
        "reason_summary": reason_summary,
    }


def _init_state(simulation_id: str, user_id: Optional[int] = None) -> None:
    """Initialise the in-memory state container for a new simulation."""
    _simulation_state[simulation_id] = {
        "user_id": user_id,
        "agents": [],
        "reasoning": [],
        "chat_events": [],
        "research_sources": [],
        "metrics": None,
        "summary": None,
        "summary_ready": False,
        "summary_at": None,
        "current_phase_key": None,
        "phase_progress_pct": 0.0,
        "event_seq": 0,
        "can_resume": False,
        "resume_reason": None,
        "error": None,
        "status_reason": "running",
        "policy_mode": "normal",
        "policy_reason": None,
        "search_quality": None,
        "neutral_cap_pct": 0.30,
        "neutral_enforcement": "clarification_before_complete",
        "clarification_count": 0,
        "pending_clarification": None,
        "can_answer_clarification": False,
        "pending_research_review": None,
    }


@router.post("/preflight/next")
async def simulation_preflight_next(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user and not auth_core.has_permission(user, "simulation:run"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    draft_context = payload.get("draft_context")
    if not isinstance(draft_context, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="draft_context object is required")

    history = payload.get("history")
    if history is not None and not isinstance(history, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="history must be an array")

    answer = payload.get("answer")
    if answer is not None and not isinstance(answer, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="answer must be an object")

    language = "ar" if str(payload.get("language") or "en").lower().startswith("ar") else "en"
    try:
        max_rounds = int(payload.get("max_rounds") or os.getenv("SIM_PREFLIGHT_MAX_ROUNDS", "3"))
    except Exception:
        max_rounds = 3
    max_rounds = max(1, min(5, max_rounds))
    try:
        threshold = float(payload.get("threshold") or os.getenv("SIM_PREFLIGHT_THRESHOLD", "0.78"))
    except Exception:
        threshold = 0.78
    threshold = max(0.50, min(0.95, threshold))

    result = await preflight_next(
        draft_context=draft_context,
        history=history if isinstance(history, list) else None,
        answer=answer if isinstance(answer, dict) else None,
        language=language,
        max_rounds=max_rounds,
        threshold=threshold,
    )
    return result


@router.post("/preflight/finalize")
async def simulation_preflight_finalize(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user and not auth_core.has_permission(user, "simulation:run"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")

    normalized_context = payload.get("normalized_context")
    if not isinstance(normalized_context, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="normalized_context object is required")

    history = payload.get("history")
    if history is not None and not isinstance(history, list):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="history must be an array")

    language = "ar" if str(payload.get("language") or "en").lower().startswith("ar") else "en"
    try:
        threshold = float(payload.get("threshold") or os.getenv("SIM_PREFLIGHT_THRESHOLD", "0.78"))
    except Exception:
        threshold = 0.78
    threshold = max(0.50, min(0.95, threshold))

    result = preflight_finalize(
        normalized_context=normalized_context,
        history=history if isinstance(history, list) else None,
        language=language,
        threshold=threshold,
    )
    return result


def _store_event(simulation_id: str, event_type: str, data: Dict[str, Any]) -> None:
    """Update the cached state for the given simulation.

    Depending on the event type, the relevant portion of the state is
    updated.
    """
    state = _simulation_state.setdefault(
        simulation_id,
        {
            "user_id": None,
            "agents": [],
            "reasoning": [],
            "chat_events": [],
            "research_sources": [],
            "metrics": None,
            "summary": None,
            "summary_ready": False,
            "summary_at": None,
            "current_phase_key": None,
            "phase_progress_pct": 0.0,
            "event_seq": 0,
            "can_resume": False,
            "resume_reason": None,
            "error": None,
            "status_reason": "running",
            "policy_mode": "normal",
            "policy_reason": None,
            "search_quality": None,
            "neutral_cap_pct": 0.30,
            "neutral_enforcement": "clarification_before_complete",
            "clarification_count": 0,
            "pending_clarification": None,
            "can_answer_clarification": False,
            "pending_research_review": None,
        },
    )
    incoming_event_seq = data.get("event_seq")
    if isinstance(incoming_event_seq, int):
        state["event_seq"] = max(int(state.get("event_seq") or 0), incoming_event_seq)
    if event_type not in {"chat_event", "clarification_request", "clarification_resolved"}:
        state["can_resume"] = False
        state["resume_reason"] = None
    if event_type in {"agents", "metrics", "reasoning_step"}:
        state["error"] = None
        state["status_reason"] = "running"
    if event_type == "agents":
        state["agents"] = data.get("agents", [])
    elif event_type == "metrics":
        state["metrics"] = data
    elif event_type == "reasoning_step":
        reasoning = state["reasoning"]
        reasoning.append(data)
    elif event_type == "chat_event":
        chat_events = state.setdefault("chat_events", [])
        if isinstance(chat_events, list):
            chat_events.append(data)
    elif event_type == "phase_update":
        state["current_phase_key"] = data.get("phase_key") or state.get("current_phase_key")
        try:
            state["phase_progress_pct"] = float(data.get("progress_pct") or 0.0)
        except Exception:
            pass
    elif event_type == "research_update":
        research = state.setdefault("research_sources", [])
        if isinstance(research, list):
            research.append(data)
        action = str(data.get("action") or "").strip().lower()
        if action == "review_required":
            pending = data.get("meta_json") if isinstance(data.get("meta_json"), dict) else {}
            state["pending_research_review"] = pending if isinstance(pending, dict) else None
            state["status_reason"] = "paused_research_review"
            state["can_resume"] = False
            state["resume_reason"] = str(data.get("error") or data.get("snippet") or "").strip() or None
        elif action in {
            "research_started",
            "query_planned",
            "search_results_ready",
            "fetch_started",
            "fetch_done",
            "summary_ready",
            "evidence_cards_ready",
            "gaps_ready",
            "research_done",
            # Backward compatibility with older action names.
            "query_started",
            "query_result",
            "url_opened",
            "url_extracted",
            "url_failed",
            "search_completed",
        }:
            state["status_reason"] = "running"
            state["pending_research_review"] = None
            if action == "research_done":
                meta = data.get("meta_json") if isinstance(data.get("meta_json"), dict) else {}
                quality = meta.get("quality_snapshot") if isinstance(meta.get("quality_snapshot"), dict) else None
                if isinstance(quality, dict):
                    state["search_quality"] = quality
                state["can_resume"] = False
                state["resume_reason"] = None
    elif event_type == "clarification_request":
        state["clarification_count"] = int(state.get("clarification_count") or 0) + 1
        state["pending_clarification"] = {
            "question_id": data.get("question_id"),
            "question": data.get("question"),
            "options": data.get("options") or [],
            "reason_tag": data.get("reason_tag"),
            "reason_summary": data.get("reason_summary"),
            "decision_axis": data.get("decision_axis"),
            "affected_agents": data.get("affected_agents"),
            "supporting_snippets": data.get("supporting_snippets") or [],
            "question_quality": data.get("question_quality"),
            "created_at": data.get("created_at"),
            "required": True,
        }
        state["can_answer_clarification"] = True
        state["status_reason"] = "paused_clarification_needed"
        state["can_resume"] = False
        state["resume_reason"] = data.get("reason_summary")
    elif event_type == "clarification_resolved":
        state["pending_clarification"] = None
        state["can_answer_clarification"] = False
        state["status_reason"] = "running"


def _state_has_progress(state: Dict[str, Any]) -> bool:
    metrics = state.get("metrics") or {}
    try:
        iteration = int(metrics.get("iteration") or 0)
    except Exception:
        iteration = 0
    reasoning = state.get("reasoning") or []
    return iteration > 0 or bool(reasoning)


def _estimate_text_tokens(text: str) -> int:
    normalized = " ".join((text or "").split())
    if not normalized:
        return 0
    return max(1, (len(normalized) + 3) // 4)


class _CreditsExhaustedPause(RuntimeError):
    def __init__(self, message: str, missing_credits: float) -> None:
        super().__init__(message)
        self.missing_credits = float(missing_credits or 0.0)


def _billing_exhausted_message(missing_credits: float) -> str:
    if missing_credits > 0:
        return f"Token budget exhausted. Add at least {missing_credits:.2f} credits to continue."
    return "Token budget exhausted. Add credits to continue."


def _task_is_running(simulation_id: str) -> bool:
    task = _simulation_tasks.get(simulation_id)
    return bool(task is not None and not task.done())


def _apply_snapshot_to_state(simulation_id: str, snapshot: Dict[str, Any], user_id: Optional[int] = None) -> Dict[str, Any]:
    snapshot_status = str(snapshot.get("status") or "").lower()
    snapshot_status_reason = str(snapshot.get("status_reason") or "").strip().lower()
    if snapshot_status == "error":
        status_reason = "error"
    elif snapshot_status == "paused":
        status_reason = snapshot_status_reason if snapshot_status_reason in _PAUSE_STATUS_REASONS else "paused_manual"
    elif snapshot_status == "completed":
        status_reason = "completed"
    else:
        status_reason = "running"
    snapshot_chat_events = snapshot.get("chat_events") or []
    max_chat_event_seq = 0
    if isinstance(snapshot_chat_events, list):
        for item in snapshot_chat_events:
            if not isinstance(item, dict):
                continue
            try:
                max_chat_event_seq = max(max_chat_event_seq, int(item.get("event_seq") or 0))
            except Exception:
                continue
    state = {
        "user_id": user_id,
        "agents": snapshot.get("agents") or [],
        "reasoning": snapshot.get("reasoning") or [],
        "chat_events": snapshot_chat_events if isinstance(snapshot_chat_events, list) else [],
        "research_sources": snapshot.get("research_sources") or [],
        "metrics": snapshot.get("metrics"),
        "summary": snapshot.get("summary"),
        "summary_ready": bool(snapshot.get("summary_ready")),
        "summary_at": snapshot.get("summary_at"),
        "current_phase_key": snapshot.get("current_phase_key"),
        "phase_progress_pct": float(snapshot.get("phase_progress_pct") or 0.0) if snapshot.get("phase_progress_pct") is not None else 0.0,
        "event_seq": max(int(snapshot.get("event_seq") or 0), max_chat_event_seq),
        "can_resume": bool(snapshot.get("can_resume")),
        "resume_reason": snapshot.get("resume_reason"),
        "error": snapshot.get("resume_reason") if str(snapshot.get("status") or "").lower() == "error" else None,
        "status_reason": status_reason,
        "policy_mode": str(snapshot.get("policy_mode") or "normal"),
        "policy_reason": snapshot.get("policy_reason"),
        "search_quality": snapshot.get("search_quality") if isinstance(snapshot.get("search_quality"), dict) else None,
        "neutral_cap_pct": float(snapshot.get("neutral_cap_pct") or 0.30),
        "neutral_enforcement": str(snapshot.get("neutral_enforcement") or "clarification_before_complete"),
        "clarification_count": int(snapshot.get("clarification_count") or 0),
        "pending_clarification": snapshot.get("pending_clarification") if isinstance(snapshot.get("pending_clarification"), dict) else None,
        "can_answer_clarification": bool(snapshot.get("can_answer_clarification")),
        "pending_research_review": snapshot.get("pending_research_review") if isinstance(snapshot.get("pending_research_review"), dict) else None,
    }
    _simulation_state[simulation_id] = state
    return state


async def _fetch_simulation_context(simulation_id: str) -> Dict[str, Any]:
    rows = await db_core.execute(
        "SELECT user_context FROM simulations WHERE simulation_id=%s",
        (simulation_id,),
        fetch=True,
    )
    if not rows:
        return {}
    context = rows[0].get("user_context") or {}
    if isinstance(context, str):
        try:
            import json
            context = json.loads(context)
        except Exception:
            context = {}
    if not isinstance(context, dict):
        return {}
    return context


def _next_event_seq(simulation_id: str) -> int:
    state = _simulation_state.setdefault(simulation_id, {})
    seq = int(state.get("event_seq") or 0) + 1
    state["event_seq"] = seq
    return seq


async def _emit_live_event(simulation_id: str, event_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    event_seq = data.get("event_seq")
    if not isinstance(event_seq, int):
        event_seq = _next_event_seq(simulation_id)
    event_data = {**data, "event_seq": event_seq}
    payload = {"type": event_type, "simulation_id": simulation_id, **event_data}
    await manager.broadcast_json(payload)
    _store_event(simulation_id, event_type, event_data)
    if event_type == "research_update":
        try:
            await db_core.insert_research_event(simulation_id, event_data)
        except Exception:
            pass
    return event_data


async def _persist_chat_event(
    simulation_id: str,
    role: str,
    content: str,
    *,
    meta: Optional[Dict[str, Any]] = None,
    message_id: Optional[str] = None,
    broadcast: bool = True,
) -> Dict[str, Any]:
    safe_role = str(role or "").strip().lower()
    if safe_role not in {"user", "system", "research", "status"}:
        safe_role = "system"
    text = str(content or "").strip()
    if not text:
        raise ValueError("content is required")
    payload_meta = dict(meta or {})
    event_seq = _next_event_seq(simulation_id)
    event_data = {
        "event_seq": event_seq,
        "message_id": str(message_id or uuid.uuid4()),
        "role": safe_role,
        "content": text,
        "meta": payload_meta,
        "timestamp": int(datetime.utcnow().timestamp() * 1000),
    }
    if broadcast:
        await manager.broadcast_json({"type": "chat_event", "simulation_id": simulation_id, **event_data})
    _store_event(simulation_id, "chat_event", event_data)
    await db_core.insert_chat_event(
        simulation_id=simulation_id,
        event_seq=event_seq,
        message_id=event_data["message_id"],
        role=safe_role,
        content=text,
        meta=payload_meta,
    )
    checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
    checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
    checkpoint_meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
    checkpoint_meta["event_seq"] = max(int(checkpoint_meta.get("event_seq") or 0), int(event_seq))
    checkpoint["meta"] = checkpoint_meta
    checkpoint_status = str((checkpoint_row or {}).get("status") or "running").strip().lower()
    checkpoint_status = checkpoint_status if checkpoint_status in {"running", "paused", "completed", "error"} else "running"
    checkpoint_reason = str((checkpoint_row or {}).get("status_reason") or "").strip() or None
    checkpoint_phase = str((checkpoint_row or {}).get("current_phase_key") or "").strip() or None
    phase_progress = (checkpoint_row or {}).get("phase_progress_pct")
    await db_core.upsert_simulation_checkpoint(
        simulation_id=simulation_id,
        checkpoint=checkpoint,
        status=checkpoint_status,
        last_error=(checkpoint_row or {}).get("last_error"),
        status_reason=checkpoint_reason,
        current_phase_key=checkpoint_phase,
        phase_progress_pct=float(phase_progress) if phase_progress is not None else None,
        event_seq=event_seq,
    )
    return event_data


def _build_search_query(user_context: Dict[str, Any]) -> str:
    idea = str(user_context.get("idea") or "").strip()
    category = str(user_context.get("category") or "").strip()
    city = str(user_context.get("city") or "").strip()
    country = str(user_context.get("country") or "").strip()
    location = ", ".join([part for part in [city, country] if part])
    parts = [idea]
    if category:
        parts.append(f"category {category}")
    if location:
        parts.append(f"in {location}")
    return " ".join(part for part in parts if part).strip()


def _build_favicon_url(domain: Optional[str], url: Optional[str]) -> Optional[str]:
    host = str(domain or "").strip()
    if not host:
        raw_url = str(url or "").strip()
        if raw_url.startswith("http://") or raw_url.startswith("https://"):
            try:
                from urllib.parse import urlparse
                host = (urlparse(raw_url).hostname or "").strip()
            except Exception:
                host = ""
    if not host:
        return None
    return f"https://www.google.com/s2/favicons?domain={host}&sz=64"


def _build_search_query_variants(user_context: Dict[str, Any]) -> List[str]:
    """Create progressively broader live-search queries before declaring failure."""
    idea = str(user_context.get("idea") or "").strip()
    category = str(user_context.get("category") or "").strip()
    city = str(user_context.get("city") or "").strip()
    country = str(user_context.get("country") or "").strip()
    location = ", ".join([part for part in [city, country] if part])

    def _truncate_words(text: str, max_words: int = 24) -> str:
        words = [w for w in text.split() if w.strip()]
        return " ".join(words[:max_words]).strip()

    candidates: List[str] = []
    base = _build_search_query(user_context)
    if base:
        candidates.append(base)

    # Broaden query if first version is too narrow.
    if idea and location:
        candidates.append(f"{idea} in {location}".strip())
    if idea and category:
        candidates.append(f"{idea} category {category}".strip())
    if idea:
        candidates.append(idea)
        idea_short = _truncate_words(idea, 20)
        if idea_short and idea_short != idea:
            candidates.append(idea_short)
        candidates.append(f"{idea_short or idea} market demand competition pricing regulation")
    if category:
        candidates.append(f"{category} market demand trends")
        if location:
            candidates.append(f"{category} market demand trends in {location}")
    if location:
        candidates.append(f"business opportunities in {location}")
    # Broad, idea-aligned fallback to avoid unrelated search drift.
    if idea_short or idea:
        candidates.append(f"{idea_short or idea} market demand competition pricing regulation")
    else:
        candidates.append("business idea market demand competition pricing regulation")

    # De-duplicate while preserving order.
    seen = set()
    ordered: List[str] = []
    for candidate in candidates:
        normalized = " ".join(candidate.split())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


async def _run_search_bootstrap(
    simulation_id: str,
    user_context: Dict[str, Any],
) -> Dict[str, Any]:
    context = dict(user_context or {})
    existing_summary = str(context.get("research_summary") or "").strip()
    existing_structured = context.get("research_structured") if isinstance(context.get("research_structured"), dict) else None
    if existing_summary or existing_structured:
        await _emit_live_event(
            simulation_id,
            "phase_update",
            {
                "phase_key": "search_bootstrap",
                "phase_label": "Search Bootstrap",
                "progress_pct": 100.0,
                "status": "completed",
                "reason": "existing_research_context",
            },
        )
        return {"ok": True, "context": context, "status_reason": "running"}

    queries = _build_search_query_variants(context)
    if not queries:
        return {"ok": False, "reason": "Missing idea for search bootstrap", "status_reason": "paused_search_failed"}

    configured_min_usable_sources = max(1, int(os.getenv("SEARCH_MIN_USABLE_SOURCES", "1") or 1))
    configured_min_domains = max(1, int(os.getenv("SEARCH_MIN_DOMAINS", "1") or 1))
    configured_min_content_chars = max(40, int(os.getenv("SEARCH_MIN_CONTENT_CHARS", "60") or 60))
    balanced_gate_enabled = str(os.getenv("SEARCH_GATE_BALANCED", "1")).strip().lower() in {"1", "true", "yes", "on"}
    if balanced_gate_enabled:
        # Guard against overly strict environment values that make production search stall.
        min_usable_sources = min(configured_min_usable_sources, 2)
        min_domains = min(configured_min_domains, 2)
        min_content_chars = min(configured_min_content_chars, 80)
    else:
        min_usable_sources = configured_min_usable_sources
        min_domains = configured_min_domains
        min_content_chars = configured_min_content_chars

    await _emit_live_event(
        simulation_id,
        "phase_update",
        {
            "phase_key": "search_bootstrap",
            "phase_label": "Search Bootstrap",
            "progress_pct": 5.0,
            "status": "running",
        },
    )
    language = str(context.get("language") or "en")
    search_result: Dict[str, Any] = {}
    results: List[Dict[str, Any]] = []
    structured: Dict[str, Any] = {}
    quality: Dict[str, Any] = {}
    usable_sources = 0
    domains_count = 0
    extraction_success_rate = 0.0
    summary = ""
    max_content_chars = 0
    quality_ok = False
    quality_warning: Optional[str] = None
    last_exception: Optional[Exception] = None
    best_candidate: Optional[Dict[str, Any]] = None
    best_score: tuple[int, int, int, float] = (-1, -1, -1, -1.0)

    for attempt_index, query in enumerate(queries, start=1):
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "query_started",
                "status": "running",
                "url": None,
                "domain": None,
                "favicon_url": None,
                "title": None,
                "http_status": None,
                "content_chars": None,
                "relevance_score": None,
                "snippet": f"[{attempt_index}/{len(queries)}] {query}",
                "error": None,
            },
        )
        try:
            candidate = await search_web(query=query, max_results=6, language=language, strict_web_only=True)
        except Exception as exc:
            last_exception = exc
            continue

        candidate_results = candidate.get("results") or []
        candidate_quality = candidate.get("quality") if isinstance(candidate.get("quality"), dict) else {}
        candidate_structured = candidate.get("structured") if isinstance(candidate.get("structured"), dict) else {}
        for item in candidate_results:
            if not isinstance(item, dict):
                continue
            if item.get("favicon_url"):
                continue
            item["favicon_url"] = _build_favicon_url(item.get("domain"), item.get("url"))
        candidate_usable = int(candidate_quality.get("usable_sources") or 0)
        candidate_domains = int(candidate_quality.get("domains") or 0)
        candidate_extraction = float(candidate_quality.get("extraction_success_rate") or 0.0)
        candidate_max_chars = max(
            [
                max(
                    len(str(item.get("snippet") or "").strip()),
                    len(str(item.get("title") or "").strip()),
                    int(item.get("content_chars") or 0),
                )
                for item in candidate_results
                if isinstance(item, dict)
            ] + [0]
        )
        candidate_summary = str(candidate_structured.get("summary") or candidate.get("answer") or "").strip()
        candidate_score = (candidate_usable, candidate_domains, candidate_max_chars, candidate_extraction)

        if candidate_score > best_score:
            best_score = candidate_score
            best_candidate = {
                "search_result": candidate,
                "results": candidate_results,
                "structured": candidate_structured,
                "quality": candidate_quality,
                "usable_sources": candidate_usable,
                "domains_count": candidate_domains,
                "extraction_success_rate": candidate_extraction,
                "summary": candidate_summary,
                "max_content_chars": candidate_max_chars,
            }

        candidate_quality_ok = (
            candidate_usable >= min_usable_sources
            and candidate_domains >= min_domains
            and candidate_max_chars >= min_content_chars
            and candidate_extraction > 0.0
        )
        if candidate_quality_ok:
            search_result = candidate
            results = candidate_results
            structured = candidate_structured
            quality = candidate_quality
            usable_sources = candidate_usable
            domains_count = candidate_domains
            extraction_success_rate = candidate_extraction
            summary = candidate_summary
            max_content_chars = candidate_max_chars
            quality_ok = True
            break

    if not quality_ok and best_candidate:
        search_result = best_candidate["search_result"]
        results = best_candidate["results"]
        structured = best_candidate["structured"]
        quality = best_candidate["quality"]
        usable_sources = int(best_candidate["usable_sources"])
        domains_count = int(best_candidate["domains_count"])
        extraction_success_rate = float(best_candidate["extraction_success_rate"])
        summary = str(best_candidate["summary"] or "")
        max_content_chars = int(best_candidate["max_content_chars"] or 0)

    if not quality_ok and not best_candidate and last_exception is not None:
        message = f"Search bootstrap failed: {last_exception}"
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "search_failed",
                "status": "failed",
                "url": None,
                "domain": None,
                "favicon_url": None,
                "title": None,
                "http_status": None,
                "content_chars": None,
                "relevance_score": None,
                "snippet": None,
                "error": message,
            },
        )
        await _emit_live_event(
            simulation_id,
            "phase_update",
            {
                "phase_key": "search_bootstrap",
                "phase_label": "Search Bootstrap",
                "progress_pct": 100.0,
                "status": "failed",
                "reason": message,
            },
        )
        return {"ok": False, "reason": message, "status_reason": "paused_search_failed"}
    if not summary and not results:
        message = "Search bootstrap did not return enough live evidence."
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "search_failed",
                "status": "failed",
                "url": None,
                "domain": None,
                "favicon_url": None,
                "title": None,
                "http_status": None,
                "content_chars": None,
                "relevance_score": None,
                "snippet": None,
                "error": message,
            },
        )
        await _emit_live_event(
            simulation_id,
            "phase_update",
            {
                "phase_key": "search_bootstrap",
                "phase_label": "Search Bootstrap",
                "progress_pct": 100.0,
                "status": "failed",
                "reason": message,
            },
        )
        return {"ok": False, "reason": message, "status_reason": "paused_search_failed"}

    if not quality_ok:
        quality_warning = (
            f"Search quality below threshold. usable_sources={usable_sources}/{min_usable_sources}, "
            f"domains={domains_count}/{min_domains}, max_content_chars={max_content_chars}/{min_content_chars}, "
            f"extraction_success_rate={extraction_success_rate:.2f}"
        )
        soft_quality_ok = (
            usable_sources >= 1
            and domains_count >= 1
            and max_content_chars >= 40
            and extraction_success_rate > 0.0
        )
        if not soft_quality_ok:
            await _emit_live_event(
                simulation_id,
                "research_update",
                {
                    "action": "search_failed",
                    "status": "failed",
                    "url": None,
                    "domain": None,
                    "favicon_url": None,
                    "title": None,
                    "http_status": None,
                    "content_chars": None,
                    "relevance_score": None,
                    "snippet": None,
                    "error": quality_warning,
                },
            )
            await _emit_live_event(
                simulation_id,
                "phase_update",
                {
                    "phase_key": "search_bootstrap",
                    "phase_label": "Search Bootstrap",
                    "progress_pct": 100.0,
                    "status": "failed",
                    "reason": quality_warning,
                },
            )
            return {"ok": False, "reason": quality_warning, "status_reason": "paused_search_failed"}

    await _emit_live_event(
        simulation_id,
        "research_update",
        {
            "action": "query_result",
            "status": "completed",
            "url": None,
            "domain": None,
            "favicon_url": None,
            "title": None,
            "http_status": None,
            "content_chars": max_content_chars,
            "relevance_score": None,
            "snippet": f"usable_sources={usable_sources}, domains={domains_count}, extraction_success_rate={extraction_success_rate:.2f}",
            "error": None,
        },
    )

    total_results = max(1, len(results))
    for index, item in enumerate(results, start=1):
        progress = min(95.0, 15.0 + (75.0 * (index / total_results)))
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "url_opened",
                "status": "running",
                "url": item.get("url"),
                "domain": item.get("domain"),
                "favicon_url": item.get("favicon_url") or _build_favicon_url(item.get("domain"), item.get("url")),
                "title": item.get("title"),
                "http_status": item.get("http_status"),
                "content_chars": None,
                "relevance_score": item.get("score"),
                "snippet": item.get("title"),
                "error": None,
                "progress_pct": progress,
            },
        )
        snippet = (item.get("snippet") or "").strip()
        content_chars = len(snippet)
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "url_extracted" if content_chars > 0 else "url_failed",
                "status": "completed" if content_chars > 0 else "failed",
                "url": item.get("url"),
                "domain": item.get("domain"),
                "favicon_url": item.get("favicon_url") or _build_favicon_url(item.get("domain"), item.get("url")),
                "title": item.get("title"),
                "http_status": item.get("http_status"),
                "content_chars": content_chars,
                "relevance_score": item.get("score"),
                "snippet": snippet or item.get("title"),
                "error": None if content_chars > 0 else "Empty extraction snippet",
                "progress_pct": progress,
            },
        )
    evidence_cards = structured.get("evidence_cards") if isinstance(structured.get("evidence_cards"), list) else []
    context["research_summary"] = summary
    context["research_sources"] = results
    context["research_structured"] = structured
    context["search_quality"] = {
        "usable_sources": usable_sources,
        "domains": domains_count,
        "extraction_success_rate": extraction_success_rate,
    }
    if quality_warning:
        context["search_quality_warning"] = quality_warning
    if evidence_cards:
        context["evidence_cards"] = evidence_cards
    await _emit_live_event(
        simulation_id,
        "research_update",
        {
            "action": "search_completed",
            "status": "completed",
            "url": None,
            "domain": None,
            "favicon_url": None,
            "title": None,
            "http_status": None,
            "content_chars": max_content_chars,
            "relevance_score": None,
            "snippet": summary[:280] if summary else quality_warning,
            "error": quality_warning if quality_warning else None,
        },
    )
    await _emit_live_event(
        simulation_id,
        "phase_update",
        {
            "phase_key": "search_bootstrap",
            "phase_label": "Search Bootstrap",
            "progress_pct": 100.0,
            "status": "completed",
            "reason": quality_warning,
        },
    )
    return {"ok": True, "context": context, "status_reason": "running"}


def _candidate_url_id(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return uuid.uuid4().hex[:8]
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:8]


def _prepare_candidate_urls(results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen: set[str] = set()
    candidates: List[Dict[str, Any]] = []
    for item in results or []:
        if not isinstance(item, dict):
            continue
        raw_url = str(item.get("url") or "").strip()
        if not raw_url or raw_url in seen:
            continue
        seen.add(raw_url)
        domain = str(item.get("domain") or "").strip()
        if not domain:
            try:
                domain = (urlparse(raw_url).hostname or "").strip()
            except Exception:
                domain = ""
        score_raw = item.get("score")
        try:
            score = float(score_raw) if score_raw is not None else 0.0
        except Exception:
            score = 0.0
        title = str(item.get("title") or "").strip()
        snippet = str(item.get("snippet") or "").strip()
        # Lightweight ranking bias: keep informative titles/snippets above thin results.
        score += min(len(title) / 200.0, 0.2)
        score += min(len(snippet) / 600.0, 0.2)
        candidates.append(
            {
                "id": _candidate_url_id(raw_url),
                "url": raw_url,
                "domain": domain,
                "title": title or raw_url,
                "snippet": snippet[:360],
                "favicon_url": item.get("favicon_url") or _build_favicon_url(domain, raw_url),
                "score": round(score, 4),
            }
        )
    candidates.sort(key=lambda entry: (float(entry.get("score") or 0.0), len(str(entry.get("snippet") or ""))), reverse=True)
    return candidates[:10]


def _pick_diverse_urls(candidates: List[Dict[str, Any]], limit: int = 4) -> List[Dict[str, Any]]:
    picked: List[Dict[str, Any]] = []
    used_domains: set[str] = set()
    for entry in candidates:
        domain = str(entry.get("domain") or "").lower()
        if domain and domain in used_domains:
            continue
        picked.append(entry)
        if domain:
            used_domains.add(domain)
        if len(picked) >= limit:
            return picked
    for entry in candidates:
        if len(picked) >= limit:
            break
        if entry in picked:
            continue
        picked.append(entry)
    return picked


def _compute_extraction_quality(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    attempted = len(rows)
    usable = 0
    domains: set[str] = set()
    max_chars = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "").lower()
        chars = int(row.get("content_chars") or 0)
        max_chars = max(max_chars, chars)
        if status == "completed" and chars >= 80:
            usable += 1
            domain = str(row.get("domain") or "").strip().lower()
            if domain:
                domains.add(domain)
    return {
        "usable_sources": usable,
        "domains": len(domains),
        "extraction_success_rate": (usable / attempted) if attempted > 0 else 0.0,
        "max_content_chars": max_chars,
    }


def _build_gap_summary(
    quality: Dict[str, Any],
    *,
    min_usable_sources: int,
    min_domains: int,
    min_content_chars: int,
    language: str,
) -> str:
    usable = int(quality.get("usable_sources") or 0)
    domains = int(quality.get("domains") or 0)
    max_chars = int(quality.get("max_content_chars") or 0)
    extraction = float(quality.get("extraction_success_rate") or 0.0)
    if str(language or "en").lower().startswith("ar"):
        return (
            "جودة البحث أقل من الحد المطلوب. "
            f"المصادر الصالحة: {usable}/{min_usable_sources}، "
            f"النطاقات المختلفة: {domains}/{min_domains}، "
            f"أكبر محتوى مستخرج: {max_chars}/{min_content_chars} حرف، "
            f"ونسبة نجاح الاستخراج: {int(round(extraction * 100))}%."
        )
    return (
        "Search quality is below the required threshold. "
        f"usable_sources={usable}/{min_usable_sources}, "
        f"domains={domains}/{min_domains}, "
        f"max_content_chars={max_chars}/{min_content_chars}, "
        f"extraction_success_rate={extraction:.2f}"
    )


def _extractive_summary_from_rows(rows: List[Dict[str, Any]], fallback: str) -> str:
    snippets: List[str] = []
    for row in rows:
        if str(row.get("status") or "").lower() != "completed":
            continue
        title = str(row.get("title") or "").strip()
        preview = str(row.get("snippet") or "").strip()
        if not preview:
            continue
        if title:
            snippets.append(f"{title}: {preview}")
        else:
            snippets.append(preview)
        if len(snippets) >= 4:
            break
    combined = " | ".join(snippets).strip()
    if combined:
        return combined[:1800]
    return str(fallback or "").strip()[:1800]


def _build_evidence_cards_from_rows(rows: List[Dict[str, Any]], fallback_cards: List[str]) -> List[str]:
    cards: List[str] = []
    for row in rows:
        if str(row.get("status") or "").lower() != "completed":
            continue
        preview = str(row.get("snippet") or "").strip()
        if not preview:
            continue
        cards.append(preview[:180])
        if len(cards) >= 4:
            break
    for card in fallback_cards or []:
        text = str(card or "").strip()
        if not text:
            continue
        cards.append(text[:180])
        if len(cards) >= 6:
            break
    dedup: List[str] = []
    seen: set[str] = set()
    for card in cards:
        norm = " ".join(card.split()).lower()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        dedup.append(card)
    return dedup[:6]


async def _persist_research_pause_checkpoint(
    simulation_id: str,
    *,
    checkpoint: Dict[str, Any],
    meta: Dict[str, Any],
    reason: str,
    status_reason: str,
) -> None:
    meta["status"] = "paused"
    meta["status_reason"] = status_reason
    meta["last_error"] = reason
    checkpoint["meta"] = meta
    await db_core.update_simulation(simulation_id=simulation_id, status="paused")
    await db_core.upsert_simulation_checkpoint(
        simulation_id=simulation_id,
        checkpoint=checkpoint,
        status="paused",
        last_error=reason,
        status_reason=status_reason,
        current_phase_key="search_bootstrap",
        phase_progress_pct=float(meta.get("phase_progress_pct") or 100.0),
        event_seq=int(meta.get("event_seq") or 0),
    )


async def _run_research_loop(
    simulation_id: str,
    user_context: Dict[str, Any],
    *,
    resume_checkpoint: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    context = dict(user_context or {})
    existing_summary = str(context.get("research_summary") or "").strip()
    existing_structured = context.get("research_structured") if isinstance(context.get("research_structured"), dict) else None
    existing_sources = context.get("research_sources") if isinstance(context.get("research_sources"), list) else []
    if existing_summary and (existing_structured or existing_sources):
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "research_done",
                "status": "completed",
                "cycle_id": "existing",
                "snippet": existing_summary[:280],
                "meta_json": {
                    "quality_snapshot": context.get("search_quality") if isinstance(context.get("search_quality"), dict) else {},
                },
            },
        )
        return {"ok": True, "context": context, "status_reason": "running"}

    checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
    checkpoint = resume_checkpoint if isinstance(resume_checkpoint, dict) else ((checkpoint_row or {}).get("checkpoint") or {})
    meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}

    research_loop_state = meta.get("research_loop_state") if isinstance(meta.get("research_loop_state"), dict) else {}
    pending_review = meta.get("pending_research_review") if isinstance(meta.get("pending_research_review"), dict) else None
    cycle_index = int(meta.get("research_cycle_index") or 0)
    max_cycles = max(1, min(6, int(os.getenv("RESEARCH_MAX_CYCLES", "4") or 4)))

    configured_min_usable_sources = max(1, int(os.getenv("SEARCH_MIN_USABLE_SOURCES", "2") or 2))
    configured_min_domains = max(1, int(os.getenv("SEARCH_MIN_DOMAINS", "2") or 2))
    configured_min_content_chars = max(40, int(os.getenv("SEARCH_MIN_CONTENT_CHARS", "80") or 80))
    balanced_gate_enabled = str(os.getenv("SEARCH_GATE_BALANCED", "1")).strip().lower() in {"1", "true", "yes", "on"}
    min_usable_sources = min(configured_min_usable_sources, 2) if balanced_gate_enabled else configured_min_usable_sources
    min_domains = min(configured_min_domains, 2) if balanced_gate_enabled else configured_min_domains
    min_content_chars = min(configured_min_content_chars, 80) if balanced_gate_enabled else configured_min_content_chars

    language = str(context.get("language") or "en").strip().lower() or "en"
    await _emit_live_event(
        simulation_id,
        "phase_update",
        {
            "phase_key": "search_bootstrap",
            "phase_label": "Search Bootstrap",
            "progress_pct": 2.0,
            "status": "running",
        },
    )
    await _emit_live_event(
        simulation_id,
        "research_update",
        {
            "action": "research_started",
            "status": "running",
            "cycle_id": None,
            "snippet": str(context.get("idea") or "").strip()[:280],
        },
    )

    while cycle_index < max_cycles:
        cycle_index += 1
        cycle_id = f"cycle_{cycle_index}_{uuid.uuid4().hex[:6]}"
        query_plan = _build_search_query_variants(context)
        if not query_plan:
            break

        refinement = str(research_loop_state.get("query_refinement") or "").strip()
        mode = str(research_loop_state.get("mode") or "").strip().lower()
        if refinement:
            query_plan = [refinement, *[q for q in query_plan if q != refinement]]

        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "query_planned",
                "status": "running",
                "cycle_id": cycle_id,
                "snippet": query_plan[0][:280],
                "meta_json": {
                    "query_plan": query_plan[:5],
                    "query_refinement": refinement or None,
                },
            },
        )

        candidate_urls: List[Dict[str, Any]] = []
        structured: Dict[str, Any] = {}
        base_answer = ""
        search_quality: Dict[str, Any] = {}
        if mode == "scrape_selected" and pending_review and str(pending_review.get("cycle_id") or "").strip():
            candidate_urls = pending_review.get("candidate_urls") if isinstance(pending_review.get("candidate_urls"), list) else []
            cycle_id = str(pending_review.get("cycle_id") or cycle_id)
            query_plan = pending_review.get("query_plan") if isinstance(pending_review.get("query_plan"), list) else query_plan
        else:
            search_result: Dict[str, Any] = {}
            for query in query_plan[:4]:
                try:
                    search_result = await search_web(query=query, max_results=8, language=language, strict_web_only=True)
                except Exception:
                    continue
                candidate_urls = _prepare_candidate_urls(search_result.get("results") or [])
                if candidate_urls:
                    break
            structured = search_result.get("structured") if isinstance(search_result.get("structured"), dict) else {}
            base_answer = str(search_result.get("answer") or "").strip()
            search_quality = search_result.get("quality") if isinstance(search_result.get("quality"), dict) else {}

        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "search_results_ready",
                "status": "completed" if candidate_urls else "failed",
                "cycle_id": cycle_id,
                "snippet": query_plan[0][:280],
                "meta_json": {
                    "query_plan": query_plan[:5],
                    "candidate_urls": candidate_urls,
                    "quality_snapshot": {
                        "usable_sources": int(search_quality.get("usable_sources") or 0),
                        "domains": int(search_quality.get("domains") or 0),
                        "extraction_success_rate": float(search_quality.get("extraction_success_rate") or 0.0),
                        "max_content_chars": max([len(str(item.get("snippet") or "")) for item in candidate_urls] + [0]),
                    },
                },
            },
        )

        if not candidate_urls:
            gap_summary = (
                "No live candidate URLs were found. Try refining the query."
                if language != "ar"
                else "لم يتم العثور على روابط بحث مباشرة كافية. حاول تعديل الاستعلام."
            )
            suggested_queries = [q for q in query_plan[:3] if q]
            pending_payload = {
                "cycle_id": cycle_id,
                "query_plan": query_plan[:5],
                "candidate_urls": [],
                "quality_snapshot": {
                    "usable_sources": 0,
                    "domains": 0,
                    "extraction_success_rate": 0.0,
                    "max_content_chars": 0,
                },
                "gap_summary": gap_summary,
                "suggested_queries": suggested_queries,
                "required": True,
            }
            review_event = await _emit_live_event(
                simulation_id,
                "research_update",
                {
                    "action": "review_required",
                    "status": "paused",
                    "cycle_id": cycle_id,
                    "error": gap_summary,
                    "snippet": gap_summary,
                    "meta_json": pending_payload,
                },
            )
            meta["pending_research_review"] = pending_payload
            meta["research_cycle_index"] = cycle_index
            meta["last_research_quality"] = pending_payload["quality_snapshot"]
            meta["last_research_gaps"] = [gap_summary]
            meta["research_loop_state"] = {}
            meta["event_seq"] = max(int(meta.get("event_seq") or 0), int(review_event.get("event_seq") or 0))
            meta["phase_progress_pct"] = 100.0
            checkpoint["meta"] = meta
            await _persist_research_pause_checkpoint(
                simulation_id,
                checkpoint=checkpoint,
                meta=meta,
                reason=gap_summary,
                status_reason="paused_research_review",
            )
            return {"ok": False, "status_reason": "paused_research_review", "reason": gap_summary}

        selected_url_ids = research_loop_state.get("selected_url_ids") if isinstance(research_loop_state.get("selected_url_ids"), list) else []
        added_urls = research_loop_state.get("added_urls") if isinstance(research_loop_state.get("added_urls"), list) else []
        selected: List[Dict[str, Any]]
        if mode == "scrape_selected":
            selected_lookup = {str(item.get("id") or "").strip() for item in selected_url_ids if str(item or "").strip()}
            selected = [item for item in candidate_urls if str(item.get("id") or "").strip() in selected_lookup]
            for raw_url in added_urls:
                url = str(raw_url or "").strip()
                if not url:
                    continue
                domain = ""
                try:
                    domain = (urlparse(url).hostname or "").strip()
                except Exception:
                    domain = ""
                selected.append(
                    {
                        "id": _candidate_url_id(url),
                        "url": url,
                        "domain": domain,
                        "title": url,
                        "snippet": "",
                        "favicon_url": _build_favicon_url(domain, url),
                        "score": 0.0,
                    }
                )
        else:
            selected = _pick_diverse_urls(candidate_urls, limit=4)

        if not selected:
            selected = _pick_diverse_urls(candidate_urls, limit=2)

        extraction_rows: List[Dict[str, Any]] = []
        for index, item in enumerate(selected, start=1):
            url = str(item.get("url") or "").strip()
            domain = str(item.get("domain") or "").strip()
            title = str(item.get("title") or "").strip()
            await _emit_live_event(
                simulation_id,
                "research_update",
                {
                    "action": "fetch_started",
                    "status": "running",
                    "cycle_id": cycle_id,
                    "url": url,
                    "domain": domain,
                    "favicon_url": item.get("favicon_url"),
                    "title": title,
                    "relevance_score": float(item.get("score") or 0.0),
                    "progress_pct": min(95.0, 20.0 + (index * 60.0 / max(1, len(selected)))),
                },
            )
            fetched = await fetch_page(url)
            if fetched.get("ok"):
                preview = str(fetched.get("preview") or "").strip()
                event = await _emit_live_event(
                    simulation_id,
                    "research_update",
                    {
                        "action": "fetch_done",
                        "status": "completed",
                        "cycle_id": cycle_id,
                        "url": url,
                        "domain": domain,
                        "favicon_url": item.get("favicon_url"),
                        "title": str(fetched.get("title") or title),
                        "http_status": int(fetched.get("http_status") or 200),
                        "content_chars": int(fetched.get("content_chars") or 0),
                        "relevance_score": float(item.get("score") or 0.0),
                        "snippet": preview[:280],
                    },
                )
                extraction_rows.append(
                    {
                        "status": "completed",
                        "cycle_id": cycle_id,
                        "url": url,
                        "domain": domain,
                        "title": str(fetched.get("title") or title),
                        "content_chars": int(fetched.get("content_chars") or 0),
                        "snippet": preview,
                        "event_seq": event.get("event_seq"),
                    }
                )
                await _emit_live_event(
                    simulation_id,
                    "research_update",
                    {
                        "action": "summary_ready",
                        "status": "completed",
                        "cycle_id": cycle_id,
                        "url": url,
                        "domain": domain,
                        "title": str(fetched.get("title") or title),
                        "snippet": preview[:280],
                    },
                )
            else:
                error_text = str(fetched.get("error") or "fetch_failed")
                await _emit_live_event(
                    simulation_id,
                    "research_update",
                    {
                        "action": "fetch_done",
                        "status": "failed",
                        "cycle_id": cycle_id,
                        "url": url,
                        "domain": domain,
                        "favicon_url": item.get("favicon_url"),
                        "title": title,
                        "error": error_text,
                        "snippet": None,
                    },
                )
                extraction_rows.append(
                    {
                        "status": "failed",
                        "cycle_id": cycle_id,
                        "url": url,
                        "domain": domain,
                        "title": title,
                        "content_chars": 0,
                        "snippet": "",
                        "error": error_text,
                    }
                )

        quality_snapshot = _compute_extraction_quality(extraction_rows)
        fallback_cards = structured.get("evidence_cards") if isinstance(structured.get("evidence_cards"), list) else []
        evidence_cards = _build_evidence_cards_from_rows(extraction_rows, fallback_cards)
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "evidence_cards_ready",
                "status": "completed",
                "cycle_id": cycle_id,
                "snippet": (evidence_cards[0] if evidence_cards else None),
                "meta_json": {
                    "evidence_cards": evidence_cards,
                },
            },
        )

        quality_ok = (
            int(quality_snapshot.get("usable_sources") or 0) >= min_usable_sources
            and int(quality_snapshot.get("domains") or 0) >= min_domains
            and int(quality_snapshot.get("max_content_chars") or 0) >= min_content_chars
            and float(quality_snapshot.get("extraction_success_rate") or 0.0) > 0.0
        )
        gap_summary = _build_gap_summary(
            quality_snapshot,
            min_usable_sources=min_usable_sources,
            min_domains=min_domains,
            min_content_chars=min_content_chars,
            language=language,
        )
        suggested_queries = query_plan[:3]
        await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "gaps_ready",
                "status": "completed",
                "cycle_id": cycle_id,
                "snippet": gap_summary[:280],
                "meta_json": {
                    "gap_summary": gap_summary,
                    "suggested_queries": suggested_queries,
                    "quality_snapshot": quality_snapshot,
                },
            },
        )

        if not quality_ok:
            pending_payload = {
                "cycle_id": cycle_id,
                "query_plan": query_plan[:5],
                "candidate_urls": candidate_urls,
                "quality_snapshot": quality_snapshot,
                "gap_summary": gap_summary,
                "suggested_queries": suggested_queries,
                "required": True,
            }
            review_event = await _emit_live_event(
                simulation_id,
                "research_update",
                {
                    "action": "review_required",
                    "status": "paused",
                    "cycle_id": cycle_id,
                    "error": gap_summary,
                    "snippet": gap_summary[:280],
                    "meta_json": pending_payload,
                },
            )
            meta["pending_research_review"] = pending_payload
            meta["research_cycle_index"] = cycle_index
            meta["last_research_quality"] = quality_snapshot
            meta["last_research_gaps"] = [gap_summary]
            meta["research_loop_state"] = {}
            meta["event_seq"] = max(int(meta.get("event_seq") or 0), int(review_event.get("event_seq") or 0))
            meta["phase_progress_pct"] = 100.0
            checkpoint["meta"] = meta
            await _persist_research_pause_checkpoint(
                simulation_id,
                checkpoint=checkpoint,
                meta=meta,
                reason=gap_summary,
                status_reason="paused_research_review",
            )
            return {"ok": False, "status_reason": "paused_research_review", "reason": gap_summary}

        summary_text = _extractive_summary_from_rows(extraction_rows, structured.get("summary") if isinstance(structured, dict) else base_answer)
        sources = []
        for row in extraction_rows:
            if str(row.get("status") or "").lower() != "completed":
                continue
            sources.append(
                {
                    "title": row.get("title"),
                    "url": row.get("url"),
                    "domain": row.get("domain"),
                    "snippet": str(row.get("snippet") or "")[:280],
                    "score": None,
                    "reason": "Fetched and extracted",
                }
            )
        context["research_summary"] = summary_text
        context["research_sources"] = sources
        structured_payload = structured if isinstance(structured, dict) else {}
        structured_payload = {**structured_payload}
        structured_payload["summary"] = structured_payload.get("summary") or summary_text
        structured_payload["evidence_cards"] = evidence_cards
        structured_payload["gaps"] = structured_payload.get("gaps") if isinstance(structured_payload.get("gaps"), list) else []
        context["research_structured"] = structured_payload
        context["search_quality"] = {
            "usable_sources": int(quality_snapshot.get("usable_sources") or 0),
            "domains": int(quality_snapshot.get("domains") or 0),
            "extraction_success_rate": float(quality_snapshot.get("extraction_success_rate") or 0.0),
        }
        context["evidence_cards"] = evidence_cards

        done_event = await _emit_live_event(
            simulation_id,
            "research_update",
            {
                "action": "research_done",
                "status": "completed",
                "cycle_id": cycle_id,
                "snippet": summary_text[:280],
                "meta_json": {
                    "quality_snapshot": quality_snapshot,
                    "cycle_id": cycle_id,
                    "evidence_cards": evidence_cards,
                },
            },
        )
        await _emit_live_event(
            simulation_id,
            "phase_update",
            {
                "phase_key": "search_bootstrap",
                "phase_label": "Search Bootstrap",
                "progress_pct": 100.0,
                "status": "completed",
            },
        )
        meta["pending_research_review"] = None
        meta["research_cycle_index"] = cycle_index
        meta["last_research_quality"] = quality_snapshot
        meta["last_research_gaps"] = []
        meta["research_loop_state"] = {}
        meta["status"] = "running"
        meta["status_reason"] = "running"
        meta["last_error"] = None
        meta["search_quality"] = context.get("search_quality")
        meta["current_phase_key"] = "evidence_map"
        meta["phase_progress_pct"] = 0.0
        meta["event_seq"] = max(int(meta.get("event_seq") or 0), int(done_event.get("event_seq") or 0))
        checkpoint["meta"] = meta
        await db_core.upsert_simulation_checkpoint(
            simulation_id=simulation_id,
            checkpoint=checkpoint,
            status="running",
            last_error=None,
            status_reason="running",
            current_phase_key="evidence_map",
            phase_progress_pct=0.0,
            event_seq=int(meta.get("event_seq") or 0),
        )
        return {"ok": True, "context": context, "status_reason": "running"}

    message = (
        "Search loop reached maximum cycles without enough live evidence."
        if language != "ar"
        else "انتهت دورات البحث دون الوصول إلى أدلة مباشرة كافية."
    )
    failed_event = await _emit_live_event(
        simulation_id,
        "research_update",
        {
            "action": "research_failed",
            "status": "failed",
            "cycle_id": None,
            "error": message,
            "snippet": message,
        },
    )
    await _emit_live_event(
        simulation_id,
        "phase_update",
        {
            "phase_key": "search_bootstrap",
            "phase_label": "Search Bootstrap",
            "progress_pct": 100.0,
            "status": "failed",
            "reason": message,
        },
    )
    meta["pending_research_review"] = None
    meta["research_loop_state"] = {}
    meta["research_cycle_index"] = cycle_index
    meta["status"] = "paused"
    meta["status_reason"] = "paused_search_failed"
    meta["last_error"] = message
    meta["event_seq"] = max(int(meta.get("event_seq") or 0), int(failed_event.get("event_seq") or 0))
    checkpoint["meta"] = meta
    await _persist_research_pause_checkpoint(
        simulation_id,
        checkpoint=checkpoint,
        meta=meta,
        reason=message,
        status_reason="paused_search_failed",
    )
    return {"ok": False, "status_reason": "paused_search_failed", "reason": message}


def _analyze_rejectors(reasoning: list[Dict[str, Any]], language: str) -> str:
    reject_messages = [step.get("message", "") for step in reasoning if step.get("opinion") == "reject"]
    if not reject_messages:
        return ""

    text_blob = " ".join(reject_messages).lower()
    themes = {
        "competition": ["competition", "crowded", "saturated", "many similar"],
        "trust": ["trust", "privacy", "data", "security", "credibility"],
        "regulation": ["regulation", "compliance", "legal", "liability", "policy"],
        "economics": ["cost", "price", "roi", "margin", "budget"],
        "feasibility": ["feasible", "implementation", "maintenance", "scale", "complexity"],
        "adoption": ["adoption", "behavior", "usage", "onboarding", "retention"],
    }

    hits: list[str] = []
    for key, keywords in themes.items():
        if any(word in text_blob for word in keywords):
            hits.append(key)

    if not hits:
        hits = ["trust", "feasibility"]

    advice_map_en = {
        "competition": "Address competition through clear differentiation or a less crowded segment/location.",
        "trust": "Increase trust with transparent privacy, data protection, and security controls.",
        "regulation": "Provide a concrete compliance plan from day one.",
        "economics": "Clarify pricing and ROI so value clearly exceeds cost.",
        "feasibility": "Show a realistic phased execution and maintenance plan.",
        "adoption": "Explain an adoption path with simple onboarding and clear incentives.",
    }
    tips = " ".join(advice_map_en[k] for k in hits[:2])
    return f"Advice to persuade rejecters: {tips}"


async def _build_summary(user_context: Dict[str, Any], metrics: Dict[str, Any], reasoning: list[Dict[str, Any]]) -> str:
    idea = user_context.get("idea", "")
    research_summary = user_context.get("research_summary", "")
    language = str(user_context.get("language") or "en").lower()
    accepted = metrics.get("accepted", 0)
    rejected = metrics.get("rejected", 0)
    neutral = metrics.get("neutral", 0)
    acceptance_rate = metrics.get("acceptance_rate", 0.0)
    polarization = metrics.get("polarization", 0.0)
    per_category = metrics.get("per_category", {})
    sample_reasoning = " | ".join([step.get("message", "") for step in reasoning[-6:]])

    rejecter_advice = _analyze_rejectors(reasoning, language)

    response_language = "Arabic" if language == "ar" else "English"
    prompt = (
        "You are summarising a multi-agent market simulation. "
        "Write 8-12 short sentences in a friendly, human tone. "
        "Explicitly list 2-3 pros and 2-3 cons. "
        "Add a brief viability judgment (realistic vs risky) and 1-2 alternatives or pivots. "
        "Mention acceptance rate, polarization, and key concerns. "
        "Give a realistic recommendation (improve, validate, or proceed). "
        "End with a short, targeted advice to persuade the rejecting segment. "
        f"Idea: {idea}\n"
        f"Research context: {research_summary}\n"
        f"Metrics: accepted={accepted}, rejected={rejected}, neutral={neutral}, "
        f"acceptance_rate={acceptance_rate:.2f}, polarization={polarization:.2f}\n"
        f"Category acceptance counts: {per_category}\n"
        f"Sample reasoning: {sample_reasoning}\n"
        f"Rejecter advice seed: {rejecter_advice}\n"
        f"Respond in {response_language}.\n"
    )
    try:
        summary = await generate_ollama(prompt=prompt, temperature=0.3)
        return f"{summary}\n\n{rejecter_advice}" if rejecter_advice else summary
    except Exception:
        if acceptance_rate >= 0.6:
            base = (
                "Overall feedback is positive. Pros include clear value and feasible execution, "
                "while main concerns are compliance, trust, and operations. "
                "Recommendation: run a focused pilot before scaling."
            )
        elif acceptance_rate >= 0.35:
            base = (
                "Feedback is mixed. Potential exists, but risk, trust, and economics need tighter validation. "
                "Recommendation: narrow scope, add safeguards, and test with a smaller segment."
            )
        else:
            base = (
                "Most agents are skeptical in the current form. "
                "Recommendation: simplify the model and reduce legal/ethical risk before further investment."
            )
        return f"{base}\n{rejecter_advice}" if rejecter_advice else base


async def _start_background_simulation(
    simulation_id: str,
    user_context: Dict[str, Any],
    user_id: Optional[int],
    resume_checkpoint: Optional[Dict[str, Any]] = None,
) -> None:
    """Launch a simulation task and wire event/checkpoint persistence."""
    global dataset
    if dataset is None:
        raise HTTPException(status_code=500, detail="Dataset not loaded")
    engine = SimulationEngine(dataset=dataset)

    async def checkpoint_emitter(checkpoint: Dict[str, Any]) -> None:
        meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
        status_value = str(meta.get("status") or "running").lower()
        last_error = meta.get("last_error")
        status_reason = str(meta.get("status_reason") or "").strip() or None
        policy_mode = str(meta.get("policy_mode") or "normal").strip() or "normal"
        policy_reason = str(meta.get("policy_reason") or "").strip() or None
        search_quality = meta.get("search_quality") if isinstance(meta.get("search_quality"), dict) else None
        current_phase_key = str(meta.get("current_phase_key") or "").strip() or None
        phase_progress_pct = meta.get("phase_progress_pct")
        event_seq = meta.get("event_seq")
        await db_core.upsert_simulation_checkpoint(
            simulation_id=simulation_id,
            checkpoint=checkpoint,
            status=status_value if status_value in {"running", "paused", "completed", "error"} else "running",
            last_error=str(last_error) if last_error else None,
            status_reason=status_reason,
            current_phase_key=current_phase_key,
            phase_progress_pct=float(phase_progress_pct) if phase_progress_pct is not None else None,
            event_seq=int(event_seq) if event_seq is not None else None,
        )
        state = _simulation_state.setdefault(simulation_id, {})
        if current_phase_key:
            state["current_phase_key"] = current_phase_key
        state["policy_mode"] = policy_mode
        state["policy_reason"] = policy_reason
        if isinstance(search_quality, dict):
            state["search_quality"] = search_quality
        if phase_progress_pct is not None:
            try:
                state["phase_progress_pct"] = float(phase_progress_pct)
            except Exception:
                pass
        if event_seq is not None:
            try:
                state["event_seq"] = max(int(state.get("event_seq") or 0), int(event_seq))
            except Exception:
                pass
        if status_value in {"error", "paused"}:
            state["can_resume"] = True
            state["resume_reason"] = str(last_error) if last_error else state.get("resume_reason")
            if status_value == "error":
                state["status_reason"] = "error"
            else:
                state["status_reason"] = status_reason or "paused_manual"
            if status_value == "error":
                state["error"] = state.get("resume_reason")
        elif status_value == "completed":
            state["can_resume"] = False
            state["resume_reason"] = None
            state["error"] = None
            state["status_reason"] = "completed"

    async def emitter(event_type: str, data: Dict[str, Any]) -> None:
        """Broadcast events, keep memory snapshot, and persist every event."""
        event_seq = data.get("event_seq")
        if not isinstance(event_seq, int):
            event_seq = _next_event_seq(simulation_id)
        event_data = {**data, "event_seq": event_seq}
        payload = {"type": event_type, "simulation_id": simulation_id, **event_data}
        await manager.broadcast_json(payload)
        _store_event(simulation_id, event_type, event_data)
        try:
            if event_type == "agents" and data.get("iteration") == 0:
                await db_core.insert_agents(simulation_id, event_data.get("agents") or [])
            elif event_type == "reasoning_step":
                await db_core.insert_reasoning_step(simulation_id, event_data)
                await db_core.update_agent_runtime_state(
                    simulation_id=simulation_id,
                    agent_id=str(event_data.get("agent_id") or ""),
                    opinion=str(event_data.get("opinion") or "neutral"),
                    confidence=float(event_data.get("stance_confidence") or 0.0),
                    phase=str(event_data.get("phase") or ""),
                )
            elif event_type == "metrics":
                await db_core.insert_metrics(simulation_id, event_data)
            elif event_type == "research_update":
                await db_core.insert_research_event(simulation_id, event_data)
        except Exception:
            # Event persistence is best-effort and should not stop the run.
            pass
        if event_type == "reasoning_step" and user_id is not None:
            token_estimate = _estimate_text_tokens(str(event_data.get("message") or ""))
            billing = await auth_core.consume_simulation_tokens(user_id, simulation_id, token_estimate)
            if not billing.get("ok", True):
                missing = float(billing.get("outstanding_credits") or 0.0)
                raise _CreditsExhaustedPause(_billing_exhausted_message(missing), missing)

    async def run_and_store() -> None:
        nonlocal user_context
        try:
            checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
            checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
            checkpoint_meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
            current_phase_key = str(
                (checkpoint_row or {}).get("current_phase_key")
                or checkpoint_meta.get("current_phase_key")
                or ""
            ).strip().lower()
            # Research loop is mandatory before reasoning unless we are resuming mid-reasoning.
            if current_phase_key in {"", "search_bootstrap"} or not (
                str(user_context.get("research_summary") or "").strip()
                and isinstance(user_context.get("research_structured"), dict)
            ):
                research_result = await _run_research_loop(
                    simulation_id=simulation_id,
                    user_context=user_context,
                    resume_checkpoint=resume_checkpoint or checkpoint,
                )
                if not research_result.get("ok"):
                    reason = str(research_result.get("reason") or "Research loop paused")
                    status_reason = str(research_result.get("status_reason") or "paused_search_failed")
                    state = _simulation_state.setdefault(simulation_id, {})
                    state["error"] = None
                    state["can_resume"] = status_reason not in {"paused_research_review"}
                    state["resume_reason"] = reason
                    state["status_reason"] = status_reason
                    return
                user_context = research_result.get("context") if isinstance(research_result.get("context"), dict) else user_context
                try:
                    await db_core.update_simulation_context(simulation_id, user_context)
                    save_context(simulation_id, user_context)
                except Exception:
                    pass

            if not bool(checkpoint_meta.get("clarification_notice_sent")):
                notice_text = (
                    "تنبيه: أثناء التفكير، ممكن الوكلاء يطلبوا توضيح منك. خليك قريب من الجهاز."
                    if str(user_context.get("language") or "en").lower() == "ar"
                    else "Heads-up: during reasoning, agents may pause and ask for clarification. Stay near your device."
                )
                await _persist_chat_event(
                    simulation_id=simulation_id,
                    role="system",
                    content=notice_text,
                    meta={
                        "kind": "clarification_notice",
                        "required": False,
                    },
                    broadcast=True,
                )
                refreshed_checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
                refreshed_checkpoint = (refreshed_checkpoint_row or {}).get("checkpoint") or {}
                refreshed_meta = refreshed_checkpoint.get("meta") if isinstance(refreshed_checkpoint.get("meta"), dict) else {}
                refreshed_meta["clarification_notice_sent"] = True
                refreshed_checkpoint["meta"] = refreshed_meta
                current_phase = str((refreshed_checkpoint_row or {}).get("current_phase_key") or refreshed_meta.get("current_phase_key") or "").strip() or None
                phase_progress = (refreshed_checkpoint_row or {}).get("phase_progress_pct")
                await db_core.upsert_simulation_checkpoint(
                    simulation_id=simulation_id,
                    checkpoint=refreshed_checkpoint,
                    status=str((refreshed_checkpoint_row or {}).get("status") or "running").lower(),
                    last_error=(refreshed_checkpoint_row or {}).get("last_error"),
                    status_reason=str((refreshed_checkpoint_row or {}).get("status_reason") or "running"),
                    current_phase_key=current_phase,
                    phase_progress_pct=float(phase_progress) if phase_progress is not None else None,
                    event_seq=int(refreshed_meta.get("event_seq") or 0),
                )
            result = await engine.run_simulation(
                user_context=user_context,
                emitter=emitter,
                resume_state=resume_checkpoint,
                checkpoint_emitter=checkpoint_emitter,
            )
            _simulation_results[simulation_id] = result
            summary = await _build_summary(
                user_context=user_context,
                metrics=result,
                reasoning=_simulation_state.get(simulation_id, {}).get("reasoning", []),
            )
            state = _simulation_state.setdefault(simulation_id, {})
            state["summary"] = summary
            state["summary_ready"] = True
            state["summary_at"] = datetime.utcnow().isoformat() + "Z"
            state["can_resume"] = False
            state["resume_reason"] = None
            state["error"] = None
            state["status_reason"] = "completed"
            await db_core.update_simulation(
                simulation_id=simulation_id,
                status="completed",
                summary=summary,
                ended_at=state["summary_at"],
                final_metrics=result,
            )
            checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
            await db_core.upsert_simulation_checkpoint(
                simulation_id=simulation_id,
                checkpoint=(checkpoint_row or {}).get("checkpoint") or {},
                status="completed",
                last_error=None,
                status_reason="completed",
                current_phase_key=None,
                phase_progress_pct=100.0,
                event_seq=int(state.get("event_seq") or 0),
            )
            if user_id is not None:
                await auth_core.log_audit(
                    user_id,
                    "simulation.completed",
                    {
                        "simulation_id": simulation_id,
                        "idea": user_context.get("idea"),
                        "acceptance_rate": result.get("acceptance_rate"),
                    },
                )
            await manager.broadcast_json({"type": "summary", "simulation_id": simulation_id, "summary": summary})
        except ClarificationNeeded as clarification_exc:
            payload = dict(clarification_exc.payload or {})
            reason_tag = str(payload.get("reason_tag") or "evidence_gap")
            reason_summary = str(payload.get("reason_summary") or "Clarification required before continuing.").strip()
            question_text = str(payload.get("question") or "").strip()
            language_code = str(user_context.get("language") or "en").lower()
            fallback_template = _clarification_fallback_template(reason_tag, language_code, reason_summary)
            options = _normalize_clarification_options(payload.get("options"))
            if len(options) < 3:
                options = _normalize_clarification_options(fallback_template.get("options"))
            decision_axis = str(
                payload.get("decision_axis")
                or fallback_template.get("decision_axis")
                or "evidence_priority"
            ).strip()
            supporting_snippets_raw = payload.get("supporting_snippets")
            supporting_snippets: List[str] = []
            if isinstance(supporting_snippets_raw, list):
                supporting_snippets = [
                    str(item).strip()[:240]
                    for item in supporting_snippets_raw
                    if str(item).strip()
                ][:3]
            affected_agents_raw = payload.get("affected_agents")
            affected_agents: Dict[str, int] | None = None
            if isinstance(affected_agents_raw, dict):
                affected_agents = {
                    "reject": int(affected_agents_raw.get("reject") or 0),
                    "neutral": int(affected_agents_raw.get("neutral") or 0),
                    "total_window": int(affected_agents_raw.get("total_window") or 0),
                }
            question_quality_raw = payload.get("question_quality")
            question_quality: Dict[str, Any] | None = None
            if isinstance(question_quality_raw, dict):
                checks_passed_raw = question_quality_raw.get("checks_passed")
                question_quality = {
                    "score": float(question_quality_raw.get("score") or 0.0),
                    "checks_passed": [
                        str(item).strip()
                        for item in (checks_passed_raw if isinstance(checks_passed_raw, list) else [])
                        if str(item).strip()
                    ],
                }
            if not question_text:
                question_text = str(fallback_template.get("question") or "").strip()
            question_id = str(payload.get("question_id") or uuid.uuid4().hex[:12])
            created_at = int(payload.get("created_at") or int(datetime.utcnow().timestamp() * 1000))
            clarification_data = {
                "event_seq": _next_event_seq(simulation_id),
                "question_id": question_id,
                "question": question_text,
                "options": options,
                "reason_tag": reason_tag,
                "reason_summary": reason_summary,
                "decision_axis": decision_axis,
                "affected_agents": affected_agents,
                "supporting_snippets": supporting_snippets,
                "question_quality": question_quality,
                "created_at": created_at,
                "required": True,
            }
            await manager.broadcast_json({"type": "clarification_request", "simulation_id": simulation_id, **clarification_data})
            _store_event(simulation_id, "clarification_request", clarification_data)

            state = _simulation_state.setdefault(simulation_id, {})
            state["error"] = None
            state["can_resume"] = False
            state["resume_reason"] = reason_summary
            state["status_reason"] = "paused_clarification_needed"
            state["clarification_count"] = int(state.get("clarification_count") or 0) + 1
            state["pending_clarification"] = {
                "question_id": question_id,
                "question": clarification_data["question"],
                "options": options,
                "reason_tag": reason_tag,
                "reason_summary": reason_summary,
                "decision_axis": decision_axis,
                "affected_agents": affected_agents,
                "supporting_snippets": supporting_snippets,
                "question_quality": question_quality,
                "created_at": created_at,
                "required": True,
            }
            state["can_answer_clarification"] = True

            checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
            checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
            meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
            clarification_history = meta.get("clarification_history") if isinstance(meta.get("clarification_history"), list) else []
            clarification_history.append(
                {
                    "question_id": question_id,
                    "reason_tag": reason_tag,
                    "reason_summary": reason_summary,
                    "decision_axis": decision_axis,
                    "created_at": created_at,
                }
            )
            meta["clarification_history"] = clarification_history[-40:]
            meta["clarification_count"] = int(meta.get("clarification_count") or 0) + 1
            meta["pending_clarification"] = state["pending_clarification"]
            meta["last_clarification_reason_tag"] = reason_tag
            meta["last_clarification_step"] = int(meta.get("total_reasoning_steps") or 0)
            meta["last_clarification_phase"] = str(payload.get("phase_label") or meta.get("phase_label") or "")
            meta["status"] = "paused"
            meta["status_reason"] = "paused_clarification_needed"
            meta["last_error"] = reason_summary
            meta["event_seq"] = max(int(meta.get("event_seq") or 0), int(clarification_data["event_seq"]))
            checkpoint["meta"] = meta
            current_phase = str((checkpoint_row or {}).get("current_phase_key") or meta.get("current_phase_key") or "").strip() or None
            phase_progress = (checkpoint_row or {}).get("phase_progress_pct")
            await db_core.update_simulation(simulation_id=simulation_id, status="paused")
            await db_core.upsert_simulation_checkpoint(
                simulation_id=simulation_id,
                checkpoint=checkpoint,
                status="paused",
                last_error=reason_summary,
                status_reason="paused_clarification_needed",
                current_phase_key=current_phase,
                phase_progress_pct=float(phase_progress) if phase_progress is not None else None,
                event_seq=int(meta.get("event_seq") or clarification_data["event_seq"]),
            )
            await _persist_chat_event(
                simulation_id=simulation_id,
                role="system",
                content=clarification_data["question"],
                meta={
                    "kind": "clarification_request",
                    "question_id": question_id,
                    "required": True,
                    "reason_tag": reason_tag,
                    "reason_summary": reason_summary,
                    "decision_axis": decision_axis,
                    "affected_agents": affected_agents,
                    "supporting_snippets": supporting_snippets,
                    "question_quality": question_quality,
                    "options": {
                        "field": "clarification_choice",
                        "kind": "single",
                        "items": [
                            {
                                "value": option["id"],
                                "label": option["label"],
                            }
                            for option in options
                        ],
                    },
                },
                broadcast=True,
            )
            if user_id is not None:
                await auth_core.log_audit(
                    user_id,
                    "simulation.clarification_requested",
                    {
                        "simulation_id": simulation_id,
                        "question_id": question_id,
                        "reason_tag": reason_tag,
                    },
                )
        except asyncio.CancelledError:
            reason = _simulation_pause_reasons.pop(simulation_id, None) or "Simulation paused. You can resume anytime."
            state = _simulation_state.setdefault(simulation_id, {})
            state["error"] = None
            state["can_resume"] = True
            state["resume_reason"] = reason
            state["status_reason"] = "paused_manual"
            try:
                await db_core.update_simulation(simulation_id=simulation_id, status="paused")
            except Exception:
                pass
            checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
            checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
            meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
            meta["status"] = "paused"
            meta["last_error"] = reason
            checkpoint["meta"] = meta
            checkpoint.setdefault("agents", [])
            checkpoint.setdefault("metrics_counts", {})
            checkpoint.setdefault("metrics_breakdown", {})
            await db_core.upsert_simulation_checkpoint(
                simulation_id=simulation_id,
                checkpoint=checkpoint,
                status="paused",
                last_error=reason,
                status_reason="paused_manual",
                current_phase_key=str(meta.get("current_phase_key") or "") or None,
                phase_progress_pct=float(meta.get("phase_progress_pct") or 0.0) if meta.get("phase_progress_pct") is not None else None,
                event_seq=int(meta.get("event_seq") or 0) if meta.get("event_seq") is not None else None,
            )
            if user_id is not None:
                await auth_core.log_audit(
                    user_id,
                    "simulation.paused",
                    {"simulation_id": simulation_id, "reason": reason},
                )
        except Exception as exc:  # noqa: BLE001
            message = str(exc)
            state = _simulation_state.setdefault(simulation_id, {})
            lowered = message.lower()
            search_bootstrap_failure = "search bootstrap" in lowered
            credits_exhausted = isinstance(exc, _CreditsExhaustedPause)
            paused_reason = "paused_search_failed" if search_bootstrap_failure else (
                "paused_credits_exhausted" if credits_exhausted else "error"
            )
            paused_status = "paused" if paused_reason in {"paused_search_failed", "paused_credits_exhausted"} else "error"
            state["error"] = None if paused_status == "paused" else message
            state["can_resume"] = True
            state["resume_reason"] = message
            state["status_reason"] = paused_reason
            try:
                await db_core.update_simulation(simulation_id=simulation_id, status=paused_status)
            except Exception:
                pass
            checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
            checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
            meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
            meta["status"] = paused_status
            meta["last_error"] = message
            meta["status_reason"] = paused_reason
            checkpoint["meta"] = meta
            checkpoint.setdefault("agents", [])
            checkpoint.setdefault("metrics_counts", {})
            checkpoint.setdefault("metrics_breakdown", {})
            await db_core.upsert_simulation_checkpoint(
                simulation_id=simulation_id,
                checkpoint=checkpoint,
                status=paused_status,
                last_error=message,
                status_reason=paused_reason,
                current_phase_key=str(meta.get("current_phase_key") or "") or None,
                phase_progress_pct=float(meta.get("phase_progress_pct") or 0.0) if meta.get("phase_progress_pct") is not None else None,
                event_seq=int(meta.get("event_seq") or 0) if meta.get("event_seq") is not None else None,
            )

    task = asyncio.create_task(run_and_store())
    _simulation_tasks[simulation_id] = task


@router.post("/start")
async def start_simulation(user_context: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    """Initialise a new simulation.

    Accepts user-provided context (structured data) and kicks off a
    background simulation. Returns a unique simulation identifier so
    clients can subscribe to WebSocket updates or poll the REST API.
    """
    global dataset
    if dataset is None:
        raise HTTPException(status_code=500, detail="Dataset not loaded")
    # Authenticate user only when required (opt-in via env).
    user_id: Optional[int] = None
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        user_id = int(user.get("id"))

    if user_id is not None:
        # Keep legacy run-count analytics, but charging is token-based during execution.
        try:
            await auth_core.increment_daily_usage(user_id)
        except Exception:
            pass
    # Generate a unique ID for this simulation
    simulation_id = str(uuid.uuid4())
    run_mode = str(user_context.get("run_mode") or "normal").strip().lower() or "normal"
    preflight_ready = bool(user_context.get("preflight_ready"))
    preflight_summary = str(user_context.get("preflight_summary") or "").strip()
    preflight_answers = user_context.get("preflight_answers")
    preflight_assumptions = user_context.get("preflight_assumptions")
    try:
        preflight_clarity_score = float(user_context.get("preflight_clarity_score")) if user_context.get("preflight_clarity_score") is not None else None
    except Exception:
        preflight_clarity_score = None
    if _preflight_required() and not preflight_ready:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Preflight clarification is required before simulation start.",
        )
    if not isinstance(preflight_answers, dict):
        preflight_answers = {}
    if not isinstance(preflight_assumptions, list):
        preflight_assumptions = []
    try:
        neutral_cap_pct = float(user_context.get("neutral_cap_pct") if user_context.get("neutral_cap_pct") is not None else 0.30)
    except Exception:
        neutral_cap_pct = 0.30
    neutral_cap_pct = max(0.05, min(0.70, neutral_cap_pct))
    neutral_enforcement = str(user_context.get("neutral_enforcement") or "clarification_before_complete").strip() or "clarification_before_complete"
    user_context["run_mode"] = run_mode
    user_context["neutral_cap_pct"] = neutral_cap_pct
    user_context["neutral_enforcement"] = neutral_enforcement
    user_context["preflight_ready"] = preflight_ready
    user_context["preflight_summary"] = preflight_summary
    user_context["preflight_answers"] = preflight_answers
    user_context["preflight_clarity_score"] = preflight_clarity_score
    user_context["preflight_assumptions"] = [str(item).strip() for item in preflight_assumptions if str(item).strip()][:8]
    _init_state(simulation_id, user_id=user_id)
    _simulation_state[simulation_id]["current_phase_key"] = "search_bootstrap"
    _simulation_state[simulation_id]["phase_progress_pct"] = 0.0
    _simulation_state[simulation_id]["event_seq"] = 0
    _simulation_state[simulation_id]["policy_mode"] = "normal"
    _simulation_state[simulation_id]["policy_reason"] = None
    _simulation_state[simulation_id]["search_quality"] = None
    _simulation_state[simulation_id]["neutral_cap_pct"] = neutral_cap_pct
    _simulation_state[simulation_id]["neutral_enforcement"] = neutral_enforcement
    _simulation_state[simulation_id]["clarification_count"] = 0
    try:
        save_context(simulation_id, user_context)
    except Exception:
        # Persistence is best-effort; ignore failures.
        pass
    # Persist simulation with status; user_id stored in table via ALTER but function does not save user_id
    await db_core.insert_simulation(simulation_id, user_context, status="running", user_id=user_id)
    await db_core.upsert_simulation_checkpoint(
        simulation_id=simulation_id,
        checkpoint={
            "version": 1,
            "agents": [],
            "metrics_counts": {"accept": 0, "reject": 0, "neutral": 0},
                "metrics_breakdown": {},
                "recent_messages": [],
                "dialogue_history": [],
                "used_openers": [],
                "meta": {
                    "status": "running",
                    "status_reason": "running",
                    "policy_mode": "normal",
                    "policy_reason": None,
                    "search_quality": None,
                    "run_mode": run_mode,
                    "neutral_cap_pct": neutral_cap_pct,
                    "neutral_enforcement": neutral_enforcement,
                    "clarification_count": 0,
                    "last_error": None,
                    "next_iteration": 1,
                    "current_iteration": 0,
                    "phase_label": None,
                    "current_phase_key": "search_bootstrap",
                    "phase_progress_pct": 0.0,
                    "event_seq": 0,
                    "next_task_index": 0,
                    "current_tasks": [],
                    "pending_research_review": None,
                    "research_loop_state": {},
                    "research_cycle_index": 0,
                    "last_research_quality": None,
                    "last_research_gaps": [],
                    "preflight_ready": preflight_ready,
                    "preflight_clarity_score": preflight_clarity_score,
                },
            },
            status="running",
            last_error=None,
            status_reason="running",
            current_phase_key="search_bootstrap",
            phase_progress_pct=0.0,
            event_seq=0,
        )
    await _start_background_simulation(
        simulation_id=simulation_id,
        user_context=user_context,
        user_id=user_id,
        resume_checkpoint=None,
    )
    if user_id is not None:
        await auth_core.log_audit(
            user_id,
            "simulation.started",
            {"simulation_id": simulation_id, "idea": user_context.get("idea")},
        )
    return {"simulation_id": simulation_id, "status": "initializing"}


@router.post("/resume")
async def resume_simulation(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    """Resume an interrupted simulation from the latest checkpoint."""
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")

    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        await _ensure_simulation_access(simulation_id, user)

    checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
    checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
    checkpoint_meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
    pending_clarification = checkpoint_meta.get("pending_clarification") if isinstance(checkpoint_meta.get("pending_clarification"), dict) else None
    if pending_clarification:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Clarification answer is required before resume.",
        )
    pending_research_review = checkpoint_meta.get("pending_research_review") if isinstance(checkpoint_meta.get("pending_research_review"), dict) else None
    if pending_research_review:
        return {"simulation_id": simulation_id, "status": "paused", "resumed": False, "resume_from_phase": "search_bootstrap"}
    resume_from_phase = (
        str((checkpoint_row or {}).get("current_phase_key") or "").strip()
        or str(checkpoint_meta.get("current_phase_key") or checkpoint_meta.get("phase_label") or "").strip()
        or None
    )

    if _task_is_running(simulation_id):
        return {"simulation_id": simulation_id, "status": "running", "resumed": False, "resume_from_phase": resume_from_phase}

    snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")

    current_status = str(snapshot.get("status") or "").lower()
    if current_status == "completed":
        return {"simulation_id": simulation_id, "status": "completed", "resumed": False, "resume_from_phase": resume_from_phase}
    owner_id = await db_core.get_simulation_owner(simulation_id)
    if owner_id is not None:
        settlement = await auth_core.settle_simulation_outstanding(owner_id, simulation_id)
        if not settlement.get("ok", True):
            shortfall = float(settlement.get("outstanding_credits") or 0.0)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=_billing_exhausted_message(shortfall),
            )

    if not isinstance(checkpoint, dict) or not checkpoint:
        metrics = snapshot.get("metrics") or {}
        checkpoint = {
            "version": 1,
            "agents": snapshot.get("agents") or [],
            "metrics_counts": {
                "accept": int(metrics.get("accepted") or 0),
                "reject": int(metrics.get("rejected") or 0),
                "neutral": int(metrics.get("neutral") or 0),
            },
            "metrics_breakdown": {},
            "recent_messages": [step.get("message", "") for step in (snapshot.get("reasoning") or [])[-120:]],
            "dialogue_history": [],
            "used_openers": [],
            "meta": {
                "status": "running",
                "status_reason": "running",
                "last_error": None,
                "next_iteration": int(metrics.get("iteration") or 1),
                "current_iteration": 0,
                "phase_label": None,
                "current_phase_key": "evidence_map",
                "phase_progress_pct": 0.0,
                "event_seq": int((snapshot.get("event_seq") or 0)),
                "next_task_index": 0,
                "current_tasks": [],
            },
        }

    meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
    checkpoint_status_reason = str((checkpoint_row or {}).get("status_reason") or meta.get("status_reason") or "").strip().lower()
    user_context = await _fetch_simulation_context(simulation_id)
    if checkpoint_status_reason == "paused_research_review":
        return {"simulation_id": simulation_id, "status": "paused", "resumed": False, "resume_from_phase": "search_bootstrap"}

    meta["status"] = "running"
    meta["status_reason"] = "running"
    meta["last_error"] = None
    checkpoint["meta"] = meta

    await db_core.update_simulation(simulation_id=simulation_id, status="running")
    await db_core.upsert_simulation_checkpoint(
        simulation_id=simulation_id,
        checkpoint=checkpoint,
        status="running",
        last_error=None,
        status_reason="running",
        current_phase_key=str(meta.get("current_phase_key") or "") or None,
        phase_progress_pct=float(meta.get("phase_progress_pct") or 0.0) if meta.get("phase_progress_pct") is not None else None,
        event_seq=int(meta.get("event_seq") or 0) if meta.get("event_seq") is not None else None,
    )

    if simulation_id not in _simulation_state:
        _apply_snapshot_to_state(simulation_id, snapshot, user_id=owner_id)
    state = _simulation_state.setdefault(simulation_id, {})
    state["can_resume"] = False
    state["resume_reason"] = None
    state["error"] = None
    state["status_reason"] = "running"

    await _start_background_simulation(
        simulation_id=simulation_id,
        user_context=user_context,
        user_id=owner_id,
        resume_checkpoint=checkpoint,
    )
    if owner_id is not None:
        await auth_core.log_audit(
            owner_id,
            "simulation.resumed",
            {"simulation_id": simulation_id, "resume_from_phase": resume_from_phase},
        )
    return {"simulation_id": simulation_id, "status": "running", "resumed": True, "resume_from_phase": resume_from_phase}


@router.post("/pause")
async def pause_simulation(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")

    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        await _ensure_simulation_access(simulation_id, user)

    if not _task_is_running(simulation_id):
        snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
        if not snapshot:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
        return {"simulation_id": simulation_id, "status": str(snapshot.get("status") or "paused"), "paused": False}

    reason = str(payload.get("reason") or "Paused by user").strip()
    _simulation_pause_reasons[simulation_id] = reason
    state = _simulation_state.setdefault(simulation_id, {})
    state["can_resume"] = True
    state["resume_reason"] = reason
    state["error"] = None
    state["status_reason"] = "paused_manual"
    task = _simulation_tasks.get(simulation_id)
    if task and not task.done():
        task.cancel()
    return {"simulation_id": simulation_id, "status": "paused", "paused": True}


@router.post("/research/action")
async def submit_research_action(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    cycle_id = str(payload.get("cycle_id") or "").strip()
    action = str(payload.get("action") or "").strip().lower()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")
    if not cycle_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="cycle_id is required")
    if action not in {"scrape_selected", "continue_search", "cancel_review"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="action must be scrape_selected|continue_search|cancel_review",
        )

    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        await _ensure_simulation_access(simulation_id, user)

    if _task_is_running(simulation_id):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Simulation is already running")

    snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")

    checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
    checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
    meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
    status_reason = str((checkpoint_row or {}).get("status_reason") or meta.get("status_reason") or "").strip().lower()
    pending = meta.get("pending_research_review") if isinstance(meta.get("pending_research_review"), dict) else None
    if status_reason != "paused_research_review" or not pending:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No pending research review to handle")

    pending_cycle_id = str(pending.get("cycle_id") or "").strip()
    if pending_cycle_id and pending_cycle_id != cycle_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="cycle_id does not match pending review")

    selected_url_ids = payload.get("selected_url_ids") if isinstance(payload.get("selected_url_ids"), list) else []
    selected_url_ids = [str(item).strip() for item in selected_url_ids if str(item or "").strip()]
    added_urls = payload.get("added_urls") if isinstance(payload.get("added_urls"), list) else []
    normalized_added_urls: List[str] = []
    for raw in added_urls:
        url = str(raw or "").strip()
        if not url:
            continue
        try:
            parsed = urlparse(url)
        except Exception:
            continue
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            continue
        normalized_added_urls.append(url)
    query_refinement = str(payload.get("query_refinement") or "").strip()

    if action == "cancel_review":
        reason = (
            str(payload.get("reason") or "").strip()
            or ("Research review is still pending user confirmation.")
        )
        state = _simulation_state.setdefault(simulation_id, {})
        state["status_reason"] = "paused_research_review"
        state["can_resume"] = False
        state["resume_reason"] = reason
        state["pending_research_review"] = pending
        meta["status"] = "paused"
        meta["status_reason"] = "paused_research_review"
        meta["last_error"] = reason
        checkpoint["meta"] = meta
        await db_core.update_simulation(simulation_id=simulation_id, status="paused")
        await db_core.upsert_simulation_checkpoint(
            simulation_id=simulation_id,
            checkpoint=checkpoint,
            status="paused",
            last_error=reason,
            status_reason="paused_research_review",
            current_phase_key="search_bootstrap",
            phase_progress_pct=100.0,
            event_seq=int(meta.get("event_seq") or 0),
        )
        return {"ok": True, "simulation_id": simulation_id, "status": "paused", "status_reason": "paused_research_review"}

    if action == "scrape_selected" and not selected_url_ids:
        candidate_urls = pending.get("candidate_urls") if isinstance(pending.get("candidate_urls"), list) else []
        selected_url_ids = [str(item.get("id") or "").strip() for item in candidate_urls[:2] if isinstance(item, dict)]
        selected_url_ids = [item for item in selected_url_ids if item]

    research_loop_state = {
        "mode": action,
        "cycle_id": cycle_id,
        "selected_url_ids": selected_url_ids,
        "added_urls": normalized_added_urls[:8],
        "query_refinement": query_refinement,
    }

    meta["research_loop_state"] = research_loop_state
    meta["pending_research_review"] = pending
    meta["status"] = "running"
    meta["status_reason"] = "running"
    meta["last_error"] = None
    meta["current_phase_key"] = "search_bootstrap"
    meta["phase_progress_pct"] = 0.0
    checkpoint["meta"] = meta
    await db_core.update_simulation(simulation_id=simulation_id, status="running")
    await db_core.upsert_simulation_checkpoint(
        simulation_id=simulation_id,
        checkpoint=checkpoint,
        status="running",
        last_error=None,
        status_reason="running",
        current_phase_key="search_bootstrap",
        phase_progress_pct=0.0,
        event_seq=int(meta.get("event_seq") or 0),
    )

    owner_id = await db_core.get_simulation_owner(simulation_id)
    if simulation_id not in _simulation_state:
        _apply_snapshot_to_state(simulation_id, snapshot, user_id=owner_id)
    state = _simulation_state.setdefault(simulation_id, {})
    state["status_reason"] = "running"
    state["can_resume"] = False
    state["resume_reason"] = None
    state["pending_research_review"] = None
    state["error"] = None
    state["current_phase_key"] = "search_bootstrap"
    state["phase_progress_pct"] = 0.0

    user_context = await _fetch_simulation_context(simulation_id)
    await _start_background_simulation(
        simulation_id=simulation_id,
        user_context=user_context,
        user_id=owner_id,
        resume_checkpoint=checkpoint,
    )
    if owner_id is not None:
        await auth_core.log_audit(
            owner_id,
            "simulation.research_action",
            {
                "simulation_id": simulation_id,
                "cycle_id": cycle_id,
                "action": action,
            },
        )
    return {"ok": True, "simulation_id": simulation_id, "status": "running", "status_reason": "running"}


@router.post("/clarification/answer")
async def submit_clarification_answer(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    question_id = str(payload.get("question_id") or "").strip()
    selected_option_id = str(payload.get("selected_option_id") or "").strip()
    custom_text = str(payload.get("custom_text") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")
    if not question_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="question_id is required")
    if not selected_option_id and not custom_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="selected_option_id or custom_text is required",
        )

    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        await _ensure_simulation_access(simulation_id, user)

    if _task_is_running(simulation_id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Simulation is already running",
        )

    snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")

    checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
    checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
    meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
    pending = meta.get("pending_clarification") if isinstance(meta.get("pending_clarification"), dict) else None
    if not pending:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No pending clarification to answer",
        )
    if str(pending.get("question_id") or "").strip() != question_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Clarification question no longer matches")
    status_reason = str((checkpoint_row or {}).get("status_reason") or meta.get("status_reason") or "").strip().lower()
    if status_reason != "paused_clarification_needed":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Simulation is not paused for clarification")

    options = pending.get("options") if isinstance(pending.get("options"), list) else []
    selected_label: Optional[str] = None
    if not custom_text:
        for item in options:
            if not isinstance(item, dict):
                continue
            option_id = str(item.get("id") or item.get("option_id") or "").strip()
            option_label = str(item.get("label") or item.get("text") or item.get("value") or "").strip()
            if selected_option_id and option_id == selected_option_id:
                selected_label = option_label or option_id
                break
            if selected_option_id and option_label and option_label == selected_option_id:
                selected_label = option_label
                break
        if not selected_label:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="selected_option_id is invalid")

    answer_source = "custom" if custom_text else "option"
    applied_answer = custom_text or selected_label or ""
    if not applied_answer:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Clarification answer is empty")

    await _persist_chat_event(
        simulation_id=simulation_id,
        role="user",
        content=applied_answer,
        meta={
            "kind": "clarification_answer",
            "question_id": question_id,
            "answer_source": answer_source,
            "selected_option_id": selected_option_id or None,
            "custom_text": custom_text or None,
        },
        broadcast=True,
    )

    resolution_event = {
        "event_seq": _next_event_seq(simulation_id),
        "question_id": question_id,
        "answer_source": answer_source,
    }
    await manager.broadcast_json({"type": "clarification_resolved", "simulation_id": simulation_id, **resolution_event})
    _store_event(simulation_id, "clarification_resolved", resolution_event)

    user_context = await _fetch_simulation_context(simulation_id)
    clarification_history = user_context.get("clarification_history") if isinstance(user_context.get("clarification_history"), list) else []
    clarification_history.append(
        {
            "question_id": question_id,
            "question": pending.get("question"),
            "reason_tag": pending.get("reason_tag"),
            "reason_summary": pending.get("reason_summary"),
            "answer": applied_answer,
            "answer_source": answer_source,
            "answered_at": int(datetime.utcnow().timestamp() * 1000),
        }
    )
    user_context["clarification_history"] = clarification_history[-40:]
    user_context["latest_clarification"] = applied_answer
    await db_core.update_simulation_context(simulation_id, user_context)
    try:
        save_context(simulation_id, user_context)
    except Exception:
        pass

    meta.pop("pending_clarification", None)
    meta["status"] = "running"
    meta["status_reason"] = "running"
    meta["last_error"] = None
    meta["event_seq"] = max(int(meta.get("event_seq") or 0), int(resolution_event["event_seq"]))
    checkpoint["meta"] = meta
    current_phase = str((checkpoint_row or {}).get("current_phase_key") or meta.get("current_phase_key") or "").strip() or None
    phase_progress = (checkpoint_row or {}).get("phase_progress_pct")

    await db_core.update_simulation(simulation_id=simulation_id, status="running")
    await db_core.upsert_simulation_checkpoint(
        simulation_id=simulation_id,
        checkpoint=checkpoint,
        status="running",
        last_error=None,
        status_reason="running",
        current_phase_key=current_phase,
        phase_progress_pct=float(phase_progress) if phase_progress is not None else None,
        event_seq=int(meta.get("event_seq") or 0),
    )

    owner_id = await db_core.get_simulation_owner(simulation_id)
    if simulation_id not in _simulation_state:
        _apply_snapshot_to_state(simulation_id, snapshot, user_id=owner_id)
    state = _simulation_state.setdefault(simulation_id, {})
    state["pending_clarification"] = None
    state["can_answer_clarification"] = False
    state["can_resume"] = False
    state["resume_reason"] = None
    state["error"] = None
    state["status_reason"] = "running"

    await _start_background_simulation(
        simulation_id=simulation_id,
        user_context=user_context,
        user_id=owner_id,
        resume_checkpoint=checkpoint,
    )
    if owner_id is not None:
        await auth_core.log_audit(
            owner_id,
            "simulation.clarification_answered",
            {
                "simulation_id": simulation_id,
                "question_id": question_id,
                "answer_source": answer_source,
            },
        )
    return {
        "ok": True,
        "simulation_id": simulation_id,
        "resumed": True,
        "applied_answer": applied_answer,
        "answer_source": answer_source,
    }


@router.post("/chat/event")
async def append_chat_event(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")
    role = str(payload.get("role") or "").strip().lower()
    if role not in {"user", "system", "research", "status"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="role must be one of user|system|research|status")
    content = str(payload.get("content") or "").strip()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="content is required")
    meta = payload.get("meta")
    if not isinstance(meta, dict):
        meta = {}
    message_id = str(payload.get("message_id") or "").strip() or str(uuid.uuid4())

    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        await _ensure_simulation_access(simulation_id, user)

    snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")

    if simulation_id not in _simulation_state:
        owner_id = await db_core.get_simulation_owner(simulation_id)
        _apply_snapshot_to_state(simulation_id, snapshot, user_id=owner_id)

    event_data = await _persist_chat_event(
        simulation_id=simulation_id,
        role=role,
        content=content,
        meta=meta,
        message_id=message_id,
        broadcast=True,
    )
    return {"ok": True, "event_seq": int(event_data["event_seq"]), "message_id": str(event_data["message_id"])}


@router.post("/context")
async def update_simulation_context(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")
    updates = payload.get("updates")
    if not isinstance(updates, dict) or not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="updates object is required")

    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        await _ensure_simulation_access(simulation_id, user)

    current = await _fetch_simulation_context(simulation_id)
    if not current:
        snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
        if not snapshot:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
        current = {}
    merged = dict(current)
    merged.update(updates)
    await db_core.update_simulation_context(simulation_id, merged)
    try:
        save_context(simulation_id, merged)
    except Exception:
        pass
    owner_id = await db_core.get_simulation_owner(simulation_id)
    if owner_id is not None:
        await auth_core.log_audit(
            owner_id,
            "simulation.context_updated",
            {"simulation_id": simulation_id, "keys": sorted(list(updates.keys()))[:20]},
        )
    return {"simulation_id": simulation_id, "updated": True, "user_context": merged}


@router.post("/post-action")
async def run_post_action(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    action = str(payload.get("action") or "").strip().lower()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")
    if action not in {"make_acceptable", "bring_to_world"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="action must be make_acceptable or bring_to_world",
        )

    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:view"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        await _ensure_simulation_access(simulation_id, user)

    snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
    if not snapshot:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
    if str(snapshot.get("status") or "").lower() != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Post actions are available after simulation completion only",
        )

    user_context = await _fetch_simulation_context(simulation_id)
    idea = str(user_context.get("idea") or "").strip() or "Untitled idea"
    summary = str(snapshot.get("summary") or "").strip()
    metrics = snapshot.get("metrics") if isinstance(snapshot.get("metrics"), dict) else {}
    acceptance_rate = float(metrics.get("acceptance_rate") or 0.0)
    reasoning = snapshot.get("reasoning") if isinstance(snapshot.get("reasoning"), list) else []
    reject_messages = [
        str(step.get("message") or "").strip()
        for step in reasoning
        if isinstance(step, dict) and str(step.get("opinion") or "").lower() == "reject"
    ][:8]
    reject_block = "\n".join([f"- {item}" for item in reject_messages if item]) or "-"

    def _fallback_response() -> Dict[str, Any]:
        if action == "make_acceptable":
            revised_idea = f"{idea} (privacy-preserving and human-reviewed version)"
            return {
                "action": action,
                "title": "Make your idea acceptable",
                "summary": "Reframe the concept to remove high-risk elements and improve compliance fit.",
                "steps": [
                    "Remove intrusive data collection and require explicit consent.",
                    "Replace fully automated blocking with auditable human review.",
                    "Limit scope to a narrow pilot and publish clear appeal criteria.",
                ],
                "risks": [
                    "Regulatory non-compliance if data minimization is not enforced.",
                    "Perceived unfairness if explanation and appeal are weak.",
                ],
                "kpis": [
                    "Appeal resolution SLA",
                    "False-positive rejection rate",
                    "Consent completion rate",
                ],
                "revised_idea": revised_idea,
                "compliance_fixes": [
                    "Data minimization policy",
                    "Explicit consent workflow",
                    "Human-in-the-loop decision gate",
                ],
                "blocking_reasons": [
                    "privacy_surveillance",
                    "legal_compliance",
                    "ethical_discrimination",
                ],
                "followup_seed": {
                    "idea": revised_idea,
                    "parent_simulation_id": simulation_id,
                    "followup_mode": "make_acceptable",
                },
            }
        return {
            "action": action,
            "title": "Bring your idea to world",
            "summary": "Turn the validated part of the idea into a staged launch plan.",
            "steps": [
                "Define MVP scope with one primary user journey.",
                "Run a 30-day pilot with a measurable success threshold.",
                "Package findings into a repeatable go-to-market playbook.",
            ],
            "risks": [
                "Overbuilding before demand proof",
                "Weak onboarding causing low retention",
            ],
            "kpis": [
                "Pilot activation rate",
                "Week-4 retention",
                "Cost per qualified lead",
            ],
            "mvp_scope": [
                "Single core workflow",
                "Basic analytics + audit logs",
                "Manual override controls",
            ],
            "go_to_market": [
                "Narrow ICP first",
                "Outcome-focused messaging",
                "Design-partner references",
            ],
            "30_day_plan": [
                "Week 1: instrument baseline and onboarding",
                "Week 2: run pilot and collect objections",
                "Week 3: ship fixes and re-test",
                "Week 4: finalize pricing and rollout checklist",
            ],
            "followup_seed": {
                "idea": idea,
                "parent_simulation_id": simulation_id,
                "followup_mode": "bring_to_world",
            },
        }

    prompt = (
        "You are generating a post-simulation action plan.\n"
        "Return JSON only.\n"
        f"Action: {action}\n"
        f"Idea: {idea}\n"
        f"Acceptance rate: {acceptance_rate:.3f}\n"
        f"Summary: {summary}\n"
        f"Top reject evidence:\n{reject_block}\n"
        "For both actions, include: title, summary, steps[], risks[], kpis[], followup_seed.\n"
        "If action=make_acceptable also include: revised_idea, compliance_fixes[], blocking_reasons[].\n"
        "If action=bring_to_world also include: mvp_scope[], go_to_market[], 30_day_plan[].\n"
    )

    response_payload = _fallback_response()
    try:
        raw = await generate_ollama(prompt=prompt, temperature=0.25, response_format="json")
        parsed = json.loads(raw)
        if isinstance(parsed, dict):
            merged = {**response_payload, **parsed}
            merged["action"] = action
            followup_seed = merged.get("followup_seed") if isinstance(merged.get("followup_seed"), dict) else {}
            followup_seed["parent_simulation_id"] = simulation_id
            followup_seed["followup_mode"] = action
            followup_seed.setdefault("idea", merged.get("revised_idea") or idea)
            merged["followup_seed"] = followup_seed
            for key in ("steps", "risks", "kpis", "compliance_fixes", "blocking_reasons", "mvp_scope", "go_to_market", "30_day_plan"):
                if key in merged and not isinstance(merged.get(key), list):
                    merged[key] = response_payload.get(key, [])
            response_payload = merged
    except Exception:
        pass

    return response_payload


@router.get("/result")
async def get_result(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    """Retrieve final aggregated metrics for a completed simulation.

    If the simulation is still running or unknown, returns an
    appropriate status message. The final metrics are taken from the
    result stored after the simulation coroutine completes.
    """
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)

    # Check if we have a stored result
    if simulation_id in _simulation_results:
        return {
            "simulation_id": simulation_id,
            "status": "completed",
            "metrics": _simulation_results[simulation_id],
        }
    # If still running
    task = _simulation_tasks.get(simulation_id)
    if task is not None and not task.done():
        return {"simulation_id": simulation_id, "status": "running"}
    snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
    if snapshot:
        status_value = str(snapshot.get("status") or "running").lower()
        metrics = snapshot.get("metrics")
        if status_value == "completed" and metrics:
            return {
                "simulation_id": simulation_id,
                "status": "completed",
                "metrics": metrics,
            }
        if status_value in {"paused", "error"}:
            return {"simulation_id": simulation_id, "status": status_value}
        if metrics:
            return {"simulation_id": simulation_id, "status": "completed", "metrics": metrics}
        return {"simulation_id": simulation_id, "status": status_value}
    # Unknown simulation
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")


@router.get("/state")
async def get_state(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    """Retrieve latest simulation state for polling clients."""
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    state = _simulation_state.get(simulation_id)
    snapshot: Optional[Dict[str, Any]] = None
    if state is None:
        snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
        if snapshot is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
        owner_id = await db_core.get_simulation_owner(simulation_id)
        state = _apply_snapshot_to_state(simulation_id, snapshot, user_id=owner_id)
    if snapshot is None:
        snapshot = await db_core.fetch_simulation_snapshot(simulation_id)

    if _task_is_running(simulation_id):
        status_value = "running"
        status_reason = "running"
        state["can_resume"] = False
        state["resume_reason"] = None
        state["error"] = None
        state["can_answer_clarification"] = False
    else:
        persisted_status = str((snapshot or {}).get("status") or "").lower()
        persisted_reason = str((snapshot or {}).get("status_reason") or "").strip().lower()
        has_progress = _state_has_progress(state)
        if not has_progress and snapshot:
            snap_metrics = snapshot.get("metrics") or {}
            try:
                snap_iteration = int(snap_metrics.get("iteration") or 0)
            except Exception:
                snap_iteration = 0
            has_progress = snap_iteration > 0 or bool(snapshot.get("reasoning"))
        if simulation_id in _simulation_results:
            persisted_status = "completed"
        if state.get("error"):
            status_value = "error"
            status_reason = "error"
            state["can_resume"] = True
            state["resume_reason"] = state.get("error")
        elif persisted_status == "completed":
            status_value = "completed"
            status_reason = "completed"
            state["can_resume"] = False
            state["resume_reason"] = None
        elif persisted_status == "error":
            status_value = "error"
            status_reason = "error"
            state["can_resume"] = True
            state["resume_reason"] = (snapshot or {}).get("resume_reason") or state.get("resume_reason")
        elif persisted_status == "paused":
            status_value = "paused"
            status_reason = persisted_reason if persisted_reason in _PAUSE_STATUS_REASONS else "paused_manual"
            state["can_resume"] = status_reason not in {"paused_clarification_needed", "paused_research_review"}
            state["resume_reason"] = (snapshot or {}).get("resume_reason") or state.get("error") or state.get("resume_reason")
            state["can_answer_clarification"] = bool(status_reason == "paused_clarification_needed")
        elif persisted_status == "running":
            if has_progress:
                # Running in DB without an active task after progress => resumable interruption.
                status_value = "paused"
                status_reason = "interrupted"
                state["can_resume"] = True
                state["resume_reason"] = state.get("resume_reason") or "Simulation interrupted. Resume to continue."
            else:
                status_value = "running"
                status_reason = "running"
                state["can_resume"] = False
                state["resume_reason"] = None
        else:
            if has_progress:
                status_value = "paused"
                status_reason = "interrupted"
                state["can_resume"] = True
                state["resume_reason"] = state.get("resume_reason") or "Simulation interrupted. Resume to continue."
            else:
                status_value = "completed"
                status_reason = "completed"
                state["can_resume"] = False
                state["resume_reason"] = None

    if snapshot:
        # Keep state hydrated from persistent snapshot when in-memory fields are empty.
        if not state.get("agents"):
            state["agents"] = snapshot.get("agents") or []
        if not state.get("reasoning"):
            state["reasoning"] = snapshot.get("reasoning") or []
        if not state.get("chat_events"):
            state["chat_events"] = snapshot.get("chat_events") or []
        if not state.get("metrics"):
            state["metrics"] = snapshot.get("metrics")
        if not state.get("research_sources"):
            state["research_sources"] = snapshot.get("research_sources") or []
        if not state.get("policy_mode"):
            state["policy_mode"] = snapshot.get("policy_mode") or "normal"
        if state.get("policy_reason") is None:
            state["policy_reason"] = snapshot.get("policy_reason")
        if not state.get("search_quality") and isinstance(snapshot.get("search_quality"), dict):
            state["search_quality"] = snapshot.get("search_quality")
        if snapshot.get("neutral_cap_pct") is not None:
            try:
                state["neutral_cap_pct"] = float(snapshot.get("neutral_cap_pct"))
            except Exception:
                pass
        if snapshot.get("neutral_enforcement"):
            state["neutral_enforcement"] = str(snapshot.get("neutral_enforcement"))
        if snapshot.get("clarification_count") is not None:
            try:
                state["clarification_count"] = max(
                    int(state.get("clarification_count") or 0),
                    int(snapshot.get("clarification_count") or 0),
                )
            except Exception:
                pass
        if state.get("pending_clarification") is None and isinstance(snapshot.get("pending_clarification"), dict):
            state["pending_clarification"] = snapshot.get("pending_clarification")
        if state.get("pending_research_review") is None and isinstance(snapshot.get("pending_research_review"), dict):
            state["pending_research_review"] = snapshot.get("pending_research_review")
        if snapshot.get("can_answer_clarification") is not None:
            state["can_answer_clarification"] = bool(snapshot.get("can_answer_clarification"))
        if not state.get("current_phase_key"):
            state["current_phase_key"] = snapshot.get("current_phase_key")
        if snapshot.get("phase_progress_pct") is not None:
            try:
                state["phase_progress_pct"] = float(snapshot.get("phase_progress_pct"))
            except Exception:
                pass
        if snapshot.get("event_seq") is not None:
            try:
                state["event_seq"] = max(int(state.get("event_seq") or 0), int(snapshot.get("event_seq") or 0))
            except Exception:
                pass
        if not state.get("summary") and snapshot.get("summary"):
            state["summary"] = snapshot.get("summary")
            state["summary_ready"] = bool(snapshot.get("summary_ready"))
            state["summary_at"] = snapshot.get("summary_at")

    state["status_reason"] = status_reason
    state["pause_available"] = bool(status_value == "running" and _task_is_running(simulation_id))
    if status_reason != "paused_clarification_needed":
        state["can_answer_clarification"] = False
    public_state = {k: v for k, v in state.items() if k != "user_id"}
    return {"simulation_id": simulation_id, "status": status_value, "status_reason": status_reason, **public_state}


@router.get("/transcript")
async def get_transcript(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    """Return the ordered transcript grouped by phase."""
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    transcript = await db_core.fetch_transcript(simulation_id)
    if not transcript:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")
    phase_labels = {
        "Information Shock": "ط·آ§ط¸â€‍ط·ع¾ط·آµط·آ§ط·آ¯ط¸â€¦ ط·آ§ط¸â€‍ط¸â€¦ط·آ¹ط·آ±ط¸ظ¾ط¸ظ¹ (Information Shock)",
        "Polarization Phase": "ط·آ§ط¸â€‍ط·آ§ط·آ³ط·ع¾ط¸â€ڑط·آ·ط·آ§ط·آ¨ (Polarization Phase)",
        "Clash of Values": "ط¸â€¦ط·آ­ط·آ§ط¸ث†ط¸â€‍ط·آ§ط·ع¾ ط·آ§ط¸â€‍ط·آ¥ط¸â€ڑط¸â€ ط·آ§ط·آ¹ ط¸ث†ط·آ§ط¸â€‍ط·آ¬ط¸â€¦ط¸ث†ط·آ¯ (Clash of Values)",
        "Resolution Pressure": "ط·آ§ط¸â€‍ط¸â€ ط·ع¾ط¸ظ¹ط·آ¬ط·آ© ط·آ§ط¸â€‍ط¸â€ ط¸â€،ط·آ§ط·آ¦ط¸ظ¹ط·آ© (Resolution Pressure)",
    }
    for group in transcript:
        label = phase_labels.get(group.get("phase"))
        if label:
            group["phase"] = label
    return {"simulation_id": simulation_id, "phases": transcript}


@router.get("/agents")
async def get_agents(
    simulation_id: str,
    stance: Optional[str] = None,
    phase: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    normalized_stance = str(stance or "").strip().lower()
    if normalized_stance in {"accepted", "accept"}:
        normalized_stance = "accept"
    elif normalized_stance in {"rejected", "reject"}:
        normalized_stance = "reject"
    elif normalized_stance in {"neutral"}:
        normalized_stance = "neutral"
    else:
        normalized_stance = None
    payload = await db_core.fetch_simulation_agents_filtered(
        simulation_id=simulation_id,
        stance=normalized_stance,
        phase=str(phase or "").strip() or None,
        page=page,
        page_size=page_size,
    )
    return {"simulation_id": simulation_id, **payload}


@router.get("/research/sources")
async def get_research_sources(
    simulation_id: str,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    items = await db_core.fetch_research_events(simulation_id)
    return {"simulation_id": simulation_id, "items": items}


@router.get("/list")
async def list_simulations(
    limit: int = 25,
    offset: int = 0,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    if not auth_core.has_permission(user, "simulation:view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    is_admin = str(user.get("role") or "").lower() == "admin"
    rows = await db_core.fetch_simulations(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        limit=min(max(limit, 1), 100),
        offset=max(offset, 0),
        include_all=is_admin,
    )
    total = await db_core.count_simulations(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        include_all=is_admin,
    )
    items: List[Dict[str, Any]] = []
    for row in rows:
        simulation_id = row.get("simulation_id")
        context = row.get("user_context") or {}
        if isinstance(context, str):
            try:
                import json
                context = json.loads(context)
            except Exception:
                context = {}
        metrics = row.get("final_metrics") or {}
        if isinstance(metrics, str):
            try:
                import json
                metrics = json.loads(metrics)
            except Exception:
                metrics = {}
        checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
        checkpoint_status = str((checkpoint_row or {}).get("status") or "").lower()
        checkpoint_status_reason = str((checkpoint_row or {}).get("status_reason") or "").lower()
        checkpoint_reason = (checkpoint_row or {}).get("last_error")
        row_status = str(row.get("status") or "running").lower()
        if _task_is_running(str(simulation_id)):
            effective_status = "running"
            effective_status_reason = "running"
            can_resume = False
            resume_reason = None
        else:
            if row_status == "running":
                if checkpoint_status in {"completed", "error", "paused"}:
                    effective_status = checkpoint_status
                else:
                    effective_status = "paused"
            elif row_status in {"completed", "error", "paused"}:
                effective_status = row_status
            else:
                effective_status = row_status
            can_resume = effective_status in {"error", "paused"}
            resume_reason = checkpoint_reason if can_resume else None
            if effective_status == "paused":
                effective_status_reason = checkpoint_status_reason if checkpoint_status_reason in _PAUSE_STATUS_REASONS else "paused_manual"
                can_resume = effective_status_reason not in {"paused_clarification_needed", "paused_research_review"}
            elif effective_status == "error":
                effective_status_reason = "error"
            elif effective_status == "completed":
                effective_status_reason = "completed"
            else:
                effective_status_reason = "running"
        items.append(
            {
                "simulation_id": simulation_id,
                "status": effective_status,
                "status_reason": effective_status_reason,
                "idea": context.get("idea") or "",
                "category": context.get("category") or "",
                "created_at": row.get("created_at"),
                "ended_at": row.get("ended_at"),
                "summary": row.get("summary") or "",
                "acceptance_rate": metrics.get("acceptance_rate"),
                "total_agents": metrics.get("total_agents"),
                "can_resume": can_resume,
                "resume_reason": resume_reason,
            }
        )
    return {"items": items, "total": total}


@router.get("/analytics")
async def simulation_analytics(
    days: int = 7,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    if not auth_core.has_permission(user, "simulation:view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    is_admin = str(user.get("role") or "").lower() == "admin"
    days = min(max(days, 1), 90)
    rows = await db_core.fetch_simulations(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        limit=500,
        offset=0,
        include_all=is_admin,
    )
    from datetime import timedelta
    import json

    today = datetime.utcnow().date()
    start_date = today - timedelta(days=days - 1)
    daily = {}
    category_counts: Dict[str, int] = {}
    total_agents = 0
    completed = 0
    acceptance_sum = 0.0

    for row in rows:
        created_at = row.get("created_at")
        if isinstance(created_at, datetime):
            created_date = created_at.date()
        else:
            created_date = None
        context = row.get("user_context") or {}
        if isinstance(context, str):
            try:
                context = json.loads(context)
            except Exception:
                context = {}
        category = (context.get("category") or "other").title()
        category_counts[category] = category_counts.get(category, 0) + 1

        metrics = row.get("final_metrics") or {}
        if isinstance(metrics, str):
            try:
                metrics = json.loads(metrics)
            except Exception:
                metrics = {}
        if row.get("status") == "completed" and metrics:
            completed += 1
            acceptance_sum += float(metrics.get("acceptance_rate") or 0.0)
            total_agents += int(metrics.get("total_agents") or 0)

        if created_date and created_date >= start_date:
            key = created_date.isoformat()
            daily.setdefault(key, {"simulations": 0, "success": 0, "agents": 0})
            daily[key]["simulations"] += 1
            if metrics:
                daily[key]["agents"] += int(metrics.get("total_agents") or 0)
                if float(metrics.get("acceptance_rate") or 0.0) >= 0.6:
                    daily[key]["success"] += 1

    weekly = []
    for i in range(days):
        d = start_date + timedelta(days=i)
        key = d.isoformat()
        entry = daily.get(key, {"simulations": 0, "success": 0, "agents": 0})
        weekly.append({"date": key, **entry})

    categories = [{"name": name, "value": value} for name, value in category_counts.items()]

    avg_acceptance = (acceptance_sum / completed) if completed > 0 else 0.0

    return {
        "totals": {
            "total_simulations": len(rows),
            "completed": completed,
            "avg_acceptance_rate": avg_acceptance,
            "total_agents": total_agents,
        },
        "weekly": weekly,
        "categories": categories,
    }


@router.get("/debug/version")
async def debug_version() -> Dict[str, Any]:
    """Return a signature of the running engine code for diagnostics."""
    engine_path = Path(__file__).resolve().parents[1] / "simulation" / "engine.py"
    try:
        content = engine_path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()[:12]
        return {"engine_sha": digest, "engine_path": str(engine_path)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read engine.py: {exc}")


