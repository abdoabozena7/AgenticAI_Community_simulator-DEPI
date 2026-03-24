from __future__ import annotations

import asyncio
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..agents.base import AgentRuntime
from ..agents.persona_agent import DEFAULT_AUDIENCE_FAMILIES, PersonaAgent
from ..models.orchestration import (
    EvidenceItem,
    OrchestrationState,
    PersonaSourceMode,
    ResearchQuery,
    ResearchReport,
    classify_idea_context,
    normalize_context,
)
from ..services.llm_gateway import LLMGateway
from ..services.simulation_repository import SimulationRepository
from . import db as db_core
from .dataset_loader import load_dataset
from .web_search import search_web

LAB_STAGE_ORDER = [
    "preparing_request",
    "searching_sources",
    "reading_sources",
    "extracting_human_patterns",
    "fitting_personas",
    "removing_duplicates",
    "validating",
    "saving_persona_set",
    "completed",
]

LAB_STAGE_LABELS = {
    "preparing_request": "preparing request",
    "searching_sources": "searching sources",
    "reading_sources": "reading sources",
    "extracting_human_patterns": "extracting human patterns",
    "fitting_personas": "fitting personas",
    "removing_duplicates": "removing duplicates",
    "validating": "validating",
    "saving_persona_set": "saving persona set",
    "completed": "completed",
}

LAB_SOURCE_MODES = {
    "audience_only",
    "saved_place_reuse",
    "new_deep_search_place",
    "hybrid",
}

_JOB_TASKS: dict[str, asyncio.Task[None]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9\u0600-\u06FF]+", "-", value.lower()).strip("-")
    return re.sub(r"-{2,}", "-", normalized) or "persona-lab"


