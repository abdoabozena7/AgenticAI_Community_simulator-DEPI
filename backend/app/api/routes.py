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

from fastapi import APIRouter, HTTPException, status, Header

from ..core.dataset_loader import Dataset
from ..core import auth as auth_core
from ..simulation.engine import SimulationEngine, ClarificationNeeded
from ..core.ollama_client import generate_ollama
from ..core.context_store import save_context
from ..core.web_search import search_web
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
    "paused_credits_exhausted",
    "paused_clarification_needed",
}

# Reference to the loaded dataset (set in main module at startup)
dataset: Optional[Dataset] = None


def _auth_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "false").lower() in {"1", "true", "yes"}


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
        "pending_clarification": None,
        "can_answer_clarification": False,
    }


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
            "pending_clarification": None,
            "can_answer_clarification": False,
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
    elif event_type == "clarification_request":
        state["pending_clarification"] = {
            "question_id": data.get("question_id"),
            "question": data.get("question"),
            "options": data.get("options") or [],
            "reason_tag": data.get("reason_tag"),
            "reason_summary": data.get("reason_summary"),
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
        "pending_clarification": snapshot.get("pending_clarification") if isinstance(snapshot.get("pending_clarification"), dict) else None,
        "can_answer_clarification": bool(snapshot.get("can_answer_clarification")),
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
        try:
            checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
            checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
            checkpoint_meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
            if not bool(checkpoint_meta.get("clarification_notice_sent")):
                notice_text = (
                    "تنبيه: أثناء التفكير، ممكن الوكلاء يطلبوا توضيح منك. خلي جهازك قريب."
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
            options_raw = payload.get("options")
            options: List[Dict[str, str]] = []
            if isinstance(options_raw, list):
                for idx, item in enumerate(options_raw):
                    label = ""
                    option_id = ""
                    if isinstance(item, str):
                        label = item.strip()
                    elif isinstance(item, dict):
                        label = str(item.get("label") or item.get("text") or item.get("value") or "").strip()
                        option_id = str(item.get("id") or item.get("option_id") or "").strip()
                    if not label:
                        continue
                    options.append({"id": option_id or f"opt_{idx + 1}", "label": label[:220]})
                    if len(options) >= 3:
                        break
            while len(options) < 3:
                options.append({"id": f"opt_{len(options) + 1}", "label": f"Option {len(options) + 1}"})
            question_id = str(payload.get("question_id") or uuid.uuid4().hex[:12])
            created_at = int(payload.get("created_at") or int(datetime.utcnow().timestamp() * 1000))
            clarification_data = {
                "event_seq": _next_event_seq(simulation_id),
                "question_id": question_id,
                "question": question_text or (
                    "Please clarify the key ambiguity before we continue."
                    if str(user_context.get("language") or "en").lower() != "ar"
                    else "ظ…ظ† ظپط¶ظ„ظƒ ظˆط¶ظ‘ط­ ط§ظ„ظ†ظ‚ط·ط© ط§ظ„ط£ط³ط§ط³ظٹط© ظ‚ط¨ظ„ ظ…ط§ ظ†ظƒظ…ظ„."
                ),
                "options": options,
                "reason_tag": reason_tag,
                "reason_summary": reason_summary,
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
            state["pending_clarification"] = {
                "question_id": question_id,
                "question": clarification_data["question"],
                "options": options,
                "reason_tag": reason_tag,
                "reason_summary": reason_summary,
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
                    "created_at": created_at,
                }
            )
            meta["clarification_history"] = clarification_history[-40:]
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
    _init_state(simulation_id, user_id=user_id)
    _simulation_state[simulation_id]["current_phase_key"] = "search_bootstrap"
    _simulation_state[simulation_id]["phase_progress_pct"] = 0.0
    _simulation_state[simulation_id]["event_seq"] = 0
    _simulation_state[simulation_id]["policy_mode"] = "normal"
    _simulation_state[simulation_id]["policy_reason"] = None
    _simulation_state[simulation_id]["search_quality"] = None
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
                    "last_error": None,
                    "next_iteration": 1,
                    "current_iteration": 0,
                    "phase_label": None,
                    "current_phase_key": "search_bootstrap",
                    "phase_progress_pct": 0.0,
                    "event_seq": 0,
                    "next_task_index": 0,
                    "current_tasks": [],
                },
            },
            status="running",
            last_error=None,
            status_reason="running",
            current_phase_key="search_bootstrap",
            phase_progress_pct=0.0,
            event_seq=0,
        )

    search_bootstrap = await _run_search_bootstrap(simulation_id=simulation_id, user_context=user_context)
    if not search_bootstrap.get("ok"):
        reason = str(search_bootstrap.get("reason") or "Search bootstrap failed")
        state = _simulation_state.setdefault(simulation_id, {})
        state["can_resume"] = True
        state["resume_reason"] = reason
        state["error"] = None
        state["status_reason"] = "paused_search_failed"
        state["current_phase_key"] = "search_bootstrap"
        state["phase_progress_pct"] = 100.0
        await db_core.update_simulation(simulation_id=simulation_id, status="paused")
        checkpoint_row = await db_core.fetch_simulation_checkpoint(simulation_id)
        checkpoint = (checkpoint_row or {}).get("checkpoint") or {}
        meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
        meta["status"] = "paused"
        meta["status_reason"] = "paused_search_failed"
        meta["last_error"] = reason
        meta["current_phase_key"] = "search_bootstrap"
        meta["phase_progress_pct"] = 100.0
        meta["event_seq"] = int(state.get("event_seq") or 0)
        checkpoint["meta"] = meta
        await db_core.upsert_simulation_checkpoint(
            simulation_id=simulation_id,
            checkpoint=checkpoint,
            status="paused",
            last_error=reason,
            status_reason="paused_search_failed",
            current_phase_key="search_bootstrap",
            phase_progress_pct=100.0,
            event_seq=int(state.get("event_seq") or 0),
        )
        if user_id is not None:
            await auth_core.log_audit(
                user_id,
                "simulation.search_bootstrap_failed",
                {"simulation_id": simulation_id, "reason": reason},
            )
        return {"simulation_id": simulation_id, "status": "paused", "status_reason": "paused_search_failed"}

    enriched_context = search_bootstrap.get("context") if isinstance(search_bootstrap.get("context"), dict) else dict(user_context)
    state = _simulation_state.setdefault(simulation_id, {})
    if isinstance(enriched_context.get("search_quality"), dict):
        state["search_quality"] = enriched_context.get("search_quality")
    await db_core.update_simulation_context(simulation_id, enriched_context)
    try:
        save_context(simulation_id, enriched_context)
    except Exception:
        pass
    await db_core.upsert_simulation_checkpoint(
        simulation_id=simulation_id,
        checkpoint=(await db_core.fetch_simulation_checkpoint(simulation_id) or {}).get("checkpoint") or {},
        status="running",
        last_error=None,
        status_reason="running",
        current_phase_key="evidence_map",
        phase_progress_pct=0.0,
        event_seq=int(_simulation_state.get(simulation_id, {}).get("event_seq") or 0),
    )
    await _start_background_simulation(
        simulation_id=simulation_id,
        user_context=enriched_context,
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
    if checkpoint_status_reason == "paused_search_failed":
        search_bootstrap = await _run_search_bootstrap(simulation_id=simulation_id, user_context=user_context)
        if not search_bootstrap.get("ok"):
            reason = str(search_bootstrap.get("reason") or "Search bootstrap failed")
            meta["status"] = "paused"
            meta["status_reason"] = "paused_search_failed"
            meta["last_error"] = reason
            meta["current_phase_key"] = "search_bootstrap"
            meta["phase_progress_pct"] = 100.0
            checkpoint["meta"] = meta
            await db_core.update_simulation(simulation_id=simulation_id, status="paused")
            await db_core.upsert_simulation_checkpoint(
                simulation_id=simulation_id,
                checkpoint=checkpoint,
                status="paused",
                last_error=reason,
                status_reason="paused_search_failed",
                current_phase_key="search_bootstrap",
                phase_progress_pct=100.0,
                event_seq=int(meta.get("event_seq") or 0),
            )
            return {"simulation_id": simulation_id, "status": "paused", "resumed": False, "resume_from_phase": "search_bootstrap"}
        enriched_context = search_bootstrap.get("context") if isinstance(search_bootstrap.get("context"), dict) else user_context
        user_context = enriched_context
        await db_core.update_simulation_context(simulation_id, enriched_context)
        try:
            save_context(simulation_id, enriched_context)
        except Exception:
            pass
        meta["current_phase_key"] = "evidence_map"
        meta["phase_progress_pct"] = 0.0

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
            state["can_resume"] = status_reason != "paused_clarification_needed"
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
        if state.get("pending_clarification") is None and isinstance(snapshot.get("pending_clarification"), dict):
            state["pending_clarification"] = snapshot.get("pending_clarification")
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
        "Information Shock": "ط§ظ„طھطµط§ط¯ظ… ط§ظ„ظ…ط¹ط±ظپظٹ (Information Shock)",
        "Polarization Phase": "ط§ظ„ط§ط³طھظ‚ط·ط§ط¨ (Polarization Phase)",
        "Clash of Values": "ظ…ط­ط§ظˆظ„ط§طھ ط§ظ„ط¥ظ‚ظ†ط§ط¹ ظˆط§ظ„ط¬ظ…ظˆط¯ (Clash of Values)",
        "Resolution Pressure": "ط§ظ„ظ†طھظٹط¬ط© ط§ظ„ظ†ظ‡ط§ط¦ظٹط© (Resolution Pressure)",
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

