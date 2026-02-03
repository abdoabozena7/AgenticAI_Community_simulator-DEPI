"""
Research API endpoints.

These endpoints allow the frontend to perform multi‑provider web search and
optional map analysis before running the social simulation. A search
request returns a combined payload including search results,
structured market signals, evidence cards, and map data when a
location is provided.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Header, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

from ..core import auth as auth_core
from ..core.research_orchestrator import run_research


router = APIRouter(prefix="/research", tags=["research"])


class ResearchRequest(BaseModel):
    query: str = Field(..., min_length=3)
    location: Optional[str] = None
    category: Optional[str] = None
    language: Optional[str] = "en"


@router.post("/run")
async def run_research_endpoint(
    payload: ResearchRequest,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    """Run a research session for the current user.

    Requires a Bearer token. Persists the research session in the database.
    """
    # Authenticate via JWT
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ", 1)[1]
    payload_token = auth_core.decode_access_token(token)
    if not payload_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    user_id = int(payload_token.get("sub"))
    # Normalise inputs
    query = payload.query.strip()
    location = payload.location.strip() if payload.location else None
    category = payload.category.strip() if payload.category else None
    # Run orchestrator and persist session
    result = await run_research(
        user_id=user_id,
        query=query,
        location=location,
        category=category,
    )
    return result