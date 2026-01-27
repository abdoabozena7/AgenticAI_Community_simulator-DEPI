"""
Web search API endpoint.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..core.web_search import search_web


router = APIRouter(prefix="/search")


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=2)
    max_results: int = Field(default=5, ge=1, le=10)
    language: Optional[str] = Field(default="en")


@router.post("/web")
async def search_web_endpoint(payload: SearchRequest) -> dict:
    result = await search_web(
        query=payload.query,
        max_results=payload.max_results,
        language=payload.language or "en",
    )
    return result
