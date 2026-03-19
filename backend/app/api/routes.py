from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Query, status

from ..core import auth as auth_core
from ..core.web_search import search_web
from ..core.dataset_loader import Dataset
from ..core import db as db_core
from ..models.orchestration import normalize_context
from ..orchestrator import SimulationOrchestrator
from ..simulation.preflight import (
    analyze_understanding,
    preflight_finalize,
    preflight_next,
    submit_understanding,
)
from .websocket import manager


router = APIRouter(prefix="/simulation")
society_router = APIRouter(prefix="/society")

_orchestrator: Optional[SimulationOrchestrator] = None
_dataset: Optional[Dataset] = None


def configure_orchestrator(dataset: Dataset) -> None:
    global _orchestrator, _dataset
    _dataset = dataset
    _orchestrator = SimulationOrchestrator(dataset=dataset, broadcaster=manager.broadcast_json)


def _get_orchestrator() -> SimulationOrchestrator:
    if _orchestrator is None:
        raise HTTPException(status_code=503, detail="Orchestrator is not initialized")
    return _orchestrator


def _auth_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "false").lower() in {"1", "true", "yes"}


async def _resolve_user(authorization: Optional[str], require: bool = False) -> Optional[Dict[str, Any]]:
    if not authorization or not authorization.lower().startswith("bearer "):
        if require:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
        return None
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user and require:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return user


async def _ensure_simulation_access(simulation_id: str, user: Dict[str, Any]) -> None:
    if str(user.get("role") or "").lower() == "admin":
        return
    owner_id = await db_core.get_simulation_owner(simulation_id)
    if owner_id is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    if int(owner_id) != int(user.get("id") or 0):
        raise HTTPException(status_code=403, detail="Not authorized")


def _get_dataset() -> Dataset:
    if _dataset is None:
        raise HTTPException(status_code=503, detail="Dataset is not initialized")
    return _dataset


def _normalize_language(value: Any) -> str:
    return "ar" if str(value or "en").strip().lower().startswith("ar") else "en"


def _build_prestart_research_query(payload: Dict[str, Any]) -> str:
    idea = str(payload.get("idea") or "").strip()
    category = str(payload.get("category") or "").strip()
    city = str(payload.get("city") or "").strip()
    country = str(payload.get("country") or "").strip()
    location = ", ".join(part for part in [city, country] if part)
    extras = "market demand competition pricing regulation"
    return " ".join(part for part in [idea, category, location, extras] if part).strip()


def _extract_prestart_highlights(results: Any, limit: int = 4) -> list[str]:
    highlights: list[str] = []
    if not isinstance(results, list):
        return highlights
    for item in results:
        if not isinstance(item, dict):
            continue
        text = str(item.get("snippet") or item.get("title") or "").strip()
        if not text:
            continue
        highlights.append(text[:220])
        if len(highlights) >= limit:
            break
    return highlights


