"""
Web search API endpoint.
"""

from __future__ import annotations

from typing import Optional

import os
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from ..core.web_search import search_web
from ..core import auth as auth_core


router = APIRouter(prefix="/search")


def _auth_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "false").lower() in {"1", "true", "yes"}


async def _require_user(authorization: Optional[str]) -> None:
    if not _auth_required():
        return
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if not auth_core.has_permission(user, "search:use"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=2)
    max_results: int = Field(default=5, ge=1, le=10)
    language: Optional[str] = Field(default="en")


@router.post("/web")
async def search_web_endpoint(payload: SearchRequest, authorization: str = Header(None)) -> dict:
    await _require_user(authorization)
    result = await search_web(
        query=payload.query,
        max_results=payload.max_results,
        language=payload.language or "en",
    )
    return result
