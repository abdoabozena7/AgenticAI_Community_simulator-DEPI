"""
LLM endpoints backed by a local Ollama server.

Includes free‑form generation and schema extraction. These endpoints
provide simple wrappers around the local LLM for use by the frontend.
"""

from __future__ import annotations

import logging
import re
from typing import Optional, Dict, Any
import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..core.ollama_client import generate_ollama


router = APIRouter(prefix="/llm")
logger = logging.getLogger("llm_api")


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    system: Optional[str] = None
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)


@router.post("/generate")
async def generate_text(payload: GenerateRequest) -> dict:
    """Generate arbitrary text from the local LLM.

    If the LLM service is unavailable or an error occurs, a 502
    response is returned to the caller.
    """
    try:
        text = await generate_ollama(
            prompt=payload.prompt,
            system=payload.system,
            temperature=payload.temperature,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"text": text}


# --- Schema extraction (chat‑first flow) ---

class ExtractRequest(BaseModel):
    message: str = Field(..., min_length=1)
    schema: Dict[str, Any] = Field(default_factory=dict)


class ExtractResponse(BaseModel):
    idea: Optional[str] = None
    country: Optional[str] = None
    city: Optional[str] = None
    category: Optional[str] = None
    target_audience: list[str] = Field(default_factory=list)
    goals: list[str] = Field(default_factory=list)
    risk_appetite: Optional[float] = None
    idea_maturity: Optional[str] = None
    missing: list[str] = Field(default_factory=list)
    question: Optional[str] = None


PROMPT_TEMPLATE = """You extract structured fields from chat messages.

Required fields: idea, country, city, category, target_audience, goals.

Allowed options (choose the closest match):
- category: technology, healthcare, finance, education, e-commerce, entertainment, social, b2b saas, consumer apps, hardware
- target_audience: Gen Z (18-24), Millennials (25-40), Gen X (41-56), Boomers (57-75), Developers, Enterprises, SMBs, Consumers, Students, Professionals
- goals: Market Validation, Funding Readiness, User Acquisition, Product-Market Fit, Competitive Analysis, Growth Strategy
- idea_maturity: concept, prototype, mvp, launched

Hard requirements:
- If all required fields are present/confident, missing MUST be [] and question MUST be null.
- Do NOT ask for a field that you can reliably extract from the message.
- If category/target_audience/goals are not explicit, infer the best-fit options from the idea and choose from the list above.
- If a required field is missing or unclear, include its name in "missing" and provide a brief, human, context-rich follow-up in "question" (Arabic allowed).
- Use the current schema to keep known values unless the user clearly changes them.
- If multiple fields are missing, ask ONLY the single most critical question (priority: country/city, then idea).
- If the message includes a known city, infer the country (e.g., Cairo/New Cairo -> Egypt).
- Prefer proper names (e.g., "Egypt", "Cairo", "Giza"). Handle "City, Country" patterns.
- Return JSON only, no prose.

Examples:
Input: "I want to launch an AI legal assistant in Cairo, Egypt"
Output:
{{"idea":"AI legal assistant","country":"Egypt","city":"Cairo","category":"technology","target_audience":["Consumers"],"goals":["Market Validation"],"risk_appetite":0.5,"idea_maturity":"concept","missing":[],"question":null}}

Input: "I want to launch an AI app in Egypt"
Output:
{{"idea":"AI app","country":"Egypt","city":null,"category":"technology","target_audience":["Consumers"],"goals":["Market Validation"],"risk_appetite":0.5,"idea_maturity":"concept","missing":["city"],"question":"Which city in Egypt should we focus on? Location changes market culture and behavior."}}

Input: "أريد إطلاق مبادرة في القاهرة الجديدة"
Output:
{{"idea":"مبادرة","country":"Egypt","city":"Cairo","category":"technology","target_audience":["Consumers"],"goals":["Market Validation"],"risk_appetite":0.5,"idea_maturity":"concept","missing":[],"question":null}}

Current schema (may be partial):
{schema_json}

User message:
{message}

Return JSON with keys: idea, country, city, category, target_audience, goals, risk_appetite, idea_maturity, missing (array), question (string or null)."""


COUNTRY_ALIASES = {
    "egypt": "Egypt",
    "مصر": "Egypt",
    "ksa": "Saudi Arabia",
    "saudi": "Saudi Arabia",
    "السعودية": "Saudi Arabia",
    "uae": "United Arab Emirates",
    "emirates": "United Arab Emirates",
    "الإمارات": "United Arab Emirates",
}


CITY_ALIASES = {
    "cairo": "Cairo",
    "القاهرة": "Cairo",
    "القاهرة الجديدة": "Cairo",
    "giza": "Giza",
    "الجيزة": "Giza",
    "alexandria": "Alexandria",
    "الإسكندرية": "Alexandria",
    "الاسكندرية": "Alexandria",
}