def _normalize_family(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in DEFAULT_AUDIENCE_FAMILIES:
        return raw
    aliases = {
        "genz": "gen z",
        "professionals": "working professionals",
        "working-professionals": "working professionals",
        "smb": "small business owners",
        "small-business": "small business owners",
    }
    return aliases.get(raw, raw if raw in DEFAULT_AUDIENCE_FAMILIES else "")


def _clamp_int(value: Any, *, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = fallback
    return max(minimum, min(maximum, parsed))


def _normalize_preset(value: Any) -> str:
    raw = str(value or "").strip().lower()
    return raw if raw in {"low", "balanced", "high"} else "balanced"


def _default_stage_state() -> List[Dict[str, Any]]:
    return [
        {
            "key": key,
            "label": LAB_STAGE_LABELS[key],
            "status": "pending",
            "detail": None,
            "started_at": None,
            "completed_at": None,
        }
        for key in LAB_STAGE_ORDER
    ]


def _set_stage(
    state: Dict[str, Any],
    key: str,
    status: str,
    *,
    detail: Optional[str] = None,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    now = _now_ms()
    for step in state["stages"]:
        if step["key"] != key:
            continue
        step["status"] = status
        if status == "running":
            step["started_at"] = step.get("started_at") or now
        if status == "completed":
            step["started_at"] = step.get("started_at") or now
            step["completed_at"] = now
        if detail is not None:
            step["detail"] = detail
        if meta:
            step["meta"] = dict(meta)
        break
    state["current_stage"] = key
    state["updated_at"] = now


def _sample_preview(personas: List[Dict[str, Any]], limit: int = 6) -> List[Dict[str, Any]]:
    return [
        {
            "persona_id": str(item.get("persona_id") or item.get("id") or ""),
            "display_name": str(item.get("display_name") or item.get("name") or ""),
            "target_audience_cluster": str(item.get("target_audience_cluster") or ""),
            "location_context": str(item.get("location_context") or item.get("location") or ""),
            "profession_role": str(item.get("profession_role") or ""),
            "attitude_baseline": str(item.get("attitude_baseline") or ""),
            "speaking_style": str(item.get("speaking_style") or ""),
            "main_concerns": list(item.get("main_concerns") or item.get("concerns") or []),
            "probable_motivations": list(item.get("probable_motivations") or item.get("motivations") or []),
            "tags": list(item.get("tags") or []),
            "summary": str(item.get("summary") or ""),
        }
        for item in personas[:limit]
        if isinstance(item, dict)
    ]


def _base_job_state(job_id: str, user_id: Optional[int], config: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "job_id": job_id,
        "user_id": user_id,
        "status": "queued",
        "current_stage": "preparing_request",
        "stages": _default_stage_state(),
        "config": config,
        "partial_results": {
            "current_persona_count": 0,
            "sample_personas": [],
            "saved_set_name": None,
            "saved_set_id": None,
            "saved_set_key": None,
        },
        "developer": {
            "current_stage": "preparing_request",
            "batch_number": 0,
            "evidence_signals_found": 0,
            "duplicate_rejection_count": 0,
            "final_persona_count": 0,
            "persistence_status": "pending",
        },
        "validation": {
            "fatal_errors": [],
            "simulation_blockers": [],
            "warnings": [],
        },
        "validation_errors": [],
        "created_at": _now_ms(),
        "updated_at": _now_ms(),
        "final_saved_set_id": None,
    }


async def _persist_job_state(state: Dict[str, Any]) -> None:
    await db_core.upsert_persona_lab_job(
        state["job_id"],
        state,
        user_id=state.get("user_id"),
        status=state.get("status"),
        current_stage=state.get("current_stage"),
        final_saved_set_id=state.get("final_saved_set_id"),
    )


def _normalize_config(payload: Dict[str, Any]) -> Dict[str, Any]:
    source_mode = str(payload.get("source_mode") or "").strip().lower()
    if source_mode not in LAB_SOURCE_MODES:
        raise ValueError("persona_source_mode_invalid")
    minimum_persona_threshold = _clamp_int(payload.get("minimum_persona_threshold"), minimum=5, maximum=50, fallback=15)
    desired_count = _clamp_int(payload.get("desired_count"), minimum=minimum_persona_threshold, maximum=50, fallback=30)
    generation_depth = str(payload.get("generation_depth") or "standard").strip().lower()
    if generation_depth not in {"standard", "deep"}:
        generation_depth = "standard"
    audience_family = _normalize_family(payload.get("target_audience_family") or payload.get("audience_family"))
    place = _normalize_text(payload.get("place"))
    saved_set_key = _normalize_text(payload.get("saved_set_key"))
    if source_mode == "audience_only" and not audience_family:
        raise ValueError("target_audience_family_required")
    if source_mode == "new_deep_search_place" and not place:
        raise ValueError("place_required")
    if source_mode == "hybrid" and (not place or not audience_family):
        raise ValueError("hybrid_requires_place_and_audience")
    if source_mode == "saved_place_reuse" and not (saved_set_key or place):
        raise ValueError("saved_set_selection_required")
    return {
        "source_mode": source_mode,
        "desired_count": desired_count,
        "minimum_persona_threshold": minimum_persona_threshold,
        "target_audience_family": audience_family,
        "place": place,
        "saved_set_key": saved_set_key,
        "generation_depth": generation_depth,
        "stubbornness_preset": _normalize_preset(payload.get("stubbornness_preset")),
        "skepticism_preset": _normalize_preset(payload.get("skepticism_preset")),
        "conformity_preset": _normalize_preset(payload.get("conformity_preset")),
        "randomness_level": _clamp_int(payload.get("randomness_level"), minimum=0, maximum=100, fallback=55),
        "speaking_style_intensity": _clamp_int(payload.get("speaking_style_intensity"), minimum=0, maximum=100, fallback=60),
        "economic_sensitivity_bias": _clamp_int(payload.get("economic_sensitivity_bias"), minimum=0, maximum=100, fallback=50),
    }


def _persona_source_mode(config: Dict[str, Any]) -> str:
    source_mode = config.get("source_mode")
    if source_mode == "audience_only":
        return PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value
    if source_mode == "saved_place_reuse":
        return PersonaSourceMode.SAVED_PLACE_PERSONAS.value
    if source_mode == "new_deep_search_place":
        return PersonaSourceMode.GENERATE_NEW_FROM_PLACE.value
    return PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value


def _persona_set_name(config: Dict[str, Any]) -> str:
    place = _normalize_text(config.get("place"))
    family = _normalize_text(config.get("target_audience_family"))
    source_mode = str(config.get("source_mode") or "")
    if source_mode == "saved_place_reuse":
        return f"Saved {place or 'place'} persona set"
    if source_mode == "hybrid":
        return f"{place} {family} persona set".strip()
    if place:
        return f"{place} persona set"
    if family:
        return f"{family.title()} persona set"
    return "Persona Lab set"


def _unique_strings(values: List[Any], *, limit: int) -> List[str]:
    items: List[str] = []
    seen: set[str] = set()
    for value in values:
        text = str(value or "").strip()
        if not text:
            continue
        lowered = text.lower()
        if lowered in seen:
            continue
        seen.add(lowered)
        items.append(text)
        if len(items) >= limit:
            break
    return items


def _persona_source_type(config: Dict[str, Any]) -> str:
    source_mode = str(config.get("source_mode") or "")
    if source_mode == "hybrid":
        return "hybrid"
    if source_mode == "audience_only":
        return "audience"
    return "place"


def _audience_structured_schema(config: Dict[str, Any]) -> Dict[str, Any]:
    family_key = config.get("target_audience_family") or "consumers"
    family = DEFAULT_AUDIENCE_FAMILIES.get(family_key) or DEFAULT_AUDIENCE_FAMILIES["consumers"]
    motivations = [str(item).strip() for item in family.get("motivations") or [] if str(item).strip()]
    concerns = [str(item).strip() for item in family.get("concerns") or [] if str(item).strip()]
    roles = [str(item).strip() for item in family.get("roles") or [] if str(item).strip()]
    speaking_styles = [str(item).strip() for item in family.get("speaking_styles") or [] if str(item).strip()]
    tags = [str(item).strip() for item in family.get("tags") or [] if str(item).strip()]
    signals = _unique_strings(motivations + concerns + roles + speaking_styles + tags, limit=18)
    return {
        "signals": signals,
        "user_types": roles[:8],
        "complaints": concerns[:8],
        "behaviors": _unique_strings(tags + speaking_styles, limit=8),
        "competition_reactions": [],
        "price_sensitivity": "high" if any("budget" in item.lower() or "price" in item.lower() for item in concerns + tags) else "medium",
        "competition_level": "",
        "demand_level": "",
        "regulatory_risk": "",
        "place_context": "",
        "target_audiences": [family_key],
        "sources": [],
        "default_audience_dataset_used": True,
        "source_mode": "audience_fallback",
    }


def _merge_structured_signals(current: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(current or {})
    for key in (
        "signals",
        "user_types",
        "complaints",
        "behaviors",
        "competition_reactions",
        "target_audiences",
        "notable_locations",
        "gaps",
    ):
        merged[key] = _unique_strings(
            list(merged.get(key) or []) + list(incoming.get(key) or []),
            limit=24,
        )
    for key in ("summary", "price_sensitivity", "competition_level", "demand_level", "regulatory_risk", "place_context"):
        if not str(merged.get(key) or "").strip() and str(incoming.get(key) or "").strip():
            merged[key] = str(incoming.get(key) or "").strip()
    existing_sources = merged.get("sources") if isinstance(merged.get("sources"), list) else []
    seen_urls = {str(item.get("url") or "").strip() for item in existing_sources if isinstance(item, dict)}
    for source in incoming.get("sources") or []:
        if not isinstance(source, dict):
            continue
        url = str(source.get("url") or "").strip()
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        existing_sources.append(
            {
                "title": str(source.get("title") or "").strip(),
                "url": url,
                "domain": str(source.get("domain") or "").strip(),
            }
        )
    merged["sources"] = existing_sources[:12]
    return merged


def _audience_dataset_report(config: Dict[str, Any]) -> ResearchReport:
    family_key = config.get("target_audience_family") or "consumers"
    family = DEFAULT_AUDIENCE_FAMILIES.get(family_key) or DEFAULT_AUDIENCE_FAMILIES["consumers"]
    schema = _audience_structured_schema(config)
    summary = f"Audience fallback dataset for {family.get('cluster')} with explicit user types, concerns, behaviors, and motivations."
    return ResearchReport(
        query_plan=[],
        evidence=[],
        summary=summary,
        findings=_unique_strings(
            list(schema.get("signals") or [])
            + list(schema.get("user_types") or [])
            + list(schema.get("complaints") or [])
            + list(schema.get("behaviors") or []),
            limit=16,
        ),
        gaps=[],
        quality={"provider": "default_audience_dataset", "usable_sources": 0, "domains": 0, "extraction_success_rate": 1.0},
        structured_schema=schema,
    )


def _search_queries(config: Dict[str, Any]) -> List[str]:
    place = _normalize_text(config.get("place"))
    family = _normalize_text(config.get("target_audience_family"))
    source_mode = str(config.get("source_mode") or "")
    if source_mode == "new_deep_search_place":
        return [
            f"{place} local community opinions",
            f"{place} customer sentiment reviews",
            f"{place} social media community groups",
            f"{place} competition and local demand",
        ]
    if source_mode == "hybrid":
        return [
            f"{place} {family} opinions and demand",
            f"{place} {family} community groups and social sentiment",
            f"{place} local competition for {family}",
            f"{place} user frustrations and buying behavior {family}",
        ]
    return []


async def _run_research(config: Dict[str, Any], state: Dict[str, Any]) -> ResearchReport:
    source_mode = str(config.get("source_mode") or "")
    if source_mode == "audience_only":
        _set_stage(state, "searching_sources", "completed", detail="Using the default audience dataset; no web search was needed.")
        _set_stage(state, "reading_sources", "completed", detail="Audience defaults were loaded directly for persona fitting.")
        return _audience_dataset_report(config)

    queries = _search_queries(config)
    max_results = 8 if config.get("generation_depth") == "deep" else 5
    raw_rows: List[Dict[str, Any]] = []
    summaries: List[str] = []
    structured_schema: Dict[str, Any] = {
        "summary": "",
        "signals": [],
        "user_types": [],
        "complaints": [],
        "behaviors": [],
        "competition_reactions": [],
        "price_sensitivity": "",
        "competition_level": "",
        "demand_level": "",
        "regulatory_risk": "",
        "place_context": _normalize_text(config.get("place")),
        "target_audiences": [_normalize_text(config.get("target_audience_family"))] if _normalize_text(config.get("target_audience_family")) else [],
        "sources": [],
        "default_audience_dataset_used": False,
    }
    seen_urls: set[str] = set()
    _set_stage(state, "searching_sources", "running", detail="Running persona-lab search queries.")
    await _persist_job_state(state)
    for index, query in enumerate(queries, start=1):
        result = await search_web(
            query=query,
            max_results=max_results,
            language="en",
            strict_web_only=True,
        )
        structured = result.get("structured") if isinstance(result.get("structured"), dict) else {}
        structured_schema = _merge_structured_signals(structured_schema, structured)
        summaries.append(_normalize_text((result.get("structured") or {}).get("summary")) or _normalize_text(result.get("answer")))
        rows = result.get("results") if isinstance(result.get("results"), list) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            url = _normalize_text(row.get("url"))
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            raw_rows.append({"query": query, "row": row})
        state["developer"]["evidence_signals_found"] = len(raw_rows)
        await _persist_job_state(state)

    _set_stage(state, "searching_sources", "completed", detail=f"Collected candidate sources from {len(queries)} persona-lab queries.")
    _set_stage(state, "reading_sources", "running", detail="Reading source snippets and extracting usable signals.")
    await _persist_job_state(state)

    evidence: List[EvidenceItem] = []
    findings: List[str] = []
    for item in raw_rows:
        row = item["row"]
        evidence.append(
            EvidenceItem(
                query=item["query"],
                title=_normalize_text(row.get("title") or row.get("url")),
                url=_normalize_text(row.get("url")),
                domain=_normalize_text(row.get("domain")),
                snippet=_normalize_text(row.get("snippet") or row.get("reason")),
                content="",
                relevance_score=float(row.get("score") or 0.0),
                http_status=int(row.get("http_status") or 200),
            )
        )
        snippet = _normalize_text(row.get("snippet") or row.get("title"))
        if snippet and snippet not in findings:
            findings.append(snippet[:220])
        structured_schema = _merge_structured_signals(
            structured_schema,
            {
                "signals": [snippet] if snippet else [],
                "sources": [
                    {
                        "title": _normalize_text(row.get("title")),
                        "url": _normalize_text(row.get("url")),
                        "domain": _normalize_text(row.get("domain")),
                    }
                ],
            },
        )
    state["developer"]["evidence_signals_found"] = len(findings)
    _set_stage(
        state,
        "reading_sources",
        "completed",
        detail=(
            f"Read {len(evidence)} unique sources for persona fitting."
            if evidence
            else "No live sources were available to read for this persona-lab request."
        ),
    )
    structured_schema["summary"] = _normalize_text(structured_schema.get("summary")) or " | ".join(part for part in summaries if part)[:1000]
    return ResearchReport(
        query_plan=[ResearchQuery(query=query, reason="persona lab research") for query in queries],
        evidence=evidence,
        summary=str(structured_schema.get("summary") or "")[:1000],
        findings=_unique_strings(
            findings
            + list(structured_schema.get("signals") or [])
            + list(structured_schema.get("user_types") or [])
            + list(structured_schema.get("complaints") or [])
            + list(structured_schema.get("behaviors") or [])
            + list(structured_schema.get("competition_reactions") or []),
            limit=20,
        ),
        gaps=[] if evidence else ["No live sources were found for the requested persona-lab configuration."],
        quality={
            "provider": "web",
            "usable_sources": len(evidence),
            "domains": len({item.domain for item in evidence if item.domain}),
            "extraction_success_rate": 1.0 if evidence else 0.0,
        },
        structured_schema=structured_schema,
    )


class _PersonaLabEventBus:
    def __init__(self, job_state: Dict[str, Any]) -> None:
        self.job_state = job_state

    async def publish(
        self,
        state: OrchestrationState,
        event_type: str,
        payload: Dict[str, Any],
        *,
        persist_research: bool = False,
    ) -> Dict[str, Any]:
        action = str(payload.get("action") or event_type or "").strip()
        meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
        self.job_state["developer"]["current_stage"] = action or self.job_state.get("current_stage")
        if action == "persona_signal_extraction_started":
            _set_stage(self.job_state, "extracting_human_patterns", "running", detail=str(payload.get("snippet") or "").strip() or None)
        elif action == "persona_signal_extraction_completed":
            self.job_state["developer"]["evidence_signals_found"] = int(meta.get("evidence_signal_count") or 0)
            _set_stage(self.job_state, "extracting_human_patterns", "completed", detail=str(payload.get("snippet") or "").strip() or None)
            _set_stage(self.job_state, "fitting_personas", "running", detail="Generating persona batches from research-backed signals.")
        elif action == "persona_batch_started":
            self.job_state["developer"]["batch_number"] = int(meta.get("batch_number") or 0)
            self.job_state["developer"]["evidence_signals_found"] = int(meta.get("evidence_signal_count") or self.job_state["developer"].get("evidence_signals_found") or 0)
            _set_stage(self.job_state, "fitting_personas", "running", detail=str(payload.get("snippet") or "").strip() or None)
        elif action == "persona_batch_completed":
            running_total = int(meta.get("running_total") or 0)
            self.job_state["partial_results"]["current_persona_count"] = running_total
            self.job_state["developer"]["final_persona_count"] = running_total
            _set_stage(self.job_state, "fitting_personas", "running", detail=f"{running_total} personas fitted so far.")
        elif action == "persona_duplicates_rejected":
            duplicates = int(meta.get("duplicate_rejection_count") or 0)
            self.job_state["developer"]["duplicate_rejection_count"] = int(self.job_state["developer"].get("duplicate_rejection_count") or 0) + duplicates
            _set_stage(self.job_state, "removing_duplicates", "completed", detail=str(payload.get("snippet") or "").strip() or None)
        elif action == "persona_validation_passed":
            _set_stage(self.job_state, "fitting_personas", "completed", detail="Persona fitting completed.")
            if self.job_state["stages"][5]["status"] == "pending":
                _set_stage(self.job_state, "removing_duplicates", "completed", detail="Duplicate filtering completed during fitting.")
            _set_stage(self.job_state, "validating", "running", detail="Validating schema completeness, uniqueness, diversity, and attribution.")
            self.job_state["developer"]["final_persona_count"] = int(meta.get("final_persona_count") or self.job_state["partial_results"].get("current_persona_count") or 0)
            _set_stage(self.job_state, "validating", "completed", detail=str(payload.get("snippet") or "").strip() or None)
        elif action == "persona_validation_blocked_for_simulation":
            _set_stage(self.job_state, "fitting_personas", "completed", detail="Persona fitting completed with simulation blockers.")
            if self.job_state["stages"][5]["status"] == "pending":
                _set_stage(self.job_state, "removing_duplicates", "completed", detail="Duplicate filtering completed during fitting.")
            self.job_state["validation"] = {
                "fatal_errors": [],
                "simulation_blockers": list(meta.get("simulation_blockers") or []),
                "warnings": [],
            }
            self.job_state["validation_errors"] = list(meta.get("simulation_blockers") or [])
            self.job_state["developer"]["final_persona_count"] = int(meta.get("final_persona_count") or self.job_state["partial_results"].get("current_persona_count") or 0)
            _set_stage(self.job_state, "validating", "completed", detail=str(payload.get("snippet") or "").strip() or None)
        elif action == "persona_validation_failed":
            fatal_errors = list(meta.get("fatal_errors") or meta.get("errors") or []) or [str(payload.get("snippet") or "persona_validation_failed").strip()]
            self.job_state["validation"] = {
                "fatal_errors": fatal_errors,
                "simulation_blockers": list(meta.get("simulation_blockers") or []),
                "warnings": list(meta.get("warnings") or []),
            }
            self.job_state["validation_errors"] = fatal_errors
            _set_stage(self.job_state, "validating", "running", detail="Validating schema completeness, uniqueness, diversity, and attribution.")
            _set_stage(self.job_state, "validating", "blocked", detail=str(payload.get("snippet") or "").strip() or None)
        elif action == "persona_persistence_started":
            self.job_state["developer"]["persistence_status"] = "running"
            _set_stage(self.job_state, "saving_persona_set", "running", detail=str(payload.get("snippet") or "").strip() or None)
        elif action == "persona_persistence_completed":
            self.job_state["developer"]["persistence_status"] = "completed"
            persona_set = meta.get("persona_set") if isinstance(meta.get("persona_set"), dict) else {}
            self.job_state["partial_results"]["saved_set_name"] = persona_set.get("place_label")
            self.job_state["partial_results"]["saved_set_id"] = persona_set.get("id")
            self.job_state["partial_results"]["saved_set_key"] = persona_set.get("set_key")
            self.job_state["final_saved_set_id"] = persona_set.get("id")
            _set_stage(self.job_state, "saving_persona_set", "completed", detail=str(payload.get("snippet") or "").strip() or None)
        await _persist_job_state(self.job_state)
        return {
            "type": event_type,
            "persist_research": persist_research,
            "payload": dict(payload),
        }

    async def publish_turn(self, state: OrchestrationState, turn: Any) -> Dict[str, Any]:
        return {"payload": {}}


def _lab_runtime(job_state: Dict[str, Any]) -> AgentRuntime:
    data_dir = Path(__file__).resolve().parents[1] / "data"
    return AgentRuntime(
        dataset=load_dataset(str(data_dir)),
        llm=LLMGateway(),
        event_bus=_PersonaLabEventBus(job_state),
        repository=SimulationRepository(),
    )


def _persona_agent(job_state: Dict[str, Any]) -> PersonaAgent:
    return PersonaAgent(_lab_runtime(job_state))


def _build_orchestration_state(job_state: Dict[str, Any], research: ResearchReport) -> OrchestrationState:
    config = job_state["config"]
    source_mode = _persona_source_mode(config)
    user_context = normalize_context(
        {
            "idea": _persona_set_name(config),
            "category": "consumer apps",
            "location": config.get("place") or "",
            "targetAudience": [config.get("target_audience_family")] if config.get("target_audience_family") else [],
            "agentCount": config.get("desired_count") or 30,
            "personaSourceMode": source_mode,
            "personaSetKey": config.get("saved_set_key") or "",
            "notes": (
                f"Persona Lab presets: stubbornness={config.get('stubbornness_preset')}, "
                f"skepticism={config.get('skepticism_preset')}, conformity={config.get('conformity_preset')}, "
                f"randomness={config.get('randomness_level')}, speaking_style_intensity={config.get('speaking_style_intensity')}, "
                f"economic_sensitivity_bias={config.get('economic_sensitivity_bias')}"
            ),
        }
    )
    orchestration_state = OrchestrationState(
        simulation_id=str(uuid.uuid4()),
        user_id=job_state.get("user_id"),
        user_context=user_context,
    )
    orchestration_state.idea_context_type = classify_idea_context(user_context).value
    orchestration_state.persona_source_mode = source_mode
    orchestration_state.persona_source_auto_selected = False
    orchestration_state.research = research
    orchestration_state.search_completed = True
    orchestration_state.schema["persona_count_requested"] = int(config.get("desired_count") or 30)
    orchestration_state.schema["allow_lower_persona_target"] = bool(int(config.get("desired_count") or 30) < 30)
    orchestration_state.schema["minimum_persona_threshold"] = int(config.get("minimum_persona_threshold") or 15)
    return orchestration_state


async def _complete_saved_reuse(job_state: Dict[str, Any]) -> None:
    config = job_state["config"]
    set_key = _normalize_text(config.get("saved_set_key"))
    place = _normalize_text(config.get("place"))
    record = None
    if set_key:
        record = await db_core.fetch_persona_library_record_by_set_key(
            user_id=job_state.get("user_id"),
            set_key=set_key,
        )
    if record is None and place:
        record = await db_core.fetch_persona_library_record(
            user_id=job_state.get("user_id"),
            place_key=_slug(place),
        )
    if record is None:
        raise RuntimeError("No saved persona set matched the selected place or set key.")

    name = _normalize_text((record.get("payload") or {}).get("title")) or _normalize_text(record.get("place_label")) or "Saved persona set"
    personas = (record.get("payload") or {}).get("personas") if isinstance((record.get("payload") or {}).get("personas"), list) else []
    validation_meta = dict(record.get("validation_meta") or {})
    _set_stage(job_state, "preparing_request", "completed", detail="Validated the saved persona-set request.")
    _set_stage(job_state, "searching_sources", "completed", detail="Reused a saved persona set; no new search was required.")
    _set_stage(job_state, "reading_sources", "completed", detail="Reused the saved set metadata and evidence summary.")
    _set_stage(job_state, "extracting_human_patterns", "completed", detail="Loaded existing fitted patterns from the saved set.")
    _set_stage(job_state, "fitting_personas", "completed", detail="Reused an existing persona set instead of generating a new one.")
    _set_stage(job_state, "removing_duplicates", "completed", detail="The saved set was already deduplicated.")
    _set_stage(job_state, "validating", "completed", detail="Validated the reused persona set for availability and completeness.")
    _set_stage(job_state, "saving_persona_set", "completed", detail="The persona set was already stored in the shared library.")
    _set_stage(job_state, "completed", "completed", detail=f"Ready to reuse {name}.")
    job_state["status"] = "completed"
    job_state["partial_results"]["current_persona_count"] = int(record.get("persona_count") or len(personas))
    job_state["partial_results"]["sample_personas"] = _sample_preview(personas)
    job_state["partial_results"]["saved_set_name"] = name
    job_state["partial_results"]["saved_set_id"] = record.get("id")
    job_state["partial_results"]["saved_set_key"] = record.get("set_key")
    job_state["developer"]["final_persona_count"] = int(record.get("persona_count") or len(personas))
    job_state["developer"]["persistence_status"] = "completed"
    job_state["final_saved_set_id"] = record.get("id")
    job_state["validation"] = {
        "fatal_errors": list(validation_meta.get("fatal_errors") or []),
        "simulation_blockers": list(validation_meta.get("simulation_blockers") or []),
        "warnings": list(validation_meta.get("warnings") or []),
    }
    job_state["validation_errors"] = list(dict.fromkeys(job_state["validation"]["fatal_errors"] + job_state["validation"]["simulation_blockers"]))
    await _persist_job_state(job_state)


async def _run_generation_job(job_state: Dict[str, Any]) -> None:
    _set_stage(job_state, "preparing_request", "running", detail="Normalizing the Persona Lab request.")
    job_state["status"] = "running"
    await _persist_job_state(job_state)
    config = job_state["config"]
    if config.get("source_mode") == "saved_place_reuse":
        await _complete_saved_reuse(job_state)
        return

    _set_stage(job_state, "preparing_request", "completed", detail="Persona Lab request is ready.")
    await _persist_job_state(job_state)
    research = await _run_research(config, job_state)
    await _persist_job_state(job_state)

    orchestration_state = _build_orchestration_state(job_state, research)
    agent = _persona_agent(job_state)
    orchestration_state = await agent.run(orchestration_state)
    orchestration_state = await agent.persist(orchestration_state)

    personas = [persona.to_dict() for persona in orchestration_state.personas]
    job_state["status"] = "completed"
    _set_stage(job_state, "completed", "completed", detail=f"Generated and saved {len(personas)} personas.")
    job_state["partial_results"]["current_persona_count"] = len(personas)
    job_state["partial_results"]["sample_personas"] = _sample_preview(personas)
    job_state["partial_results"]["saved_set_name"] = orchestration_state.persona_set.get("place_label") if orchestration_state.persona_set else _persona_set_name(config)
    job_state["partial_results"]["saved_set_id"] = orchestration_state.persona_set.get("id") if orchestration_state.persona_set else None
    job_state["partial_results"]["saved_set_key"] = orchestration_state.persona_set.get("set_key") if orchestration_state.persona_set else None
    job_state["developer"]["final_persona_count"] = len(personas)
    job_state["developer"]["persistence_status"] = "completed" if orchestration_state.persona_persistence_completed else "failed"
    validation = dict((orchestration_state.persona_generation_debug or {}).get("validation") or {})
    job_state["validation"] = {
        "fatal_errors": list(validation.get("fatal_errors") or []),
        "simulation_blockers": list(validation.get("simulation_blockers") or []),
        "warnings": list(validation.get("warnings") or []),
    }
    job_state["validation_errors"] = list(dict.fromkeys(job_state["validation"]["fatal_errors"] + job_state["validation"]["simulation_blockers"]))
    job_state["final_saved_set_id"] = orchestration_state.persona_set.get("id") if orchestration_state.persona_set else None
    await _persist_job_state(job_state)


async def _run_job(job_id: str) -> None:
    state = await db_core.fetch_persona_lab_job(job_id)
    if not state:
        return
    try:
        await _run_generation_job(state)
    except Exception as exc:
        state["status"] = "failed"
        state["validation"] = {
            "fatal_errors": [str(exc).strip() or "Persona Lab generation failed."],
            "simulation_blockers": [],
            "warnings": [],
        }
        state["validation_errors"] = list(state["validation"]["fatal_errors"])
        _set_stage(state, state.get("current_stage") or "preparing_request", "blocked", detail=state["validation_errors"][0])
        await _persist_job_state(state)


def _track_task(job_id: str, task: asyncio.Task[None]) -> None:
    _JOB_TASKS[job_id] = task

    def _cleanup(_: asyncio.Task[None]) -> None:
        _JOB_TASKS.pop(job_id, None)

    task.add_done_callback(_cleanup)


async def start_persona_lab_job(*, user_id: Optional[int], payload: Dict[str, Any]) -> Dict[str, Any]:
    config = _normalize_config(payload)
    job_id = str(uuid.uuid4())
    state = _base_job_state(job_id, user_id, config)
    await _persist_job_state(state)
    task = asyncio.create_task(_run_job(job_id))
    _track_task(job_id, task)
    return state


async def get_persona_lab_job(*, user_id: Optional[int], job_id: str) -> Optional[Dict[str, Any]]:
    return await db_core.fetch_persona_lab_job(job_id, user_id=user_id)


async def list_persona_lab_jobs(*, user_id: Optional[int], limit: int = 20) -> List[Dict[str, Any]]:
    return await db_core.list_persona_lab_jobs(user_id=user_id, limit=limit)


async def list_persona_sets(
    *,
    user_id: Optional[int],
    place_query: Optional[str] = None,
    audience: Optional[str] = None,
    source_type: Optional[str] = None,
    reusable_only: bool = False,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    min_count: Optional[int] = None,
    max_count: Optional[int] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    items = await db_core.list_persona_library_records(
        user_id=user_id,
        place_query=place_query,
        audience=audience,
        date_from=date_from,
        date_to=date_to,
        min_count=min_count,
        max_count=max_count,
        limit=limit,
    )
    normalized_source_type = _normalize_text(source_type).lower()
    if normalized_source_type:
        items = [item for item in items if str(item.get("source_type") or "").strip().lower() == normalized_source_type]
    if reusable_only:
        items = [item for item in items if bool(item.get("reusable"))]
    return items


async def get_persona_set(*, user_id: Optional[int], set_key: str) -> Optional[Dict[str, Any]]:
    return await db_core.fetch_persona_library_record_by_set_key(user_id=user_id, set_key=set_key)