@router.post("/start")
async def start_simulation(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    context = normalize_context(payload)
    if not context.get("idea"):
        raise HTTPException(status_code=400, detail="idea is required")
    orchestrator = _get_orchestrator()
    state = await orchestrator.start_simulation(
        user_context=context,
        user_id=int(user.get("id")) if user else None,
    )
    return {
        "simulation_id": state.simulation_id,
        "status": state.status,
        "current_phase_key": state.current_phase.value,
    }


@router.post("/preflight/next")
async def simulation_preflight_next(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    await _resolve_user(authorization, require=auth_required)
    draft_context = payload.get("draft_context") if isinstance(payload.get("draft_context"), dict) else {}
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    answer = payload.get("answer") if isinstance(payload.get("answer"), dict) else None
    language = _normalize_language(payload.get("language"))
    max_rounds = int(payload.get("max_rounds") or 3)
    threshold = float(payload.get("threshold") or 0.78)
    return await preflight_next(
        draft_context=draft_context,
        history=history,
        answer=answer,
        language=language,
        max_rounds=max_rounds,
        threshold=threshold,
    )


@router.post("/preflight/finalize")
async def simulation_preflight_finalize(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    await _resolve_user(authorization, require=auth_required)
    normalized_context = payload.get("normalized_context") if isinstance(payload.get("normalized_context"), dict) else {}
    history = payload.get("history") if isinstance(payload.get("history"), list) else []
    language = _normalize_language(payload.get("language"))
    threshold = float(payload.get("threshold") or 0.78)
    return preflight_finalize(
        normalized_context=normalized_context,
        history=history,
        language=language,
        threshold=threshold,
    )


@router.post("/understanding/analyze")
async def simulation_understanding_analyze(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    await _resolve_user(authorization, require=auth_required)
    idea = str(payload.get("idea") or "").strip()
    if not idea:
        raise HTTPException(status_code=400, detail="idea is required")
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}
    threshold = float(payload.get("threshold") or 0.78)
    attempt_id = str(payload.get("attempt_id") or "").strip() or None
    return await analyze_understanding(
        idea=idea,
        context=context,
        threshold=threshold,
        attempt_id=attempt_id,
    )


@router.post("/understanding/submit")
async def simulation_understanding_submit(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    await _resolve_user(authorization, require=auth_required)
    draft_context = payload.get("draft_context") if isinstance(payload.get("draft_context"), dict) else {}
    answers = payload.get("answers") if isinstance(payload.get("answers"), list) else []
    language = _normalize_language(payload.get("language"))
    threshold = float(payload.get("threshold") or 0.78)
    return submit_understanding(
        draft_context=draft_context,
        answers=answers,
        language=language,
        threshold=threshold,
    )


@router.post("/research/prestart")
async def simulation_research_prestart(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    await _resolve_user(authorization, require=auth_required)
    query = _build_prestart_research_query(payload)
    language = _normalize_language(payload.get("language"))
    if not query:
        return {
            "summary": "",
            "highlights": [],
            "gaps": [],
            "confirm_start_required": True,
            "provider": "none",
            "is_live": False,
            "results": [],
            "structured": None,
        }
    result = await search_web(query=query, max_results=6, language=language, strict_web_only=True)
    structured = result.get("structured") if isinstance(result.get("structured"), dict) else {}
    summary = str(structured.get("summary") or result.get("answer") or "").strip()
    gaps = [str(item).strip() for item in (structured.get("gaps") or []) if str(item).strip()]
    highlights = [str(item).strip() for item in (structured.get("signals") or []) if str(item).strip()]
    if not highlights:
        highlights = _extract_prestart_highlights(result.get("results"), limit=4)
    return {
        "summary": summary,
        "highlights": highlights,
        "gaps": gaps,
        "confirm_start_required": True,
        "provider": str(result.get("provider") or "none"),
        "is_live": bool(result.get("is_live")),
        "results": result.get("results") if isinstance(result.get("results"), list) else [],
        "structured": structured or None,
    }


@router.post("/chat/event")
async def append_chat_event(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=400, detail="simulation_id is required")
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)

    state = await _get_orchestrator().get_state(simulation_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Simulation not found")

    role = str(payload.get("role") or "system").strip() or "system"
    content = str(payload.get("content") or "").strip()
    message_id = str(payload.get("message_id") or payload.get("messageId") or "").strip()
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    next_seq = int(state.event_seq or 0) + 1
    if not message_id:
        message_id = f"chat-{simulation_id[:8]}-{next_seq}"

    await db_core.insert_chat_event(
        simulation_id,
        event_seq=next_seq,
        message_id=message_id,
        role=role,
        content=content,
        meta=meta,
    )
    state.event_seq = next_seq
    await _get_orchestrator().repository.save_state(state)
    return {
        "ok": True,
        "simulation_id": simulation_id,
        "event_seq": next_seq,
        "message_id": message_id,
    }


@router.post("/context")
async def update_context(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    updates = payload.get("updates") if isinstance(payload.get("updates"), dict) else {}
    if not simulation_id:
        raise HTTPException(status_code=400, detail="simulation_id is required")
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    orchestrator = _get_orchestrator()
    result = await orchestrator.apply_context_update(simulation_id, updates)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    state, impact, rollback_phase = result
    return {
        "simulation_id": simulation_id,
        "change_impact": impact.value,
        "rollback_phase": rollback_phase.value,
        "user_context": state.user_context,
        "status": state.status,
    }


@router.get("/context")
async def get_context(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    state = await _get_orchestrator().get_state(simulation_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return {"simulation_id": simulation_id, "user_context": state.user_context}


@router.post("/pause")
async def pause_simulation(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=400, detail="simulation_id is required")
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    state = await _get_orchestrator().pause_simulation(simulation_id, reason=payload.get("reason"))
    if state is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return {"simulation_id": simulation_id, "status": state.status, "status_reason": state.status_reason}


@router.post("/resume")
async def resume_simulation(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=400, detail="simulation_id is required")
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    state = await _get_orchestrator().resume_simulation(simulation_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return {
        "simulation_id": simulation_id,
        "status": state.status,
        "status_reason": state.status_reason,
        "current_phase_key": state.current_phase.value,
    }


@router.post("/clarification/answer")
async def answer_clarifications(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    simulation_id = str(payload.get("simulation_id") or "").strip()
    answers = payload.get("answers") if isinstance(payload.get("answers"), list) else []
    if not answers and payload.get("question_id"):
        answer_text = str(payload.get("custom_text") or payload.get("selected_option_id") or payload.get("answer") or "").strip()
        answers = [
            {
                "question_id": str(payload.get("question_id") or "").strip(),
                "answer": answer_text,
            }
        ]
    if not simulation_id:
        raise HTTPException(status_code=400, detail="simulation_id is required")
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    state = await _get_orchestrator().answer_clarifications(simulation_id, answers)
    if state is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return {
        "simulation_id": simulation_id,
        "status": state.status,
        "status_reason": state.status_reason,
        "pending_clarification": [item.to_dict() for item in state.pending_questions()],
    }


@router.get("/state")
async def get_state(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    state = await _get_orchestrator().get_state(simulation_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    payload = state.to_public_state()
    payload["research_sources"] = await _get_orchestrator().repository.fetch_research_events(simulation_id)
    return payload


@router.get("/result")
async def get_result(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    result = await _get_orchestrator().get_result(simulation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Simulation not found")
    return result


@router.get("/transcript")
async def get_transcript(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    transcript = await _get_orchestrator().repository.fetch_transcript(simulation_id)
    if not transcript:
        raise HTTPException(status_code=404, detail="Transcript not found")
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
    payload = await _get_orchestrator().repository.fetch_agents(
        simulation_id=simulation_id,
        stance=stance,
        phase=phase,
        page=page,
        page_size=page_size,
    )
    return {"simulation_id": simulation_id, **payload}


@router.get("/research/sources")
async def get_research_sources(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    items = await _get_orchestrator().repository.fetch_research_events(simulation_id)
    return {"simulation_id": simulation_id, "items": items}


@router.get("/list")
async def list_simulations(
    limit: int = Query(25, ge=1, le=100),
    offset: int = Query(0, ge=0),
    authorization: str = Header(None),
) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if not user:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    include_all = str(user.get("role") or "").lower() == "admin"
    repository = _get_orchestrator().repository
    items = await repository.list_runs(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        include_all=include_all,
        limit=limit,
        offset=offset,
    )
    total = await repository.count_runs(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        include_all=include_all,
    )
    return {"items": items, "total": total}


@router.get("/analytics")
async def simulation_analytics(days: int = Query(7, ge=1, le=90), authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if not user:
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    include_all = str(user.get("role") or "").lower() == "admin"
    repository = _get_orchestrator().repository
    rows = await repository.list_runs(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        include_all=include_all,
        limit=500,
        offset=0,
    )
    today = datetime.utcnow().date()
    start_date = today - timedelta(days=days - 1)
    daily: Dict[str, Dict[str, Any]] = {}
    category_counts: Dict[str, int] = {}
    completed = 0
    total_agents = 0
    acceptance_sum = 0.0

    for row in rows:
        category = str(row.get("category") or "other").title()
        category_counts[category] = category_counts.get(category, 0) + 1
        created_at = row.get("created_at")
        created_date = created_at.date() if isinstance(created_at, datetime) else None
        if row.get("acceptance_rate") is not None:
            completed += 1
            acceptance_sum += float(row.get("acceptance_rate") or 0.0)
            total_agents += int(row.get("total_agents") or 0)
        if created_date and created_date >= start_date:
            key = created_date.isoformat()
            bucket = daily.setdefault(key, {"simulations": 0, "success": 0, "agents": 0})
            bucket["simulations"] += 1
            bucket["agents"] += int(row.get("total_agents") or 0)
            if float(row.get("acceptance_rate") or 0.0) >= 0.5:
                bucket["success"] += 1

    weekly = []
    for offset_days in range(days):
        current = start_date + timedelta(days=offset_days)
        key = current.isoformat()
        weekly.append({"date": key, **daily.get(key, {"simulations": 0, "success": 0, "agents": 0})})

    return {
        "totals": {
            "total_simulations": len(rows),
            "completed": completed,
            "avg_acceptance_rate": round(acceptance_sum / completed, 3) if completed else 0.0,
            "total_agents": total_agents,
        },
        "weekly": weekly,
        "categories": [{"name": key, "value": value} for key, value in category_counts.items()],
    }


@router.get("/debug/version")
async def debug_version() -> Dict[str, Any]:
    path = Path(__file__).resolve().parents[1] / "orchestrator.py"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()[:12]
    return {"orchestrator_sha": digest, "orchestrator_path": str(path)}


@society_router.get("/catalog")
async def society_catalog(authorization: str = Header(None)) -> Dict[str, Any]:
    auth_required = _auth_required()
    await _resolve_user(authorization, require=auth_required)
    dataset = _get_dataset()
    categories = []
    for category in dataset.categories:
        templates = dataset.templates_by_category.get(category.category_id, [])
        categories.append(
            {
                "category_id": category.category_id,
                "description": category.description,
                "template_count": len(templates),
                "sample_archetypes": [template.archetype_name for template in templates[:4]],
            }
        )
    return {
        "total_templates": len(dataset.templates),
        "categories": categories,
    }
