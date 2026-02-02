"""
Idea Court API endpoints.

This module exposes a single endpoint that simulates a "court" debate
about an idea. Given an idea description, optional category, and
research evidence, it uses the LLM to play three roles: defense
counsel, prosecution, and judge. The result is returned as a
structured JSON with arguments and verdict.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Header, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any

from ..core import auth as auth_core
from ..core.ollama_client import generate_ollama
import json


router = APIRouter(prefix="/court", tags=["court"])


class CourtRequest(BaseModel):
    idea: str = Field(..., min_length=5)
    category: Optional[str] = None
    evidence: Optional[str] = None
    language: Optional[str] = "en"


@router.post("/run")
async def run_court(
    payload: CourtRequest,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    # Authenticate user
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    idea = payload.idea.strip()
    category = (payload.category or "").strip()
    evidence = (payload.evidence or "").strip()
    language = (payload.language or "en").lower()

    response_language = "Arabic" if language.startswith("ar") else "English"
    # Compose prompt for LLM: instruct to produce JSON with keys: defense, prosecution, judge
    prompt = (
        "You are presiding over an Idea Court. There are three roles: "
        "Defense (arguing the idea is strong), Prosecution (arguing it will fail), "
        "and Judge (impartial verdict). Return JSON only with keys: "
        "defense (array of arguments), prosecution (array of arguments), verdict (string), "
        "success_conditions (array of strings), fatal_risks (array of strings), next_steps (array of strings). "
        "Do not hallucinate numbers. Base your arguments on the provided idea description, category, and evidence. "
        f"Respond in {response_language}.\n\n"
        f"Idea description: {idea}\n"
        f"Category: {category}\n"
        f"Evidence: {evidence}\n"
    )
    try:
        raw = await generate_ollama(prompt=prompt, temperature=0.4, response_format="json")
        data = json.loads(raw)
    except Exception:
        raise HTTPException(status_code=500, detail="LLM call failed for court")
    # Validate minimal structure
    result = {
        "defense": data.get("defense") or [],
        "prosecution": data.get("prosecution") or [],
        "verdict": data.get("verdict") or "",
        "success_conditions": data.get("success_conditions") or [],
        "fatal_risks": data.get("fatal_risks") or [],
        "next_steps": data.get("next_steps") or [],
    }
    return result