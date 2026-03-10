from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from typing import Any, Dict, List, Optional

from . import db as db_core
from .web_search import search_web

_WORKFLOWS: Dict[str, Dict[str, Any]] = {}
_WORKFLOW_LOCK = asyncio.Lock()

WORKFLOW_STAGES = [
    "context_scope",
    "schema_intake",
    "clarification",
    "idea_research",
    "location_research",
    "persona_synthesis",
    "review",
    "ready_to_start",
]

STAGE_ETA_SECONDS = {
    "context_scope": 30,
    "schema_intake": 90,
    "clarification": 75,
    "idea_research": 95,
    "location_research": 120,
    "persona_synthesis": 60,
    "review": 45,
    "ready_to_start": 15,
}

CONTEXT_OPTIONS = [
    {"id": "specific_place", "label": "Specific place", "description": "Research a target place and generate local personas."},
    {"id": "internet", "label": "Internet / general audience", "description": "Use web-wide signals and general personas."},
    {"id": "global", "label": "Global invention / broad audience", "description": "Use broad market signals without local grounding."},
]

SCHEMA_REQUIRED_FIELDS = ["idea", "category", "targetAudience", "goals"]
BIAS_TRIGGER_PATTERNS = (
    "make them accept",
    "make the agents accept",
    "force them",
    "tell them to love it",
    "they should all like",
    "everyone will love",
)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _clone(payload: Dict[str, Any]) -> Dict[str, Any]:
    return json.loads(json.dumps(payload, ensure_ascii=False))


def _normalize_language(value: Any) -> str:
    return "ar" if str(value or "en").strip().lower().startswith("ar") else "en"


def _normalize_scope(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"specific_place", "place", "local", "location"}:
        return "specific_place"
    if raw in {"internet", "online", "general"}:
        return "internet"
    if raw in {"global", "worldwide", "broad"}:
        return "global"
    return ""


def _canonical_place_key(place_label: str, scope: str) -> str:
    base = re.sub(r"[^a-z0-9\u0600-\u06FF]+", "-", str(place_label or "").strip().lower())
    base = re.sub(r"-{2,}", "-", base).strip("-")
    return base or scope or "general"


def _normalize_string_list(value: Any) -> List[str]:
    if isinstance(value, list):
        items = [str(item or "").strip() for item in value]
    elif isinstance(value, str):
        items = [part.strip() for part in re.split(r"[,/\n]+", value)]
    else:
        items = []
    unique: List[str] = []
    seen = set()
    for item in items:
        if not item:
            continue
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(item)
    return unique[:8]


def _is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _normalize_draft_context(draft: Optional[Dict[str, Any]], language: str) -> Dict[str, Any]:
    draft = draft or {}
    context_scope = _normalize_scope(draft.get("contextScope") or draft.get("context_scope"))
    target_audience = _normalize_string_list(draft.get("targetAudience") or draft.get("target_audience"))
    goals = _normalize_string_list(draft.get("goals"))
    place_name = str(
        draft.get("placeName")
        or draft.get("place_name")
        or ", ".join(
            part for part in [str(draft.get("city") or "").strip(), str(draft.get("country") or "").strip()] if part
        )
    ).strip()
    return {
        "idea": str(draft.get("idea") or "").strip(),
        "category": str(draft.get("category") or "").strip(),
        "targetAudience": target_audience,
        "country": str(draft.get("country") or "").strip(),
        "city": str(draft.get("city") or "").strip(),
        "placeName": place_name,
        "riskAppetite": int(draft.get("riskAppetite") or draft.get("risk_appetite") or 50),
        "ideaMaturity": str(draft.get("ideaMaturity") or draft.get("idea_maturity") or "concept").strip() or "concept",
        "goals": goals,
        "contextScope": context_scope,
        "language": language,
    }


def _add_guide_message(state: Dict[str, Any], content: str, *, stage: Optional[str] = None, tone: str = "guide") -> None:
    text = str(content or "").strip()
    if not text:
        return
    messages = state.setdefault("guide_messages", [])
    if messages and messages[-1].get("content") == text and messages[-1].get("stage") == (stage or state.get("current_stage")):
        return
    messages.append(
        {
            "id": f"guide-{uuid.uuid4().hex[:10]}",
            "role": "guide",
            "tone": tone,
            "content": text,
            "stage": stage or state.get("current_stage"),
            "timestamp": _now_ms(),
        }
    )
    state["guide_messages"] = messages[-40:]


