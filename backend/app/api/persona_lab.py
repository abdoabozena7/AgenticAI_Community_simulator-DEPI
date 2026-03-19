from __future__ import annotations

import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, Header, HTTPException, Query, status

from ..core import auth as auth_core
from ..core import persona_lab as persona_lab_core

router = APIRouter(prefix="/simulation/persona-lab")


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


@router.post("/jobs")
async def start_persona_lab_job(payload: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    try:
        return await persona_lab_core.start_persona_lab_job(
            user_id=int(user.get("id")) if user else None,
            payload=payload,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/jobs")
async def list_persona_lab_jobs(
    limit: int = Query(20, ge=1, le=50),
    authorization: str = Header(None),
) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    items = await persona_lab_core.list_persona_lab_jobs(
        user_id=int(user.get("id")) if user else None,
        limit=limit,
    )
    return {"items": items, "total": len(items)}


@router.get("/jobs/{job_id}")
async def get_persona_lab_job(job_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    state = await persona_lab_core.get_persona_lab_job(
        user_id=int(user.get("id")) if user else None,
        job_id=job_id,
    )
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Persona lab job not found")
    return state


@router.get("/library")
async def list_persona_sets(
    place: str = Query("", alias="place"),
    audience: str = Query("", alias="audience"),
    date_from: Optional[str] = Query(None, alias="date_from"),
    date_to: Optional[str] = Query(None, alias="date_to"),
    min_count: Optional[int] = Query(None, ge=1, alias="min_count"),
    max_count: Optional[int] = Query(None, ge=1, alias="max_count"),
    limit: int = Query(20, ge=1, le=50),
    authorization: str = Header(None),
) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    items = await persona_lab_core.list_persona_sets(
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


@router.get("/library/{set_key}")
async def get_persona_set(set_key: str, authorization: str = Header(None)) -> Dict[str, Any]:
    user = await _resolve_user(authorization, require=_auth_required())
    record = await persona_lab_core.get_persona_set(
        user_id=int(user.get("id")) if user else None,
        set_key=set_key,
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Persona set not found")
    return record
