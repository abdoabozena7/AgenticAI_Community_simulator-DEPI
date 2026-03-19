from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Query, status

from ..core import auth as auth_core
from ..core import guided_workflow as workflow_core

router = APIRouter(prefix="/simulation/workflow")


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


@router.post("/start")
async def start_workflow(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    draft_context = payload.get("draft_context") if isinstance(payload.get("draft_context"), dict) else {}
    workflow_id = str(payload.get("workflow_id") or "").strip() or None
    language = str(payload.get("language") or draft_context.get("language") or "en")
    return await workflow_core.start_workflow(
        user_id=int(user.get("id")) if user else None,
        language=language,
        draft_context=draft_context,
        workflow_id=workflow_id,
    )


@router.get("/state")
async def get_workflow_state(
    workflow_id: Optional[str] = Query(None),
    simulation_id: Optional[str] = Query(None),
    authorization: str = Header(None),
) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    user_id = int(user.get("id")) if user else None
    state: Optional[Dict[str, Any]] = None
    if workflow_id:
        state = await workflow_core.get_workflow(workflow_id, user_id)
    elif simulation_id:
        state = await workflow_core.get_workflow_for_simulation(simulation_id, user_id)
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="workflow_id or simulation_id is required")
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/context")
async def update_context_scope(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    state = await workflow_core.update_context_scope(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
        scope=str(payload.get("scope") or ""),
        place_name=str(payload.get("place_name") or "").strip() or None,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/schema")
async def submit_schema(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    updates = payload.get("updates") if isinstance(payload.get("updates"), dict) else {}
    state = await workflow_core.submit_schema(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
        updates=updates,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/clarification")
async def answer_clarifications(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    answers = payload.get("answers") if isinstance(payload.get("answers"), list) else []
    state = await workflow_core.answer_clarifications(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
        answers=answers,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/approve")
async def approve_review(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    state = await workflow_core.approve_review(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/pause")
async def pause_workflow(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    state = await workflow_core.pause_workflow(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
        reason=str(payload.get("reason") or "").strip() or None,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/resume")
async def resume_workflow(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    state = await workflow_core.resume_workflow(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/correction")
async def apply_correction(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    text = str(payload.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Correction text is required")
    state = await workflow_core.apply_correction(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
        text=text,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.post("/attach-simulation")
async def attach_simulation(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    workflow_id = str(payload.get("workflow_id") or "").strip()
    simulation_id = str(payload.get("simulation_id") or "").strip()
    if not simulation_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="simulation_id is required")
    state = await workflow_core.attach_simulation(
        workflow_id,
        user_id=int(user.get("id")) if user else None,
        simulation_id=simulation_id,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workflow not found")
    return state


@router.get("/personas")
async def list_persona_library(
    place: str = Query("", alias="place"),
    audience: str = Query("", alias="audience"),
    date_from: Optional[str] = Query(None, alias="date_from"),
    date_to: Optional[str] = Query(None, alias="date_to"),
    min_count: Optional[int] = Query(None, ge=1, alias="min_count"),
    max_count: Optional[int] = Query(None, ge=1, alias="max_count"),
    limit: int = Query(10, ge=1, le=50),
    authorization: str = Header(None),
) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    items = await workflow_core.list_persona_library(
        user_id=int(user.get("id")) if user else None,
        place_query=place.strip() or None,
        audience=audience.strip() or None,
        date_from=date_from,
        date_to=date_to,
        min_count=min_count,
        max_count=max_count,
        limit=limit,
    )
    return {"items": items, "total": len(items)}