def _mark_stage(state: Dict[str, Any], stage: str, stage_status: str, summary: Optional[str] = None) -> None:
    history = state.setdefault("stage_history", [])
    found = next((item for item in history if item.get("stage") == stage), None)
    now = _now_ms()
    if found is None:
        found = {
            "stage": stage,
            "started_at": now,
            "completed_at": None,
            "summary": "",
        }
        history.append(found)
    found["status"] = stage_status
    found["eta_seconds"] = STAGE_ETA_SECONDS.get(stage, 30)
    if summary:
        found["summary"] = summary
    if stage_status in {"completed", "ready"}:
        found["completed_at"] = now
    state["current_stage"] = stage
    state["current_stage_status"] = stage_status
    state["stage_history"] = history


def _remaining_eta(state: Dict[str, Any]) -> int:
    current = state.get("current_stage") or "context_scope"
    try:
        start_index = WORKFLOW_STAGES.index(current)
    except ValueError:
        start_index = 0
    total = 0
    for stage in WORKFLOW_STAGES[start_index:]:
        stage_entry = next((item for item in state.get("stage_history", []) if item.get("stage") == stage), None)
        if stage_entry and stage_entry.get("status") in {"completed", "ready"}:
            continue
        total += STAGE_ETA_SECONDS.get(stage, 30)
    return total


def _required_fields(state: Dict[str, Any]) -> List[str]:
    draft = state.get("draft_context") or {}
    missing = [field for field in SCHEMA_REQUIRED_FIELDS if not draft.get(field)]
    if _normalize_scope(draft.get("contextScope")) == "specific_place":
        if not (draft.get("city") or draft.get("country") or draft.get("placeName")):
            missing.append("placeName")
    return missing


def _idea_is_ambiguous(draft: Dict[str, Any]) -> bool:
    idea = str(draft.get("idea") or "")
    words = re.findall(r"[A-Za-z\u0600-\u06FF0-9]+", idea)
    return len(words) < 8 or len(idea.strip()) < 35


def _build_clarification_questions(state: Dict[str, Any]) -> List[Dict[str, Any]]:
    draft = state.get("draft_context") or {}
    questions: List[Dict[str, Any]] = []
    if not _idea_is_ambiguous(draft):
        return questions
    if not draft.get("valuePromise"):
        questions.append(
            {
                "id": "clarify_value_promise",
                "axis": "value_promise",
                "prompt": "What is the first concrete outcome the user should get?" if state.get("language") == "en" else "ما أول نتيجة عملية يجب أن يحصل عليها المستخدم؟",
                "reason": "The idea is still broad and needs a sharper value promise." if state.get("language") == "en" else "الفكرة ما زالت عامة وتحتاج قيمة أوضح.",
                "answer_type": "text",
            }
        )
    if not draft.get("adoptionTrigger"):
        questions.append(
            {
                "id": "clarify_adoption_trigger",
                "axis": "adoption_trigger",
                "prompt": "What event makes the first customer urgently try this?" if state.get("language") == "en" else "ما الموقف الذي سيدفع أول عميل لتجربة الفكرة فورًا؟",
                "reason": "We need a realistic first-use trigger, not a generic target." if state.get("language") == "en" else "نحتاج سببًا واقعيًا للاستخدام الأول، وليس وصفًا عامًا فقط.",
                "answer_type": "text",
            }
        )
    return questions[:2]


def _extract_highlights(results: List[Dict[str, Any]], *, limit: int = 4) -> List[str]:
    highlights: List[str] = []
    for item in results:
        title = str(item.get("title") or "").strip()
        snippet = str(item.get("snippet") or "").strip()
        text = title or snippet
        if not text:
            continue
        highlights.append(text[:220])
        if len(highlights) >= limit:
            break
    return highlights


def _summarize_results(results: List[Dict[str, Any]], fallback: str) -> str:
    snippets = _extract_highlights(results, limit=3)
    if snippets:
        return " | ".join(snippets)
    return fallback