def _norm_text(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    v = value.strip()
    return v or None


def _normalize_country(value: Optional[str]) -> Optional[str]:
    v = _norm_text(value)
    if not v:
        return None
    key = v.lower()
    return COUNTRY_ALIASES.get(key, v.title())


def _normalize_city(value: Optional[str]) -> Optional[str]:
    v = _norm_text(value)
    if not v:
        return None
    key = v.lower()
    return CITY_ALIASES.get(key, v.title())


def _safe_json_loads(raw: str) -> Dict[str, Any]:
    from json import loads, JSONDecodeError
    try:
        return loads(raw)
    except JSONDecodeError:
        # Try to extract a JSON object from surrounding text
        start = raw.find("{")
        end = raw.rfind("}")
        if start != -1 and end != -1 and end > start:
            return loads(raw[start : end + 1])
        raise


def _contains_arabic(text: str) -> bool:
    return bool(re.search(r"[\u0600-\u06FF]", text))


async def _extract_location_only(message: str, schema: Dict[str, Any]) -> Dict[str, Any]:
    from json import dumps
    lang_hint = "Arabic" if _contains_arabic(message) else "English"
    prompt = (
        "Extract ONLY city and country from the user message. "
        "If a known city is mentioned, infer the country. "
        f"Message language: {lang_hint}. Return JSON only with keys: city, country.\n"
        f"Current schema: {dumps(schema, ensure_ascii=False)}\n"
        f"Message: {message}"
    )
    try:
        raw = await asyncio.wait_for(
            generate_ollama(prompt, temperature=0.1, response_format="json"),
            timeout=6.0,
        )
        return _safe_json_loads(raw)
    except Exception:
        return {}


@router.post("/extract", response_model=ExtractResponse)
async def extract_schema(payload: ExtractRequest) -> ExtractResponse:
    """Extract structured fields from a free‑form chat message using the LLM.

    This endpoint uses a prompt to instruct the LLM to return a JSON
    object containing the desired fields. The result is normalised and
    some heuristic fallbacks are applied for country/city extraction.
    """
    from json import dumps

    logger.info("extract_schema: message_len=%s", len(payload.message or ""))
    logger.info("extract_schema: schema_in=%s", payload.schema)

    prompt = PROMPT_TEMPLATE.format(
        schema_json=dumps(payload.schema, ensure_ascii=False),
        message=payload.message,
    )
    try:
        raw = await asyncio.wait_for(
            generate_ollama(prompt, temperature=0.2, response_format="json"),
            timeout=8.0,
        )
        logger.info("extract_schema: raw_llm=%s", raw)
        data = _safe_json_loads(raw)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM extraction failed: {exc}")

    # Normalise scalars
    idea = _norm_text(data.get("idea"))
    country = _normalize_country(data.get("country"))
    city = _normalize_city(data.get("city"))
    category = _norm_text(data.get("category"))
    idea_maturity = _norm_text(data.get("idea_maturity"))
    question = _norm_text(data.get("question"))
    schema = payload.schema or {}
    schema_idea = _norm_text(schema.get("idea"))
    schema_country = _normalize_country(schema.get("country"))
    schema_city = _normalize_city(schema.get("city"))
    schema_category = _norm_text(schema.get("category"))
    schema_maturity = _norm_text(schema.get("idea_maturity"))
    # Lists
    target_audience = data.get("target_audience") if isinstance(data.get("target_audience"), list) else []
    goals = data.get("goals") if isinstance(data.get("goals"), list) else []
    # Risk appetite
    risk_appetite = data.get("risk_appetite")
    if isinstance(risk_appetite, (int, float)):
        if risk_appetite > 1:
            risk_appetite = risk_appetite / 100.0
    else:
        risk_appetite = None

    if not idea:
        idea = schema_idea
    if not country:
        country = schema_country
    if not city:
        city = schema_city
    if not category:
        category = schema_category
    if not target_audience and isinstance(schema.get("target_audience"), list):
        target_audience = schema.get("target_audience")
    if not goals and isinstance(schema.get("goals"), list):
        goals = schema.get("goals")
    if risk_appetite is None and isinstance(schema.get("risk_appetite"), (int, float)):
        risk_appetite = schema.get("risk_appetite")
    if not idea_maturity:
        idea_maturity = schema_maturity

    # If still missing, run a focused LLM pass for location only
    if (not country or not city) and payload.message:
        location_data = await _extract_location_only(payload.message, payload.schema)
        country = country or _normalize_country(location_data.get("country"))
        city = city or _normalize_city(location_data.get("city"))

    # If city is Egyptian and country missing, infer Egypt
    if city and not country:
        if city in {"Cairo", "Giza", "Alexandria"}:
            country = "Egypt"

    missing: list[str] = []
    if not idea:
        missing.append("idea")
    if not country:
        missing.append("country")
    if not city:
        missing.append("city")
    if not category:
        missing.append("category")
    if not target_audience:
        missing.append("target_audience")
    if not goals:
        missing.append("goals")

    # Enforce a single critical follow-up question
    if "country" in missing and "city" in missing:
        question = "ما هي الدولة والمدينة المستهدفة؟"
    elif "city" in missing:
        question = "ما هي المدينة المستهدفة؟"
    elif "country" in missing:
        question = "ما هي الدولة المستهدفة؟"
    elif "idea" in missing:
        question = "ما هي الفكرة التي تريد إطلاقها؟"
    else:
        question = None

    return ExtractResponse(
        idea=idea,
        country=country,
        city=city,
        category=category,
        target_audience=target_audience,
        goals=goals,
        risk_appetite=risk_appetite,
        idea_maturity=idea_maturity,
        missing=missing,
        question=question,
    )


class IntentRequest(BaseModel):
    message: str = Field(..., min_length=1)
    context: Optional[str] = None


class IntentResponse(BaseModel):
    start: bool
    reason: Optional[str] = None


@router.post("/intent", response_model=IntentResponse)
async def detect_intent(payload: IntentRequest) -> IntentResponse:
    prompt = (
        "Determine whether the user wants to start the simulation now. "
        "Return JSON only: {\"start\": true/false, \"reason\": \"...\"}. "
        "Use context if provided. Accept Arabic confirmations like: نعم, أيوه, تمام, جاهز, ابدأ.\n"
        f"Context: {payload.context or ''}\n"
        f"Message: {payload.message}"
    )
    try:
        raw = await generate_ollama(prompt=prompt, temperature=0.2, response_format="json")
        data = _safe_json_loads(raw)
        return IntentResponse(start=bool(data.get("start")), reason=data.get("reason"))
    except Exception:
        return IntentResponse(start=False, reason=None)