async def _run_idea_research(state: Dict[str, Any]) -> Dict[str, Any]:
    draft = state.get("draft_context") or {}
    idea = str(draft.get("idea") or "").strip()
    category = str(draft.get("category") or "").strip()
    audience = ", ".join(draft.get("targetAudience") or [])
    query = " ".join(part for part in [idea, category, audience] if part).strip()
    search = await search_web(query=query, max_results=6, language=state.get("language") or "en", strict_web_only=True)
    results = search.get("results") if isinstance(search.get("results"), list) else []
    summary = str(search.get("answer") or "").strip() or _summarize_results(results, fallback=idea)
    return {
        "query": query,
        "summary": summary,
        "highlights": _extract_highlights(results),
        "sources": results[:6],
        "provider": search.get("provider") or "web",
        "quality": search.get("quality") if isinstance(search.get("quality"), dict) else {},
    }


async def _run_location_research(state: Dict[str, Any]) -> Dict[str, Any]:
    draft = state.get("draft_context") or {}
    scope = _normalize_scope(draft.get("contextScope"))
    place_label = str(draft.get("placeName") or draft.get("city") or draft.get("country") or "").strip()
    if scope != "specific_place" or not place_label:
        return {
            "query_plan": [],
            "summary": "",
            "signals": [],
            "sources": [],
            "place_label": place_label,
            "source_policy": "open_socials",
        }
    category = str(draft.get("category") or "").strip()
    queries = [
        f'"{place_label}" community page {category}'.strip(),
        f'"{place_label}" people opinions {category}'.strip(),
        f'"صفحة {place_label} اليوم"',
        f'"اهل {place_label}"',
    ]
    collected: List[Dict[str, Any]] = []
    for query in queries:
        result = await search_web(query=query, max_results=4, language=state.get("language") or "en", strict_web_only=True)
        items = result.get("results") if isinstance(result.get("results"), list) else []
        for item in items:
            if any(str(existing.get("url") or "") == str(item.get("url") or "") for existing in collected):
                continue
            collected.append(item)
        if len(collected) >= 8:
            break
    signals = _extract_highlights(collected, limit=5)
    summary = _summarize_results(collected, fallback=f"Open social and local web signals for {place_label}")
    return {
        "query_plan": queries,
        "summary": summary,
        "signals": signals,
        "sources": collected[:8],
        "place_label": place_label,
        "source_policy": "open_socials",
    }


def _persona_title(base: str, suffix: str, place_label: str) -> str:
    if place_label:
        return f"{place_label} {base} {suffix}".strip()
    return f"{base} {suffix}".strip()


def _synthesize_personas(state: Dict[str, Any], *, library_payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    draft = state.get("draft_context") or {}
    scope = _normalize_scope(draft.get("contextScope"))
    place_label = str(draft.get("placeName") or draft.get("city") or draft.get("country") or "").strip()
    if library_payload and isinstance(library_payload.get("personas"), list):
        snapshot = _clone(library_payload)
        snapshot["source"] = "library"
        return snapshot

    idea_summary = str(((state.get("idea_research") or {}).get("summary")) or draft.get("idea") or "").strip()
    location_signals = (state.get("location_research") or {}).get("signals") or []
    personas = [
        {
            "id": "pragmatic-operator",
            "label": _persona_title("Pragmatic", "Operator", place_label),
            "stance": "neutral",
            "summary": f"Evaluates the idea based on operational reliability and immediate value. {idea_summary[:120]}",
            "motivations": ["clear ROI", "simple onboarding", "credible execution"],
            "concerns": ["complex rollout", "unclear ownership", "vendor lock-in"],
            "source_signals": location_signals[:2],
        },
        {
            "id": "skeptical-comparer",
            "label": _persona_title("Skeptical", "Comparer", place_label),
            "stance": "reject",
            "summary": "Compares alternatives and challenges unsupported claims before changing opinion.",
            "motivations": ["evidence", "price transparency", "trust"],
            "concerns": ["weak differentiation", "marketing exaggeration", "social proof gaps"],
            "source_signals": location_signals[1:3],
        },
        {
            "id": "community-amplifier",
            "label": _persona_title("Community", "Amplifier", place_label),
            "stance": "accept",
            "summary": "Can spread adoption if the product feels locally relevant and shareable.",
            "motivations": ["word of mouth", "community relevance", "identity fit"],
            "concerns": ["cultural mismatch", "tone deaf messaging", "poor support"],
            "source_signals": location_signals[2:4],
        },
        {
            "id": "budget-sensitive-adopter",
            "label": _persona_title("Budget-Sensitive", "Adopter", place_label),
            "stance": "neutral",
            "summary": "Wants the upside but weighs cost, switching effort, and risk carefully.",
            "motivations": ["affordability", "quick trial", "low switching cost"],
            "concerns": ["subscription fatigue", "hidden fees", "unclear payback"],
            "source_signals": location_signals[3:5],
        },
    ]
    if scope == "specific_place":
        personas.append(
            {
                "id": "local-norms-guardian",
                "label": _persona_title("Local Norms", "Guardian", place_label),
                "stance": "neutral",
                "summary": "Filters the idea through local trust patterns, etiquette, and credibility markers.",
                "motivations": ["cultural fit", "familiar channels", "trusted references"],
                "concerns": ["outsider framing", "unsafe assumptions", "misread local habits"],
                "source_signals": location_signals[:3],
            }
        )
    return {
        "title": place_label or ("Global personas" if scope == "global" else "General web personas"),
        "place_key": _canonical_place_key(place_label or scope, scope),
        "place_label": place_label or ("Global" if scope == "global" else "Internet"),
        "scope": scope or "internet",
        "source_policy": "open_socials",
        "source": "generated",
        "personas": personas,
    }


def _review_payload(state: Dict[str, Any]) -> Dict[str, Any]:
    draft = state.get("draft_context") or {}
    idea_research = state.get("idea_research") or {}
    location_research = state.get("location_research") or {}
    persona_snapshot = state.get("persona_snapshot") or {}
    corrections = state.get("corrections") or []
    return {
        "title": str(draft.get("idea") or "Simulation brief").strip() or "Simulation brief",
        "summary": str(idea_research.get("summary") or draft.get("idea") or "").strip(),
        "research_highlights": idea_research.get("highlights") or [],
        "location_summary": location_research.get("summary") or "",
        "persona_count": len(persona_snapshot.get("personas") or []),
        "persona_title": persona_snapshot.get("title") or "",
        "applied_corrections": corrections[-5:],
        "estimated_runtime_seconds": 180,
        "ready_to_start": True,
    }


def _verify_stage(state: Dict[str, Any], stage: str) -> Dict[str, Any]:
    if stage == "idea_research":
        ok = bool((state.get("idea_research") or {}).get("summary"))
    elif stage == "location_research":
        scope = _normalize_scope((state.get("draft_context") or {}).get("contextScope"))
        ok = scope != "specific_place" or bool((state.get("location_research") or {}).get("sources"))
    elif stage == "persona_synthesis":
        ok = len((state.get("persona_snapshot") or {}).get("personas") or []) >= 4
    elif stage == "review":
        ok = bool((state.get("review") or {}).get("ready_to_start"))
    else:
        ok = True
    return {
        "stage": stage,
        "ok": ok,
        "checked_at": _now_ms(),
    }


def _neutralize_correction(state: Dict[str, Any], text: str) -> Dict[str, Any]:
    raw = str(text or "").strip()
    lowered = raw.lower()
    draft = state.get("draft_context") or {}
    updates: Dict[str, Any] = {}
    notes: List[str] = []
    steering = any(pattern in lowered for pattern in BIAS_TRIGGER_PATTERNS)
    city_match = re.search(r"(?:city|المدينة)\s*(?:is|=|:)?\s*([A-Za-z\u0600-\u06FF\s-]{2,60})", raw, flags=re.I)
    country_match = re.search(r"(?:country|الدولة)\s*(?:is|=|:)?\s*([A-Za-z\u0600-\u06FF\s-]{2,60})", raw, flags=re.I)
    category_match = re.search(r"(?:category|الفئة)\s*(?:is|=|:)?\s*([A-Za-z\u0600-\u06FF\s&-]{2,60})", raw, flags=re.I)
    audience_match = re.search(r"(?:audience|الجمهور)\s*(?:is|=|:)?\s*([A-Za-z\u0600-\u06FF\s,&-]{2,100})", raw, flags=re.I)
    goal_match = re.search(r"(?:goal|الهدف)\s*(?:is|=|:)?\s*([A-Za-z\u0600-\u06FF\s,&-]{2,100})", raw, flags=re.I)
    if city_match:
        updates["city"] = city_match.group(1).strip()
    if country_match:
        updates["country"] = country_match.group(1).strip()
    if category_match:
        updates["category"] = category_match.group(1).strip()
    if audience_match:
        updates["targetAudience"] = _normalize_string_list(audience_match.group(1))
    if goal_match:
        updates["goals"] = _normalize_string_list(goal_match.group(1))
    if steering:
        notes.append("Opinion steering was filtered out and not passed to agents.")
    if not updates and not steering:
        notes.append("Saved as a neutral factual note for the next run review.")
    if updates.get("city") and not draft.get("placeName"):
        updates["placeName"] = updates["city"]
    factual_bits = [f"{key}={value}" for key, value in updates.items() if value]
    neutralized = (
        f"Apply factual context update: {', '.join(factual_bits)}."
        if factual_bits
        else "Store as non-steering factual note for operator review."
    )
    return {
        "raw_text": raw,
        "neutralized_text": neutralized,
        "field_updates": updates,
        "notes": notes,
        "steering_filtered": steering,
        "apply_mode": "factual_update" if updates else ("needs_review" if not steering else "filtered"),
        "timestamp": _now_ms(),
    }


def _invalidate_downstream(state: Dict[str, Any], *, field_updates: Dict[str, Any]) -> None:
    affected_keys = set(field_updates.keys())
    if affected_keys & {"idea", "category", "targetAudience", "goals"}:
        state["clarification_questions"] = None
        state["clarification_answers"] = {}
        state["idea_research"] = None
        state["persona_snapshot"] = None
        state["review"] = None
    if affected_keys & {"city", "country", "placeName", "contextScope"}:
        state["location_research"] = None
        state["persona_snapshot"] = None
        state["review"] = None
    if affected_keys:
        state["review_approved"] = False


def _state_response(state: Dict[str, Any]) -> Dict[str, Any]:
    payload = _clone(state)
    payload["stage_eta_seconds"] = STAGE_ETA_SECONDS.get(payload.get("current_stage") or "", 30)
    payload["estimated_total_seconds"] = _remaining_eta(state)
    payload["required_fields"] = _required_fields(state)
    payload["verification"] = state.get("verification") or {}
    payload["context_options"] = CONTEXT_OPTIONS
    return payload


async def _persist(state: Dict[str, Any]) -> None:
    state["updated_at"] = _now_ms()
    await db_core.upsert_guided_workflow(
        state["workflow_id"],
        state,
        user_id=state.get("user_id"),
        status=state.get("status"),
        current_stage=state.get("current_stage"),
        attached_simulation_id=((state.get("simulation") or {}).get("attached_simulation_id") if isinstance(state.get("simulation"), dict) else None),
    )


async def _advance_until_input(state: Dict[str, Any]) -> None:
    if state.get("status") == "paused":
        return

    draft = state.get("draft_context") or {}
    scope = _normalize_scope(draft.get("contextScope"))
    if not scope:
        state["status"] = "awaiting_input"
        _mark_stage(state, "context_scope", "awaiting_input", "Context scope is required.")
        _add_guide_message(
            state,
            "Choose the target context first. This step is required and cannot be skipped."
            if state.get("language") == "en"
            else "اختر نوع السياق أولًا. هذه الخطوة إجبارية ولا يمكن تخطيها.",
            stage="context_scope",
        )
        return

    missing = _required_fields(state)
    if missing:
        state["status"] = "awaiting_input"
        _mark_stage(state, "schema_intake", "awaiting_input", "Need required schema fields.")
        _add_guide_message(
            state,
            "I collected only the schema fields that are still missing."
            if state.get("language") == "en"
            else "أجمع الآن فقط الحقول الناقصة من الـschema بدون تكرار ما هو موجود.",
            stage="schema_intake",
        )
        return

    if state.get("clarification_questions") is None:
        questions = _build_clarification_questions(state)
        state["clarification_questions"] = questions
        state["clarification_answers"] = {}
    questions = state.get("clarification_questions") or []
    unanswered = [item for item in questions if not (state.get("clarification_answers") or {}).get(item["id"])]
    if unanswered:
        state["status"] = "awaiting_input"
        _mark_stage(state, "clarification", "awaiting_input", "Need clarification answers.")
        _add_guide_message(
            state,
            "I need short clarification answers only where the idea is still ambiguous."
            if state.get("language") == "en"
            else "أحتاج توضيحات قصيرة فقط في النقاط التي ما زالت غامضة فعلًا.",
            stage="clarification",
        )
        return
    _mark_stage(state, "clarification", "completed", "Clarification complete.")

    if state.get("idea_research") is None:
        state["status"] = "in_progress"
        _mark_stage(state, "idea_research", "in_progress", "Researching the idea.")
        _add_guide_message(
            state,
            "Idea research agent is collecting market and product signals."
            if state.get("language") == "en"
            else "Agent البحث عن الفكرة يجمع الآن إشارات السوق والمنتج.",
            stage="idea_research",
        )
        state["idea_research"] = await _run_idea_research(state)
        state["verification"] = _verify_stage(state, "idea_research")
        _mark_stage(state, "idea_research", "completed", "Idea research complete.")

    if scope == "specific_place" and state.get("location_research") is None:
        state["status"] = "in_progress"
        _mark_stage(state, "location_research", "in_progress", "Researching target place.")
        _add_guide_message(
            state,
            "Location research agent is reading public local pages and open social signals."
            if state.get("language") == "en"
            else "Agent المكان يراجع الصفحات المحلية العامة وإشارات السوشيال المفتوحة.",
            stage="location_research",
        )
        state["location_research"] = await _run_location_research(state)
        state["verification"] = _verify_stage(state, "location_research")
        _mark_stage(state, "location_research", "completed", "Location research complete.")

    if state.get("persona_snapshot") is None:
        state["status"] = "in_progress"
        _mark_stage(state, "persona_synthesis", "in_progress", "Building personas.")
        scope_label = _normalize_scope((state.get("draft_context") or {}).get("contextScope"))
        place_label = str((state.get("draft_context") or {}).get("placeName") or (state.get("draft_context") or {}).get("city") or scope_label).strip()
        place_key = _canonical_place_key(place_label or scope_label, scope_label)
        existing_library = await db_core.fetch_persona_library_record(user_id=state.get("user_id"), place_key=place_key)
        library_payload = existing_library.get("payload") if existing_library else None
        snapshot = _synthesize_personas(state, library_payload=library_payload if isinstance(library_payload, dict) else None)
        state["persona_snapshot"] = snapshot
        await db_core.upsert_persona_library_record(
            user_id=state.get("user_id"),
            place_key=str(snapshot.get("place_key") or place_key),
            place_label=str(snapshot.get("place_label") or place_label or scope_label),
            scope=str(snapshot.get("scope") or scope_label or "internet"),
            source_policy=str(snapshot.get("source_policy") or "open_socials"),
            payload=snapshot,
        )
        state["persona_library"] = {
            "place_key": snapshot.get("place_key"),
            "place_label": snapshot.get("place_label"),
            "source": snapshot.get("source"),
        }
        state["verification"] = _verify_stage(state, "persona_synthesis")
        _mark_stage(state, "persona_synthesis", "completed", "Persona synthesis complete.")

    if not state.get("review") or not state.get("review_approved"):
        state["status"] = "awaiting_input"
        state["review"] = _review_payload(state)
        _mark_stage(state, "review", "awaiting_input", "Review is ready.")
        _add_guide_message(
            state,
            "Review the research summary, estimated time, and generated personas before starting."
            if state.get("language") == "en"
            else "راجع الملخص، الزمن التقديري، والشخصيات المتولدة قبل بدء المحاكاة.",
            stage="review",
        )
        state["verification"] = _verify_stage(state, "review")
        return

    state["status"] = "ready"
    _mark_stage(state, "ready_to_start", "ready", "Workflow is ready to start the simulation.")
    _add_guide_message(
        state,
        "All required stages are complete. You can start the simulation now."
        if state.get("language") == "en"
        else "كل المراحل المطلوبة اكتملت. يمكنك بدء المحاكاة الآن.",
        stage="ready_to_start",
    )


async def _hydrate(workflow_id: str, user_id: Optional[int]) -> Optional[Dict[str, Any]]:
    state = _WORKFLOWS.get(workflow_id)
    if state is not None:
        if state.get("user_id") is not None and user_id is not None and int(state.get("user_id")) != int(user_id):
            return None
        return state
    row = await db_core.fetch_guided_workflow(workflow_id, user_id=user_id)
    if row:
        _WORKFLOWS[workflow_id] = row
        return row
    return None


async def start_workflow(
    *,
    user_id: Optional[int],
    language: str,
    draft_context: Optional[Dict[str, Any]] = None,
    workflow_id: Optional[str] = None,
) -> Dict[str, Any]:
    safe_language = _normalize_language(language)
    async with _WORKFLOW_LOCK:
        if workflow_id:
            existing = await _hydrate(workflow_id, user_id)
            if existing is not None:
                return _state_response(existing)
        state = {
            "workflow_id": str(uuid.uuid4()),
            "user_id": user_id,
            "language": safe_language,
            "status": "awaiting_input",
            "current_stage": "context_scope",
            "current_stage_status": "awaiting_input",
            "created_at": _now_ms(),
            "updated_at": _now_ms(),
            "draft_context": _normalize_draft_context(draft_context, safe_language),
            "guide_messages": [],
            "stage_history": [],
            "clarification_questions": None,
            "clarification_answers": {},
            "idea_research": None,
            "location_research": None,
            "persona_snapshot": None,
            "persona_library": None,
            "review": None,
            "review_approved": False,
            "corrections": [],
            "last_correction": None,
            "verification": {},
            "simulation": {
                "attached_simulation_id": None,
                "debate_session": {
                    "status": "idle",
                    "watch_ready": False,
                    "message": "",
                },
            },
        }
        _WORKFLOWS[state["workflow_id"]] = state
        await _advance_until_input(state)
        await _persist(state)
        return _state_response(state)


async def get_workflow(workflow_id: str, user_id: Optional[int]) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        return _state_response(state)


async def get_workflow_for_simulation(simulation_id: str, user_id: Optional[int]) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await db_core.fetch_guided_workflow_by_simulation(simulation_id, user_id=user_id)
        if state is None:
            return None
        workflow_id = str(state.get("workflow_id") or "").strip()
        if workflow_id:
            _WORKFLOWS[workflow_id] = state
        return _state_response(state)


async def update_context_scope(
    workflow_id: str,
    *,
    user_id: Optional[int],
    scope: str,
    place_name: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        normalized_scope = _normalize_scope(scope)
        state["draft_context"]["contextScope"] = normalized_scope
        if place_name:
            state["draft_context"]["placeName"] = str(place_name).strip()
        if normalized_scope != "specific_place":
            state["draft_context"]["placeName"] = ""
            state["draft_context"]["city"] = ""
            state["draft_context"]["country"] = ""
        _add_guide_message(
            state,
            f"Context scope locked to {normalized_scope.replace('_', ' ')}."
            if state.get("language") == "en"
            else f"تم تثبيت نوع السياق: {normalized_scope.replace('_', ' ')}.",
            stage="context_scope",
        )
        await _advance_until_input(state)
        await _persist(state)
        return _state_response(state)


async def submit_schema(
    workflow_id: str,
    *,
    user_id: Optional[int],
    updates: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        normalized = _normalize_draft_context({**(state.get("draft_context") or {}), **(updates or {})}, state.get("language") or "en")
        for key, value in normalized.items():
            if _is_empty_value(value) and not _is_empty_value(state["draft_context"].get(key)):
                continue
            state["draft_context"][key] = value
        if state["draft_context"].get("contextScope") != "specific_place":
            state["draft_context"]["placeName"] = ""
            state["draft_context"]["city"] = ""
            state["draft_context"]["country"] = ""
        _add_guide_message(
            state,
            "Schema intake updated. I will continue only with the remaining missing pieces."
            if state.get("language") == "en"
            else "تم تحديث بيانات الـschema. سأكمل فقط ما تبقى من نواقص.",
            stage="schema_intake",
        )
        state["clarification_questions"] = None
        state["clarification_answers"] = {}
        state["review_approved"] = False
        state["review"] = None
        await _advance_until_input(state)
        await _persist(state)
        return _state_response(state)


async def answer_clarifications(
    workflow_id: str,
    *,
    user_id: Optional[int],
    answers: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        answer_map = state.setdefault("clarification_answers", {})
        draft = state.setdefault("draft_context", {})
        for answer in answers or []:
            question_id = str(answer.get("question_id") or answer.get("questionId") or "").strip()
            text = str(answer.get("answer") or answer.get("text") or answer.get("value") or "").strip()
            if not question_id or not text:
                continue
            answer_map[question_id] = text
            if question_id == "clarify_value_promise":
                draft["valuePromise"] = text
            elif question_id == "clarify_adoption_trigger":
                draft["adoptionTrigger"] = text
        _add_guide_message(
            state,
            "Clarifications received. I am resuming research and persona synthesis."
            if state.get("language") == "en"
            else "وصلت التوضيحات. أستأنف الآن البحث وبناء الشخصيات.",
            stage="clarification",
        )
        await _advance_until_input(state)
        await _persist(state)
        return _state_response(state)


async def approve_review(
    workflow_id: str,
    *,
    user_id: Optional[int],
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        state["review_approved"] = True
        _add_guide_message(
            state,
            "Review approved. The workflow is now ready to start the simulation."
            if state.get("language") == "en"
            else "تم اعتماد المراجعة. الـworkflow جاهز الآن لبدء المحاكاة.",
            stage="review",
        )
        await _advance_until_input(state)
        await _persist(state)
        return _state_response(state)


async def pause_workflow(
    workflow_id: str,
    *,
    user_id: Optional[int],
    reason: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        state["status"] = "paused"
        state["pause_reason"] = str(reason or "Paused by user.").strip()
        _add_guide_message(state, state["pause_reason"], tone="status")
        await _persist(state)
        return _state_response(state)


async def resume_workflow(
    workflow_id: str,
    *,
    user_id: Optional[int],
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        state["status"] = "in_progress"
        state["pause_reason"] = None
        await _advance_until_input(state)
        await _persist(state)
        return _state_response(state)


async def apply_correction(
    workflow_id: str,
    *,
    user_id: Optional[int],
    text: str,
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        correction = _neutralize_correction(state, text)
        state["last_correction"] = correction
        corrections = state.setdefault("corrections", [])
        corrections.append(correction)
        field_updates = correction.get("field_updates") if isinstance(correction.get("field_updates"), dict) else {}
        if field_updates:
            for key, value in field_updates.items():
                state["draft_context"][key] = value
        _invalidate_downstream(state, field_updates=field_updates)
        _add_guide_message(state, correction["neutralized_text"], stage=state.get("current_stage"), tone="correction")
        if correction.get("apply_mode") == "factual_update":
            await _advance_until_input(state)
        await _persist(state)
        return _state_response(state)


async def attach_simulation(
    workflow_id: str,
    *,
    user_id: Optional[int],
    simulation_id: str,
) -> Optional[Dict[str, Any]]:
    async with _WORKFLOW_LOCK:
        state = await _hydrate(workflow_id, user_id)
        if state is None:
            return None
        simulation = state.get("simulation")
        if not isinstance(simulation, dict):
            simulation = {}
        simulation["attached_simulation_id"] = str(simulation_id or "").strip() or None
        simulation["debate_session"] = {
            "status": "watch_ready",
            "watch_ready": True,
            "message": "Agents have entered the discussion phase. Open the reasoning view to watch."
            if state.get("language") == "en"
            else "بدأت الـagents مرحلة النقاش. افتح شاشة الـreasoning للمشاهدة.",
        }
        state["simulation"] = simulation
        await _persist(state)
        return _state_response(state)


async def list_persona_library(
    *,
    user_id: Optional[int],
    place_query: Optional[str],
    limit: int = 10,
) -> List[Dict[str, Any]]:
    return await db_core.list_persona_library_records(user_id=user_id, place_query=place_query, limit=limit)
