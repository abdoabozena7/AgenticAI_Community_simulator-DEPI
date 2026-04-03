from __future__ import annotations

import asyncio
import hashlib
import math
import os
import random
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..models.orchestration import (
    IdeaContextType,
    OrchestrationState,
    PersonaProfile,
    PersonaSourceMode,
    apply_persona_dynamic_defaults,
    context_location_label,
)
from ..services.evidence_ladder import ensure_evidence_ladder, find_evidence_by_text, summarize_evidence_confidence
from .base import BaseAgent


DEFAULT_AUDIENCE_FAMILIES: Dict[str, Dict[str, Any]] = {
    "gen z": {
        "cluster": "Gen Z",
        "age_bands": ["18-24", "22-29"],
        "life_stages": ["student", "early career"],
        "roles": ["student", "junior marketer", "content creator", "retail worker"],
        "speaking_styles": ["fast and casual", "meme-aware", "direct but playful"],
        "motivations": ["identity fit", "social proof", "speed", "novelty"],
        "concerns": ["price spikes", "cringe branding", "low authenticity", "poor UX"],
        "tags": ["mobile-first", "trend-aware", "social"],
    },
    "working professionals": {
        "cluster": "Working Professionals",
        "age_bands": ["25-34", "30-44"],
        "life_stages": ["career building", "mid-career"],
        "roles": ["project manager", "operations lead", "account manager", "analyst"],
        "speaking_styles": ["concise and practical", "structured", "time-aware"],
        "motivations": ["time savings", "reliability", "career upside", "predictable service"],
        "concerns": ["workflow disruption", "hidden cost", "slow support", "switching friction"],
        "tags": ["time-poor", "comparison shopper", "outcome-driven"],
    },
    "students": {
        "cluster": "Students",
        "age_bands": ["18-24", "20-27"],
        "life_stages": ["undergraduate", "postgraduate"],
        "roles": ["university student", "teaching assistant", "intern"],
        "speaking_styles": ["curious and quick", "casual", "community-oriented"],
        "motivations": ["affordability", "peer usage", "learning value", "flexibility"],
        "concerns": ["budget pressure", "confusing onboarding", "poor convenience", "weak trust"],
        "tags": ["budget-sensitive", "peer-influenced", "campus"],
    },
    "parents": {
        "cluster": "Parents",
        "age_bands": ["30-44", "35-49"],
        "life_stages": ["raising children", "family balancing"],
        "roles": ["parent", "school administrator", "household manager"],
        "speaking_styles": ["protective and practical", "trust-first", "clear"],
        "motivations": ["safety", "reliability", "family convenience", "value for money"],
        "concerns": ["safety risk", "low trust", "poor support", "inconsistent quality"],
        "tags": ["family", "risk-aware", "trust-seeking"],
    },
    "developers": {
        "cluster": "Developers",
        "age_bands": ["22-34", "28-40"],
        "life_stages": ["early technical career", "senior builder"],
        "roles": ["software engineer", "tech lead", "indie hacker", "developer advocate"],
        "speaking_styles": ["technical and skeptical", "precise", "evidence-heavy"],
        "motivations": ["technical elegance", "control", "documentation quality", "speed to build"],
        "concerns": ["vendor lock-in", "poor docs", "API instability", "security gaps"],
        "tags": ["technical", "builder", "tooling"],
    },
    "small business owners": {
        "cluster": "Small Business Owners",
        "age_bands": ["30-44", "35-55"],
        "life_stages": ["owner-operator", "scaling operator"],
        "roles": ["shop owner", "restaurant owner", "agency founder", "clinic operator"],
        "speaking_styles": ["blunt and commercial", "numbers-first", "street-level practical"],
        "motivations": ["cash flow", "customer retention", "operational simplicity", "growth"],
        "concerns": ["unclear ROI", "execution burden", "staff adoption", "weak differentiation"],
        "tags": ["commercial", "ROI-focused", "operational"],
    },
    "investors": {
        "cluster": "Investors",
        "age_bands": ["30-49", "35-55"],
        "life_stages": ["angel investing", "portfolio building"],
        "roles": ["angel investor", "fund analyst", "operator-investor"],
        "speaking_styles": ["probing and analytical", "thesis-driven", "signal-focused"],
        "motivations": ["upside", "defensibility", "market timing", "founder quality"],
        "concerns": ["weak moat", "unclear demand", "regulatory drag", "slow growth"],
        "tags": ["capital", "market-sizing", "thesis"],
    },
    "creators": {
        "cluster": "Creators",
        "age_bands": ["20-34", "25-39"],
        "life_stages": ["growing audience", "independent creator"],
        "roles": ["content creator", "designer", "video editor", "brand collaborator"],
        "speaking_styles": ["expressive", "trend-aware", "brand-sensitive"],
        "motivations": ["audience growth", "creative freedom", "brand fit", "distribution"],
        "concerns": ["algorithm risk", "brand mismatch", "price pressure", "clunky tools"],
        "tags": ["creative", "audience-led", "brand-aware"],
    },
    "consumers": {
        "cluster": "Consumers",
        "age_bands": ["21-34", "30-44"],
        "life_stages": ["household buyer", "habit builder"],
        "roles": ["consumer", "subscriber", "local shopper"],
        "speaking_styles": ["simple and comparative", "value-focused", "experience-led"],
        "motivations": ["convenience", "trust", "price-value balance", "habit fit"],
        "concerns": ["hidden fees", "poor support", "low convenience", "quality inconsistency"],
        "tags": ["value-conscious", "convenience", "habit"],
    },
    "enterprises": {
        "cluster": "Enterprise Buyers",
        "age_bands": ["28-45", "35-50"],
        "life_stages": ["team lead", "budget owner"],
        "roles": ["procurement lead", "department head", "operations manager", "IT buyer"],
        "speaking_styles": ["formal and risk-aware", "procurement-minded", "structured"],
        "motivations": ["risk reduction", "integration", "measurable ROI", "vendor stability"],
        "concerns": ["security", "compliance", "slow rollout", "weak change management"],
        "tags": ["B2B", "risk-aware", "integration"],
    },
}


class PersonaAgent(BaseAgent):
    name = "persona_agent"
    HARD_MAX_PERSONAS = 50
    TARGET_MIN_PERSONAS = 30
    BATCH_SIZE = 10
    LLM_CALL_BUDGET_SECONDS = 10.0

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        if not state.search_completed or state.research is None:
            raise RuntimeError("Persona generation requires completed search results")
        state.refresh_persona_source_resolution()
        if not state.persona_source_mode:
            raise RuntimeError("Persona source is unresolved")
        memory_provider = getattr(self.runtime, "memory_provider", None)
        memory_context: Dict[str, Any] = {}
        if memory_provider is not None:
            memory_context = await memory_provider.retrieve_for_persona_generation(state)

        place_label = context_location_label(state.user_context)
        requested_count = self._target_persona_count(state)
        state.persona_set = None
        state.persona_validation_errors = []
        state.persona_generation_debug = {}
        saved_persona_hints: List[PersonaProfile] = []
        saved_hint_report: Dict[str, Any] = {}
        if state.persona_source_mode == PersonaSourceMode.SAVED_PLACE_PERSONAS.value:
            saved_persona_hints, saved_hint_report = await self._load_saved_personas(
                state=state,
                place_label=place_label or "global",
            )

        state.set_pipeline_step(
            "extracting_people_patterns",
            "running",
            detail="Analyzing research evidence, social sentiment, and audience signals.",
        )
        await self._publish_persona_event(
            state,
            action="persona_signal_extraction_started",
            status="running",
            title="Persona signal extraction",
            snippet="Extracting evidence signals, social sentiment, and audience context.",
            progress_pct=12,
        )
        signal_plan = await self._build_signal_plan(
            state=state,
            place_label=place_label or "global",
            memory_context=memory_context,
            saved_persona_hints=saved_persona_hints,
        )
        requested_count = self._coverage_target_count(state, signal_plan=signal_plan, requested_count=requested_count)
        pattern_summary = self._pattern_summary(signal_plan)
        state.schema["people_pattern_summary"] = pattern_summary
        state.set_pipeline_step("extracting_people_patterns", "completed", detail=pattern_summary[:220])
        await self._publish_persona_event(
            state,
            action="persona_signal_extraction_completed",
            status="ok",
            title="Persona signal extraction complete",
            snippet=pattern_summary[:320],
            progress_pct=24,
            meta={
                "evidence_signal_count": len(signal_plan.get("evidence_signals") or []),
                "audience_cluster_count": len(signal_plan.get("audience_clusters") or []),
                "social_sentiment": signal_plan.get("social_sentiment") or {},
                "dynamic_segment_count": len(signal_plan.get("dynamic_segments") or []),
            },
        )

        state.set_pipeline_step(
            "generating_personas",
            "running",
            detail=f"Generating simulation-ready personas from {state.persona_source_mode}.",
        )

        personas, report = await self._generate_personas(
            state=state,
            signal_plan=signal_plan,
            requested_count=requested_count,
            place_label=place_label or "global",
        )
        personas = [apply_persona_dynamic_defaults(persona) for persona in personas]

        validation = self._validate_personas(
            personas=personas,
            signal_plan=signal_plan,
            state=state,
            target_count=requested_count,
            strict_target=self._has_enough_data(state),
        )
        auto_completion_report: Dict[str, Any] = {}
        if validation.get("simulation_blockers") and not validation.get("fatal_errors"):
            personas, signal_plan, auto_completion_report = await self._auto_complete_personas_for_simulation(
                state=state,
                personas=personas,
                signal_plan=signal_plan,
                place_label=place_label or "global",
                target_count=requested_count,
                validation=validation,
            )
            personas = [apply_persona_dynamic_defaults(persona) for persona in personas]
            validation = self._validate_personas(
                personas=personas,
                signal_plan=signal_plan,
                state=state,
                target_count=requested_count,
                strict_target=self._has_enough_data(state),
            )
        state.persona_validation_errors = list(dict.fromkeys((validation.get("fatal_errors") or []) + (validation.get("simulation_blockers") or [])))
        report["validation"] = validation
        report["auto_completion"] = auto_completion_report
        report["social_sentiment"] = signal_plan.get("social_sentiment") or {}
        report["evidence_signals"] = signal_plan.get("evidence_signals") or []
        report["structured_signal_catalog"] = signal_plan.get("signal_catalog") or []
        report["market_grounding"] = signal_plan.get("market_grounding") or {}
        report["dynamic_segments"] = signal_plan.get("dynamic_segments") or []
        report["archetype_guardrails_used"] = signal_plan.get("archetype_guardrails_used") or []
        report["saved_persona_hints"] = {
            "used": bool(saved_persona_hints),
            "count": len(saved_persona_hints),
            "source_summary": str(saved_hint_report.get("source_summary") or ""),
        }
        report["target_count"] = requested_count
        report["actual_count"] = len(personas)
        report["source_mode"] = state.persona_source_mode
        report["source_type"] = self._source_type_label(state, saved_persona_hints=saved_persona_hints)
        report["calibration_report"] = validation
        state.persona_generation_debug = report
        state.schema["persona_generation_report"] = report
        state.schema["persona_count_actual"] = len(personas)
        state.schema["persona_source"] = state.persona_source_mode
        state.schema["minimum_persona_threshold"] = self._minimum_persona_threshold(state)

        state.schema["persona_validation"] = {
            "fatal_errors": list(validation.get("fatal_errors") or []),
            "simulation_blockers": list(validation.get("simulation_blockers") or []),
            "warnings": list(validation.get("warnings") or []),
        }

        if validation.get("fatal_errors"):
            await self._publish_persona_event(
                state,
                action="persona_validation_failed",
                status="failed",
                title="Persona validation failed",
                snippet=" | ".join(validation.get("fatal_errors") or [])[:320],
                progress_pct=86,
                meta=validation,
            )
            raise RuntimeError(f"Persona validation failed: {', '.join(validation.get('fatal_errors') or [])}")

        state.personas = personas
        state.refresh_persona_source_resolution()
        report["source_mode"] = state.persona_source_mode
        state.persona_generation_completed = True
        state.set_pipeline_step("generating_personas", "completed", detail=report.get("message") or f"Generated {len(personas)} personas.")
        validation_action = "persona_validation_passed"
        validation_status = "ok"
        validation_title = "Persona validation passed"
        validation_snippet = report.get("message") or f"Generated {len(personas)} simulation-ready personas."
        if validation.get("simulation_blockers"):
            validation_action = "persona_validation_blocked_for_simulation"
            validation_status = "warning"
            validation_title = "Persona set saved with simulation blockers"
            validation_snippet = " | ".join(validation.get("simulation_blockers") or [])[:320]
        await self._publish_persona_event(
            state,
            action=validation_action,
            status=validation_status,
            title=validation_title,
            snippet=validation_snippet,
            progress_pct=90,
            meta={
                "duplicate_rejection_count": report.get("duplicate_rejection_count", 0),
                "final_persona_count": len(personas),
                "diversity": validation.get("diversity"),
                "diversity_score": validation.get("diversity_score"),
                "simulation_blockers": validation.get("simulation_blockers") or [],
            },
        )
        return state

    async def persist(self, state: OrchestrationState) -> OrchestrationState:
        state.refresh_persona_source_resolution()
        if not state.persona_source_mode:
            raise RuntimeError("Persona source is unresolved")
        if not state.persona_generation_completed or not state.personas:
            raise RuntimeError("Persona generation must finish before persistence")
        memory_provider = getattr(self.runtime, "memory_provider", None)
        validation_meta = dict((state.persona_generation_debug or {}).get("validation") or {})
        fatal_errors = [str(item).strip() for item in validation_meta.get("fatal_errors") or [] if str(item).strip()]
        if fatal_errors:
            raise RuntimeError(f"Persona persistence blocked by validation errors: {', '.join(fatal_errors)}")

        place_label = context_location_label(state.user_context)
        library_label = self._library_label(state, place_label)
        place_key = self._place_key(library_label)
        audience_filters = self._normalized_audiences(state)
        fingerprint = self._fingerprint(state)
        generation_report = dict(state.persona_generation_debug or {})
        source_type = self._source_type_label(state)
        place_name = place_label or None
        audience_type = ", ".join(audience_filters) if audience_filters else None

        state.set_pipeline_step("saving_personas", "running", detail="Persisting persona records and the shared persona set.")
        await self._publish_persona_event(
            state,
            action="persona_persistence_started",
            status="running",
            title="Persisting persona asset",
            snippet="Saving persona records, set metadata, and reusable asset references.",
            progress_pct=92,
        )

        await self.runtime.repository.upsert_persona_library_record(
            user_id=state.user_id,
            place_key=place_key,
            place_label=library_label,
            scope="shared",
            source_policy=state.persona_source_mode,
            audience_filters=audience_filters,
            source_summary=str(generation_report.get("source_summary") or ""),
            evidence_summary={
                "signals": generation_report.get("evidence_signals") or [],
                "user_types": generation_report.get("user_types") or [],
                "complaints": generation_report.get("complaints") or [],
                "behaviors": generation_report.get("behaviors") or [],
                "competition_reactions": generation_report.get("competition_reactions") or [],
                "social_sentiment": generation_report.get("social_sentiment") or {},
                "research_summary": str((state.research.summary if state.research else "") or ""),
                "market_grounding": generation_report.get("market_grounding") or {},
            },
            generation_config={
                "requested_count": generation_report.get("target_count"),
                "actual_count": generation_report.get("actual_count"),
                "batch_size": generation_report.get("batch_size"),
                "batch_count": generation_report.get("batch_count"),
                "context_type": state.idea_context_type,
                "source_mode": state.persona_source_mode,
                "source_type": source_type,
                "place_name": place_name,
                "audience_type": audience_type,
                "minimum_persona_threshold": self._minimum_persona_threshold(state),
                "dynamic_segments": generation_report.get("dynamic_segments") or [],
                "reusable": True,
            },
            quality_score=float(generation_report.get("quality_score") or 0.0),
            confidence_score=float(generation_report.get("confidence_score") or 0.0),
            quality_meta=dict(generation_report.get("quality_meta") or {}),
            validation_meta=dict(generation_report.get("validation") or {}),
            reusable_dataset_ref=fingerprint,
            context_type=state.idea_context_type,
            payload={
                "title": library_label,
                "place_key": place_key,
                "place_label": library_label,
                "scope": "shared",
                "source_policy": state.persona_source_mode,
                "source": "generated",
                "audience_filters": audience_filters,
                "personas": [persona.to_dict() for persona in state.personas],
                "meta": {
                    "fingerprint": fingerprint,
                    "idea": state.user_context.get("idea"),
                    "category": state.user_context.get("category"),
                    "context_type": state.idea_context_type,
                    "audience_filters": audience_filters,
                    "source_type": source_type,
                    "place_name": place_name,
                    "audience_type": audience_type,
                    "source_summary": generation_report.get("source_summary"),
                    "market_grounding": generation_report.get("market_grounding") or {},
                    "dynamic_segments": generation_report.get("dynamic_segments") or [],
                    "archetype_guardrails_used": generation_report.get("archetype_guardrails_used") or [],
                    "calibration_report": generation_report.get("calibration_report") or {},
                    "saved_persona_hints": generation_report.get("saved_persona_hints") or {},
                    "evidence_summary": {
                        "signals": generation_report.get("evidence_signals") or [],
                        "user_types": generation_report.get("user_types") or [],
                        "complaints": generation_report.get("complaints") or [],
                        "behaviors": generation_report.get("behaviors") or [],
                        "competition_reactions": generation_report.get("competition_reactions") or [],
                        "social_sentiment": generation_report.get("social_sentiment") or {},
                    },
                    "generation_config": {
                        "requested_count": generation_report.get("target_count"),
                        "actual_count": generation_report.get("actual_count"),
                        "batch_size": generation_report.get("batch_size"),
                        "batch_count": generation_report.get("batch_count"),
                        "minimum_persona_threshold": self._minimum_persona_threshold(state),
                        "reusable": True,
                    },
                    "quality_score": generation_report.get("quality_score"),
                    "confidence_score": generation_report.get("confidence_score"),
                    "quality_meta": generation_report.get("quality_meta") or {},
                    "validation_meta": generation_report.get("validation") or {},
                    "reusable_dataset_ref": fingerprint,
                    "reusable": True,
                },
            },
        )

        record = await self.runtime.repository.fetch_persona_library_record(
            user_id=state.user_id,
            place_key=place_key,
            audience_filters=audience_filters,
            source_mode=state.persona_source_mode,
        )
        state.persona_set = {
            "id": (record or {}).get("id"),
            "set_key": (record or {}).get("set_key"),
            "place_key": (record or {}).get("place_key") or place_key,
            "place_label": (record or {}).get("place_label") or library_label,
            "audience_filters": (record or {}).get("audience_filters") or audience_filters,
            "created_at": (record or {}).get("created_at"),
            "updated_at": (record or {}).get("updated_at"),
            "persona_count": (record or {}).get("persona_count") or len(state.personas),
            "quality_score": (record or {}).get("quality_score") or generation_report.get("quality_score"),
            "confidence_score": (record or {}).get("confidence_score") or generation_report.get("confidence_score"),
            "reusable_dataset_ref": (record or {}).get("reusable_dataset_ref") or fingerprint,
            "source_summary": (record or {}).get("source_summary") or generation_report.get("source_summary"),
            "source_type": source_type,
            "place_name": place_name,
            "audience_type": audience_type,
            "reusable": True,
        }

        has_simulation_row = (
            await self.runtime.repository.simulation_exists(state.simulation_id)
            if str(state.simulation_id or "").strip()
            else False
        )

        if has_simulation_row:
            await self.runtime.repository.persist_personas(
                state.simulation_id,
                [persona.to_agent_row() for persona in state.personas],
            )

        state.refresh_persona_source_resolution()
        state.persona_persistence_completed = True
        blockers = state.validate_pipeline_ready_for_simulation()
        persistence_detail = (
            f"Saved {len(state.personas)} personas and shared persona set metadata."
            if has_simulation_row
            else f"Saved shared persona set metadata for {len(state.personas)} personas. Simulation agent rows will be created when the simulation starts."
        )
        state.set_pipeline_step(
            "saving_personas",
            "completed",
            detail=(
                persistence_detail
                if not blockers
                else f"{persistence_detail} Simulation is still blocked: {', '.join(blockers)}"
            ),
        )
        await self._publish_persona_event(
            state,
            action="persona_persistence_completed",
            status="ok",
            title="Persona asset saved",
            snippet=(
                f"Saved {len(state.personas)} personas. Shared set: {state.persona_set.get('place_label')}."
                if has_simulation_row
                else f"Saved shared persona set: {state.persona_set.get('place_label')}. Simulation agent rows are deferred until simulation start."
            ),
            progress_pct=100,
            meta={
                "final_persona_count": len(state.personas),
                "persistence_status": "completed",
                "persona_set": state.persona_set,
                "simulation_agent_rows_persisted": has_simulation_row,
            },
        )
        if has_simulation_row and memory_provider is not None:
            await memory_provider.ingest_personas(state)
        return state

    async def _load_saved_personas(
        self,
        *,
        state: OrchestrationState,
        place_label: str,
    ) -> Tuple[List[PersonaProfile], Dict[str, Any]]:
        selected_set_key = str(state.user_context.get("personaSetKey") or "").strip()
        record = None
        if selected_set_key:
            record = await self.runtime.repository.fetch_persona_library_record_by_set_key(
                user_id=state.user_id,
                set_key=selected_set_key,
            )
        if record is None:
            record = await self.runtime.repository.fetch_persona_library_record(
                user_id=state.user_id,
                place_key=self._place_key(self._library_label(state, place_label)),
                audience_filters=self._normalized_audiences(state),
                source_mode=None,
            )
        payload = (record or {}).get("payload") if isinstance(record, dict) else None
        personas = self._hydrate_personas(payload if isinstance(payload, dict) else {})
        if not personas:
            raise RuntimeError("Saved place personas were requested but no reusable persona set was found")
        report = {
            "mode": state.persona_source_mode,
            "batch_size": 0,
            "batch_count": 0,
            "duplicate_rejection_count": 0,
            "weak_rejection_count": 0,
            "quality_score": float((record or {}).get("quality_score") or 0.0),
            "confidence_score": float((record or {}).get("confidence_score") or 0.0),
            "quality_meta": dict((record or {}).get("quality_meta") or {}),
            "message": f"Loaded {len(personas)} saved shared personas for {str((record or {}).get('place_label') or place_label)}.",
            "source_summary": str((record or {}).get("source_summary") or ""),
            "source_type": str((((record or {}).get("payload") or {}).get("meta") or {}).get("source_type") or "saved_hints_assisted"),
            "place_name": str((((record or {}).get("payload") or {}).get("meta") or {}).get("place_name") or str((record or {}).get("place_label") or place_label)),
            "audience_type": str((((record or {}).get("payload") or {}).get("meta") or {}).get("audience_type") or ", ".join(self._normalized_audiences(state))),
        }
        return personas, report

    async def _generate_personas(
        self,
        *,
        state: OrchestrationState,
        signal_plan: Dict[str, Any],
        requested_count: int,
        place_label: str,
    ) -> Tuple[List[PersonaProfile], Dict[str, Any]]:
        enough_data = self._has_enough_data(state)
        target_count = min(self.HARD_MAX_PERSONAS, requested_count)
        batch_count = max(1, math.ceil(target_count / self.BATCH_SIZE))
        oversample = self._oversample_padding(signal_plan.get("confidence_score"))
        personas: List[PersonaProfile] = []
        duplicate_rejection_count = 0
        weak_rejection_count = 0
        signatures: set[str] = set()
        used_names: set[str] = set()

        for batch_index in range(batch_count):
            remaining = target_count - len(personas)
            if remaining <= 0:
                break
            batch_goal = min(self.BATCH_SIZE, remaining)
            await self._publish_persona_event(
                state,
                action="persona_batch_started",
                status="running",
                title=f"Persona batch {batch_index + 1}",
                snippet=f"Generating batch {batch_index + 1} of {batch_count}.",
                progress_pct=min(70, 28 + batch_index * 10),
                meta={
                    "batch_number": batch_index + 1,
                    "batch_count": batch_count,
                    "requested_in_batch": batch_goal,
                    "evidence_signal_count": len(signal_plan.get("evidence_signals") or []),
                },
            )
            blueprint = await self._generate_batch_blueprint(
                state=state,
                signal_plan=signal_plan,
                batch_number=batch_index + 1,
                batch_count=batch_count,
                batch_goal=batch_goal + oversample,
                existing_names=sorted(used_names)[:20],
            )
            batch_personas, rejected = self._materialize_personas(
                state=state,
                blueprint=blueprint,
                signal_plan=signal_plan,
                place_label=place_label,
                requested_count=batch_goal,
                signatures=signatures,
                used_names=used_names,
                seed_offset=batch_index * self.BATCH_SIZE,
            )
            duplicate_rejection_count += rejected["duplicate"]
            weak_rejection_count += rejected["weak"]
            personas.extend(batch_personas)
            await self._publish_persona_event(
                state,
                action="persona_batch_completed",
                status="ok",
                title=f"Persona batch {batch_index + 1} complete",
                snippet=f"Accepted {len(batch_personas)} personas from batch {batch_index + 1}.",
                progress_pct=min(84, 34 + (batch_index + 1) * 10),
                meta={
                    "batch_number": batch_index + 1,
                    "batch_count": batch_count,
                    "accepted_count": len(batch_personas),
                    "duplicate_rejection_count": rejected["duplicate"],
                    "weak_rejection_count": rejected["weak"],
                    "running_total": len(personas),
                },
            )
            if rejected["duplicate"]:
                await self._publish_persona_event(
                    state,
                    action="persona_duplicates_rejected",
                    status="ok",
                    title="Duplicate personas rejected",
                    snippet=f"Rejected {rejected['duplicate']} duplicate personas in batch {batch_index + 1}.",
                    progress_pct=min(84, 36 + (batch_index + 1) * 10),
                    meta={"batch_number": batch_index + 1, "duplicate_rejection_count": rejected["duplicate"]},
                )

        actual_count = len(personas)
        quality_score = self._quality_score(
            actual_count=actual_count,
            requested_count=target_count,
            duplicates=duplicate_rejection_count,
            weak=weak_rejection_count,
            enough_data=enough_data,
        )
        confidence_score = round(
            min(0.95, max(0.32, 0.4 + (0.2 if enough_data else 0.0) + min(0.22, len(signal_plan.get("evidence_signals") or []) * 0.02))),
            3,
        )
        confidence_score = round(
            self._clamp(
                (0.7 * confidence_score) + (0.3 * float(signal_plan.get("confidence_score") or 0.0)),
                0.32,
                0.95,
                fallback=confidence_score,
            ),
            3,
        )
        if enough_data and actual_count < self.TARGET_MIN_PERSONAS:
            message = f"Only {actual_count} personas passed validation despite sufficient research. Validation will block simulation."
        elif actual_count < self.TARGET_MIN_PERSONAS:
            message = f"insufficient data for full diversity; generated the maximum reliable set of {actual_count} personas."
        else:
            message = f"Generated {actual_count} diverse personas grounded in research signals."
        return personas, {
            "mode": state.persona_source_mode,
            "batch_size": self.BATCH_SIZE,
            "batch_count": batch_count,
            "duplicate_rejection_count": duplicate_rejection_count,
            "weak_rejection_count": weak_rejection_count,
            "quality_score": quality_score,
            "confidence_score": confidence_score,
            "quality_meta": {
                "enough_data": enough_data,
                "signal_count": len(signal_plan.get("evidence_signals") or []),
                "audience_cluster_count": len(signal_plan.get("audience_clusters") or []),
                "dynamic_segment_count": len(signal_plan.get("dynamic_segments") or []),
            },
            "message": message,
            "source_summary": self._source_summary(signal_plan),
            "user_types": list(signal_plan.get("user_types") or []),
            "complaints": list(signal_plan.get("complaints") or []),
            "behaviors": list(signal_plan.get("behaviors") or []),
            "competition_reactions": list(signal_plan.get("competition_reactions") or []),
        }

    async def _build_signal_plan(
        self,
        *,
        state: OrchestrationState,
        place_label: str,
        memory_context: Optional[Dict[str, Any]] = None,
        saved_persona_hints: Optional[Sequence[PersonaProfile]] = None,
    ) -> Dict[str, Any]:
        structured_inputs = self._structured_persona_inputs(state)
        memory_context = memory_context or {}
        saved_persona_hints = list(saved_persona_hints or [])
        ladder_confidence = float((structured_inputs.get("evidence_confidence") or {}).get("score") or 0.0)
        evidence_signals = list(structured_inputs.get("evidence_signals") or [])
        evidence_signals.extend(str(item).strip() for item in memory_context.get("confirmed_signals") or [] if str(item).strip())
        social_sentiment = dict(structured_inputs.get("social_sentiment") or {})
        complaints = list(structured_inputs.get("complaints") or [])
        complaints.extend(str(item).strip() for item in memory_context.get("recurring_objections") or [] if str(item).strip())
        behaviors = list(structured_inputs.get("behaviors") or [])
        behaviors.extend(str(item).strip() for item in memory_context.get("execution_learnings") or [] if str(item).strip())
        competition_reactions = list(structured_inputs.get("competition_reactions") or [])
        competition_reactions.extend(str(item).strip() for item in memory_context.get("stable_behaviors") or [] if str(item).strip())
        market_grounding = self.build_market_grounding(
            state=state,
            place_label=place_label,
            structured_inputs=structured_inputs,
            memory_context=memory_context,
            saved_persona_hints=saved_persona_hints,
        )
        segment_payload = await self.build_dynamic_segments(
            state=state,
            place_label=place_label,
            structured_inputs=structured_inputs,
            market_grounding=market_grounding,
            memory_context=memory_context,
            saved_persona_hints=saved_persona_hints,
        )
        audience_clusters = list(segment_payload.get("audience_clusters") or [])
        fallback = {
            "evidence_signals": self._string_list(evidence_signals, fallback=evidence_signals, limit=12),
            "user_types": list(structured_inputs.get("user_types") or [])[:8],
            "complaints": self._string_list(complaints, fallback=complaints, limit=8),
            "behaviors": self._string_list(behaviors, fallback=behaviors, limit=8),
            "competition_reactions": self._string_list(competition_reactions, fallback=competition_reactions, limit=8),
            "social_sentiment": social_sentiment,
            "audience_clusters": audience_clusters,
            "dynamic_segments": audience_clusters,
            "archetype_hypotheses": list(segment_payload.get("archetype_hypotheses") or [cluster["cluster"] for cluster in audience_clusters[:6]]),
            "archetype_guardrails_used": list(segment_payload.get("archetype_guardrails_used") or [cluster["cluster"] for cluster in audience_clusters[:6]]),
            "signal_catalog": list(structured_inputs.get("signal_catalog") or [])[:24],
            "market_grounding": market_grounding,
            "confidence_score": self._clamp(
                (0.7 * min(
                    0.95,
                    max(
                        0.24,
                        (
                            float(segment_payload.get("confidence_score") or 0.0)
                            + (0.45 if self._has_enough_data(state) else 0.32)
                        ) / 2.0,
                    ),
                ))
                + (0.3 * ladder_confidence),
                0.24,
                0.95,
                fallback=0.32,
            ),
        }
        prompt = (
            f"Idea: {state.user_context.get('idea')}\n"
            f"Category: {state.user_context.get('category')}\n"
            f"Place context: {place_label or 'none'}\n"
            f"Persona source mode: {state.persona_source_mode}\n"
            f"Target audiences: {', '.join(self._normalized_audiences(state)) or 'none'}\n"
            f"Idea understanding: {market_grounding.get('idea_understanding')}\n"
            f"Market grounding: {market_grounding}\n"
            f"Research summary: {str((state.research.summary if state.research else '') or '')[:900]}\n"
            f"Research user types: {' | '.join(list(structured_inputs.get('user_types') or [])[:8])}\n"
            f"Research complaints: {' | '.join(fallback['complaints'][:8])}\n"
            f"Research behaviors: {' | '.join(fallback['behaviors'][:8])}\n"
            f"Competition reactions: {' | '.join(fallback['competition_reactions'][:8])}\n"
            f"Evidence signals: {' | '.join(fallback['evidence_signals'][:12])}\n"
            f"Memory recurring objections: {' | '.join(list(memory_context.get('recurring_objections') or [])[:6])}\n"
            f"Memory learnings: {' | '.join(list(memory_context.get('execution_learnings') or [])[:6])}\n"
            f"Saved persona hints: {' | '.join(persona.name for persona in saved_persona_hints[:6])}\n"
            f"Audience guardrails: {', '.join(cluster['cluster'] for cluster in audience_clusters[:8])}\n\n"
            "Transform these signals into a dynamic persona fitting plan. Every cluster must be grounded in research, market grounding, or weak-data fallback archetypes. Return JSON only with:\n"
            '{"evidence_signals":[""],'
            '"user_types":[""],'
            '"complaints":[""],'
            '"behaviors":[""],'
            '"competition_reactions":[""],'
            '"social_sentiment":{"overall":"positive|mixed|negative","price_sensitivity":"low|medium|high","trust":"low|medium|high","notable_themes":[""]},'
            '"market_grounding":{"idea_understanding":{},"competition_level":"","demand_level":"","price_sensitivity":"","user_types":[""],"local_objections":[""],"competitor_references":[""],"audience_tendencies":[""],"cultural_factors":[""]},'
            '"audience_clusters":[{"cluster":"","segment_id":"","source_kind":"research_signal|audience_fallback|hybrid","rationale":"","signal_refs":[""],"roles":[""],"motivations":[""],"concerns":[""],"speaking_styles":[""],"age_bands":[""],"life_stages":[""],"archetype_name":"","price_sensitivity_bucket":"low|medium|high","decision_style":"","purchase_triggers":[""],"rejection_triggers":[""]}],'
            '"dynamic_segments":[{"cluster":"","segment_id":"","source_kind":"research_signal|audience_fallback|hybrid"}],'
            '"archetype_hypotheses":[""],'
            '"archetype_guardrails_used":[""],'
            '"signal_catalog":[{"id":"","type":"","text":"","source_kind":"research_signal|audience_fallback","source_ref":""}],'
            '"confidence_score":0.0}'
        )
        system = (
            "You are a persona-systems fitting engine. "
            "Infer realistic audience clusters from research, market grounding, place context, target audience, and explicit archetype guardrails. "
            "Do not invent unsupported demographics, complaints, or behaviors."
        )
        raw = await self._generate_json_with_budget(
            prompt=prompt,
            system=system,
            temperature=0.2,
            fallback_json=fallback,
        )
        clusters_out = self._normalize_dynamic_clusters(
            state=state,
            place_label=place_label,
            clusters=raw.get("audience_clusters") if isinstance(raw.get("audience_clusters"), list) and raw.get("audience_clusters") else audience_clusters,
            fallback_clusters=audience_clusters,
            market_grounding=market_grounding,
        )
        return {
            "evidence_signals": self._string_list(raw.get("evidence_signals"), fallback=fallback["evidence_signals"], limit=12),
            "user_types": self._string_list(raw.get("user_types"), fallback=list(structured_inputs.get("user_types") or []), limit=10),
            "complaints": self._string_list(raw.get("complaints"), fallback=fallback["complaints"], limit=10),
            "behaviors": self._string_list(raw.get("behaviors"), fallback=fallback["behaviors"], limit=10),
            "competition_reactions": self._string_list(raw.get("competition_reactions"), fallback=fallback["competition_reactions"], limit=10),
            "social_sentiment": raw.get("social_sentiment") if isinstance(raw.get("social_sentiment"), dict) else social_sentiment,
            "audience_clusters": clusters_out,
            "dynamic_segments": clusters_out,
            "market_grounding": raw.get("market_grounding") if isinstance(raw.get("market_grounding"), dict) and raw.get("market_grounding") else market_grounding,
            "archetype_hypotheses": self._string_list(raw.get("archetype_hypotheses"), fallback=list(fallback["archetype_hypotheses"]), limit=10),
            "archetype_guardrails_used": self._string_list(raw.get("archetype_guardrails_used"), fallback=list(fallback["archetype_guardrails_used"]), limit=10),
            "signal_catalog": raw.get("signal_catalog") if isinstance(raw.get("signal_catalog"), list) and raw.get("signal_catalog") else list(structured_inputs.get("signal_catalog") or []),
            "confidence_score": self._clamp(raw.get("confidence_score"), 0.2, 0.95, fallback=float(fallback["confidence_score"])),
        }

    async def _generate_batch_blueprint(
        self,
        *,
        state: OrchestrationState,
        signal_plan: Dict[str, Any],
        batch_number: int,
        batch_count: int,
        batch_goal: int,
        existing_names: Sequence[str],
    ) -> Dict[str, Any]:
        evidence_lines = "\n".join(f"- {item}" for item in (signal_plan.get("evidence_signals") or [])[:12])
        clusters = signal_plan.get("dynamic_segments") if isinstance(signal_plan.get("dynamic_segments"), list) and signal_plan.get("dynamic_segments") else signal_plan.get("audience_clusters") if isinstance(signal_plan.get("audience_clusters"), list) else []
        signal_catalog = signal_plan.get("signal_catalog") if isinstance(signal_plan.get("signal_catalog"), list) else []
        market_grounding = signal_plan.get("market_grounding") if isinstance(signal_plan.get("market_grounding"), dict) else {}
        prompt = (
            f"Idea: {state.user_context.get('idea')}\n"
            f"Context type: {state.idea_context_type or IdeaContextType.GENERAL_NON_LOCATION.value}\n"
            f"Persona source mode: {state.persona_source_mode}\n"
            f"Batch {batch_number} of {batch_count}\n"
            f"Need up to {batch_goal} personas for this batch.\n"
            f"Existing names to avoid: {', '.join(existing_names) or 'none'}\n"
            f"Market grounding: {market_grounding}\n"
            f"Social sentiment: {signal_plan.get('social_sentiment')}\n"
            f"User types: {signal_plan.get('user_types')}\n"
            f"Complaints: {signal_plan.get('complaints')}\n"
            f"Behaviors: {signal_plan.get('behaviors')}\n"
            f"Competition reactions: {signal_plan.get('competition_reactions')}\n"
            f"Audience clusters: {clusters}\n"
            f"Signal catalog: {signal_catalog}\n"
            f"Evidence signals:\n{evidence_lines}\n\n"
            "Return JSON only with a personas array. Each persona must include display_name, source_mode, "
            "target_audience_cluster, segment_id, location_context, age_band, life_stage, profession_role, attitude_baseline, "
            "skepticism_level, conformity_level, stubbornness_level, innovation_openness, financial_sensitivity, "
            "style_of_speaking, main_concerns, probable_motivations, influence_weight, tags, stance, summary, evidence_signals, "
            "price_sensitivity_bucket, decision_style, purchase_trigger, rejection_trigger, and source_attribution. "
            "source_attribution must include kind, signal_refs, and source_ref. "
            "Fit from the provided signals only. Do not invent unsupported personas."
        )
        system = (
            "You are generating simulation-ready human personas from dynamic audience segments and market grounding. "
            "Avoid clones. Vary age band, profession, speaking style, money sensitivity, skepticism, and motivations, "
            "but keep each persona tightly grounded in the provided signal catalog and current segment design."
        )
        return await self.runtime.llm.generate_json(
            prompt=prompt,
            system=system,
            temperature=0.35,
            fallback_json={"personas": self._signal_fitted_blueprints(state, signal_plan, batch_goal)},
        )

    def _materialize_personas(
        self,
        *,
        state: OrchestrationState,
        blueprint: Dict[str, Any],
        signal_plan: Dict[str, Any],
        place_label: str,
        requested_count: int,
        signatures: set[str],
        used_names: set[str],
        seed_offset: int,
    ) -> Tuple[List[PersonaProfile], Dict[str, int]]:
        category = str(state.user_context.get("category") or "").strip().lower()
        dataset = getattr(self.runtime, "dataset", None)
        template_pool = list(getattr(dataset, "templates_by_category", {}).get(category) or getattr(dataset, "templates", []) or [])
        approved_signals = self._approved_signal_texts(signal_plan)
        source_rows = blueprint.get("personas") if isinstance(blueprint.get("personas"), list) else []
        if not source_rows:
            source_rows = self._signal_fitted_blueprints(state, signal_plan, requested_count)

        rng = random.Random(f"{state.simulation_id}:{seed_offset}:{place_label}:{requested_count}")
        personas: List[PersonaProfile] = []
        duplicate_rejected = 0
        weak_rejected = 0
        for index, item in enumerate(source_rows):
            if len(personas) >= requested_count:
                break
            if not isinstance(item, dict):
                weak_rejected += 1
                continue
            display_name = str(item.get("display_name") or item.get("name") or "").strip()
            age_band = str(item.get("age_band") or "").strip()
            life_stage = str(item.get("life_stage") or "").strip()
            profession_role = str(item.get("profession_role") or "").strip()
            attitude_baseline = str(item.get("attitude_baseline") or "").strip()
            speaking_style = str(item.get("style_of_speaking") or item.get("speaking_style") or "").strip()
            cluster = str(item.get("target_audience_cluster") or "").strip()
            segment_id = str(item.get("segment_id") or self._slug(cluster or display_name)[:64]).strip()
            concerns = self._string_list(
                item.get("main_concerns") or item.get("concerns"),
                fallback=self._cluster_values(signal_plan, cluster, "concerns"),
                limit=4,
            )
            motivations = self._string_list(
                item.get("probable_motivations") or item.get("motivations"),
                fallback=self._cluster_values(signal_plan, cluster, "motivations"),
                limit=4,
            )
            tags = self._string_list(item.get("tags"), fallback=self._fallback_tags(cluster, state), limit=5)
            evidence_signals = self._string_list(item.get("evidence_signals"), fallback=list(signal_plan.get("evidence_signals") or [])[:3], limit=4)
            source_attribution = dict(item.get("source_attribution") or {})
            decision_style = str(item.get("decision_style") or "").strip()
            purchase_trigger = str(item.get("purchase_trigger") or "").strip()
            rejection_trigger = str(item.get("rejection_trigger") or "").strip()
            price_bucket = str(item.get("price_sensitivity_bucket") or "medium").strip().lower() or "medium"
            if not all([display_name, age_band, life_stage, profession_role, attitude_baseline, speaking_style, cluster, segment_id]):
                weak_rejected += 1
                continue
            if len(concerns) < 2 or len(motivations) < 2 or len(tags) < 2 or len(evidence_signals) < 1 or not all([decision_style, purchase_trigger, rejection_trigger]):
                weak_rejected += 1
                continue
            if not self._signals_are_traceable(evidence_signals, approved_signals):
                weak_rejected += 1
                continue
            if not source_attribution:
                source_attribution = self._build_source_attribution(
                    state=state,
                    signal_plan=signal_plan,
                    cluster=cluster,
                    evidence_signals=evidence_signals,
                    raw_kind=item.get("source_mode"),
                )

            signature = "|".join([cluster.lower(), age_band.lower(), profession_role.lower(), attitude_baseline.lower(), speaking_style.lower(), ",".join(sorted(text.lower() for text in concerns[:2]))])
            lowered_name = display_name.lower()
            if signature in signatures or lowered_name in used_names:
                duplicate_rejected += 1
                continue
            signatures.add(signature)
            used_names.add(lowered_name)

            template = template_pool[(seed_offset + index) % len(template_pool)] if template_pool else None
            category_by_id = getattr(dataset, "category_by_id", {}) if dataset is not None else {}
            category_model = category_by_id.get(template.category_id) if template is not None else None
            category_weight = float(category_model.base_influence_weight if category_model else 1.0)
            template_traits = dict(getattr(template, "traits", {}) or {})
            skepticism = self._clamp(item.get("skepticism_level"), 0.05, 0.95, fallback=float(template_traits.get("skepticism", 0.5)))
            conformity = self._clamp(item.get("conformity_level"), 0.05, 0.95, fallback=0.48)
            stubbornness = self._clamp(item.get("stubbornness_level"), 0.05, 0.95, fallback=0.46)
            innovation = self._clamp(item.get("innovation_openness"), 0.05, 0.95, fallback=float(template_traits.get("openness_to_change", 0.5)))
            financial = self._clamp(item.get("financial_sensitivity"), 0.05, 0.95, fallback=0.5)
            influence_weight = self._clamp(item.get("influence_weight"), 0.3, 2.0, fallback=round(category_weight * float(getattr(template, "influence_susceptibility", 1.0) or 1.0), 3))
            opinion = self._normalize_opinion(item.get("stance"))
            source_kind = self._normalize_source_kind(item.get("source_mode"), state, place_label)
            matched_signal_confidence = self._matched_signal_confidence(signal_plan, evidence_signals)
            traits = self._merge_traits(
                template_traits,
                skepticism=skepticism,
                conformity=conformity,
                stubbornness=stubbornness,
                innovation=innovation,
                financial=financial,
                rng=rng,
                category_id=str(getattr(template, "category_id", "") or self._slug(category) or "dynamic"),
                cluster=cluster,
                index=seed_offset + index,
            )
            personas.append(
                PersonaProfile(
                    persona_id=str(uuid.uuid4()),
                    name=display_name,
                    source_mode=source_kind,
                    target_audience_cluster=cluster,
                    segment_id=segment_id,
                    location_context=str(item.get("location_context") or place_label or "global").strip(),
                    age_band=age_band,
                    life_stage=life_stage,
                    profession_role=profession_role,
                    attitude_baseline=attitude_baseline,
                    skepticism_level=skepticism,
                    conformity_level=conformity,
                    stubbornness_level=stubbornness,
                    innovation_openness=innovation,
                    financial_sensitivity=financial,
                    speaking_style=speaking_style,
                    tags=tags,
                    source_attribution=source_attribution,
                    evidence_signals=evidence_signals,
                    category_id=str(getattr(template, "category_id", "") or self._slug(category) or "dynamic"),
                    template_id=str(getattr(template, "template_id", "") or f"dynamic-{segment_id}"),
                    archetype_name=str(item.get("archetype_name") or cluster or getattr(template, "archetype_name", cluster)).strip(),
                    summary=str(item.get("summary") or self._persona_summary(cluster, profession_role, concerns, motivations, place_label)).strip(),
                    motivations=motivations[:4],
                    concerns=concerns[:4],
                    location=str(item.get("location_context") or place_label or "").strip(),
                    price_sensitivity_bucket=price_bucket if price_bucket in {"low", "medium", "high"} else "medium",
                    decision_style=decision_style,
                    purchase_trigger=purchase_trigger,
                    rejection_trigger=rejection_trigger,
                    opinion=opinion,
                    confidence=round(
                        self._clamp(
                            (0.55 * (matched_signal_confidence if matched_signal_confidence is not None else float(signal_plan.get("confidence_score") or 0.0)))
                            + (0.25 * float(signal_plan.get("confidence_score") or 0.0))
                            + (0.20 * self._clamp(item.get("confidence_score"), 0.0, 1.0, fallback=0.56 + rng.uniform(-0.06, 0.1))),
                            0.38,
                            0.94,
                            fallback=0.56 + rng.uniform(-0.06, 0.1),
                        ),
                        3,
                    ),
                    influence_weight=round(influence_weight, 3),
                    traits=traits,
                    biases=self._string_list(item.get("biases"), fallback=list(getattr(template, "biases", []) or []), limit=4),
                    opinion_score={"accept": 0.18, "neutral": 0.0, "reject": -0.18}.get(opinion, 0.0),
                )
            )
        return personas, {"duplicate": duplicate_rejected, "weak": weak_rejected}

    def _validate_personas(
        self,
        *,
        personas: Sequence[PersonaProfile],
        signal_plan: Dict[str, Any],
        state: OrchestrationState,
        target_count: int,
        strict_target: bool,
    ) -> Dict[str, Any]:
        fatal_errors: List[str] = []
        simulation_blockers: List[str] = []
        warnings: List[str] = []
        if not personas:
            fatal_errors.append("persona_count_zero")
        required_missing = 0
        names: set[str] = set()
        persona_ids: set[str] = set()
        attribution_missing = 0
        trace_missing = 0
        missing_dynamic_fields = 0
        approved_signals = self._approved_signal_texts(signal_plan)
        for persona in personas:
            if not all([persona.persona_id, persona.name, persona.source_mode, persona.target_audience_cluster, persona.age_band, persona.profession_role, persona.attitude_baseline, persona.speaking_style, persona.tags, persona.concerns, persona.motivations]):
                required_missing += 1
            if not all([persona.segment_id, persona.price_sensitivity_bucket, persona.decision_style, persona.purchase_trigger, persona.rejection_trigger]):
                missing_dynamic_fields += 1
            lowered_name = persona.name.lower()
            if lowered_name in names:
                fatal_errors.append("duplicate_display_name")
                break
            names.add(lowered_name)
            if persona.persona_id in persona_ids:
                fatal_errors.append("duplicate_persona_id")
                break
            persona_ids.add(persona.persona_id)
            if not persona.source_attribution or not persona.source_attribution.get("kind"):
                attribution_missing += 1
            elif not self._signals_are_traceable(persona.evidence_signals, approved_signals):
                trace_missing += 1
        if required_missing:
            fatal_errors.append("schema_incomplete")
        if attribution_missing:
            fatal_errors.append("source_attribution_missing")
        if trace_missing:
            fatal_errors.append("persona_signal_trace_invalid")
        if missing_dynamic_fields:
            fatal_errors.append("dynamic_persona_schema_incomplete")

        clusters = {persona.target_audience_cluster for persona in personas if persona.target_audience_cluster}
        segments = {persona.segment_id for persona in personas if persona.segment_id}
        roles = {persona.profession_role for persona in personas if persona.profession_role}
        ages = {persona.age_band for persona in personas if persona.age_band}
        speaking_styles = {persona.speaking_style for persona in personas if persona.speaking_style}
        source_kinds = {persona.source_mode for persona in personas if persona.source_mode}
        decision_styles = {persona.decision_style for persona in personas if persona.decision_style}
        price_buckets = {persona.price_sensitivity_bucket for persona in personas if persona.price_sensitivity_bucket}
        cluster_floor = max(1.0, min(5.0, len(personas) / 6))
        role_floor = max(2.0, min(8.0, len(personas) / 2.5))
        age_floor = 3.0
        speaking_floor = 3.0
        diversity_score = round(
            min(
                1.0,
                (
                    min(1.0, len(clusters) / cluster_floor)
                    + min(1.0, len(segments) / max(2.0, cluster_floor))
                    + min(1.0, len(roles) / role_floor)
                    + min(1.0, len(ages) / age_floor)
                    + min(1.0, len(speaking_styles) / speaking_floor)
                    + min(1.0, len(source_kinds) / 2.0)
                    + min(1.0, len(decision_styles) / 2.0)
                    + min(1.0, len(price_buckets) / 2.0)
                ) / 7.0,
            ),
            3,
        )
        diversity = {
            "cluster_count": len(clusters),
            "segment_count": len(segments),
            "role_count": len(roles),
            "age_band_count": len(ages),
            "speaking_style_count": len(speaking_styles),
            "source_kind_count": len(source_kinds),
            "decision_style_count": len(decision_styles),
            "price_bucket_count": len(price_buckets),
            "score": diversity_score,
        }
        minimum_persona_threshold = self._minimum_persona_threshold(state)
        diversity_threshold = self._minimum_diversity_score(state)
        if len(personas) < minimum_persona_threshold:
            simulation_blockers.append("persona_count_below_simulation_minimum")
        if len(segments) < max(2, min(4, len(personas) // 5 or 1)):
            simulation_blockers.append("segment_collapse_detected")
        if diversity_score < diversity_threshold:
            warnings.append("diversity_score_below_threshold")
        allow_lower_target = bool(state.schema.get("allow_lower_persona_target"))
        if strict_target and len(personas) < target_count and not (allow_lower_target and target_count < self.TARGET_MIN_PERSONAS):
            warnings.append("persona_count_below_segment_coverage_target")
        if len(signal_plan.get("evidence_signals") or []) < self.TARGET_MIN_PERSONAS and not strict_target:
            warnings.append("insufficient_data_for_full_diversity")

        return {
            "errors": list(dict.fromkeys(fatal_errors + simulation_blockers)),
            "fatal_errors": list(dict.fromkeys(fatal_errors)),
            "simulation_blockers": list(dict.fromkeys(simulation_blockers)),
            "warnings": list(dict.fromkeys(warnings)),
            "diversity": diversity,
            "diversity_score": diversity_score,
            "target_count": target_count,
            "actual_count": len(personas),
            "strict_target": strict_target,
            "signal_count": len(signal_plan.get("evidence_signals") or []),
            "minimum_persona_threshold": minimum_persona_threshold,
            "minimum_diversity_score": diversity_threshold,
            "persistence_allowed": not bool(fatal_errors),
        }

    async def _auto_complete_personas_for_simulation(
        self,
        *,
        state: OrchestrationState,
        personas: Sequence[PersonaProfile],
        signal_plan: Dict[str, Any],
        place_label: str,
        target_count: int,
        validation: Dict[str, Any],
    ) -> Tuple[List[PersonaProfile], Dict[str, Any], Dict[str, Any]]:
        initial_personas = list(personas)
        if not validation.get("simulation_blockers"):
            return initial_personas, signal_plan, {}

        completion_target = max(target_count, self._minimum_persona_threshold(state))
        required_segments = self._required_segment_count(max(completion_target, len(initial_personas)))
        augmented_signal_plan = self._build_auto_completion_signal_plan(
            state=state,
            signal_plan=signal_plan,
            place_label=place_label,
            minimum_segments=required_segments,
        )
        signatures = {self._persona_signature(persona) for persona in initial_personas}
        used_names = {str(persona.name or "").strip().lower() for persona in initial_personas if str(persona.name or "").strip()}
        completed = list(initial_personas)
        rounds = max(1, math.ceil(max(0, completion_target - len(initial_personas)) / self.BATCH_SIZE) + 1)
        oversample = self._oversample_padding(augmented_signal_plan.get("confidence_score"))
        duplicate_rejections = 0
        weak_rejections = 0

        for round_index in range(rounds):
            current_validation = self._validate_personas(
                personas=completed,
                signal_plan=augmented_signal_plan,
                state=state,
                target_count=completion_target,
                strict_target=False,
            )
            blockers = list(current_validation.get("simulation_blockers") or [])
            if not blockers:
                break
            missing_count = max(0, completion_target - len(completed))
            current_segments = {persona.segment_id for persona in completed if persona.segment_id}
            segment_shortfall = max(0, required_segments - len(current_segments))
            batch_goal = max(2, missing_count, segment_shortfall * 2)
            batch_goal = min(self.BATCH_SIZE, batch_goal)
            seed_offset = len(completed) + (round_index * self.BATCH_SIZE)
            blueprint = await self._generate_batch_blueprint(
                state=state,
                signal_plan=augmented_signal_plan,
                batch_number=round_index + 1,
                batch_count=rounds,
                batch_goal=batch_goal + oversample,
                existing_names=sorted(used_names)[:20],
            )
            batch_personas, rejected = self._materialize_personas(
                state=state,
                blueprint=blueprint,
                signal_plan=augmented_signal_plan,
                place_label=place_label,
                requested_count=batch_goal,
                signatures=signatures,
                used_names=used_names,
                seed_offset=seed_offset,
            )
            if not batch_personas:
                fallback_blueprint = {
                    "personas": self._signal_fitted_blueprints(state, augmented_signal_plan, batch_goal + oversample),
                }
                batch_personas, rejected = self._materialize_personas(
                    state=state,
                    blueprint=fallback_blueprint,
                    signal_plan=augmented_signal_plan,
                    place_label=place_label,
                    requested_count=batch_goal,
                    signatures=signatures,
                    used_names=used_names,
                    seed_offset=seed_offset + 1,
                )
            duplicate_rejections += int(rejected.get("duplicate") or 0)
            weak_rejections += int(rejected.get("weak") or 0)
            if not batch_personas:
                break
            completed.extend(batch_personas)

        return completed, augmented_signal_plan, {
            "attempted": True,
            "reason_codes": list(validation.get("simulation_blockers") or []),
            "initial_count": len(initial_personas),
            "final_count": len(completed),
            "completion_target": completion_target,
            "required_segments": required_segments,
            "used_llm_top_up": len(completed) > len(initial_personas),
            "added_count": max(0, len(completed) - len(initial_personas)),
            "duplicate_rejection_count": duplicate_rejections,
            "weak_rejection_count": weak_rejections,
            "final_segment_count": len({persona.segment_id for persona in completed if persona.segment_id}),
        }

    def _target_persona_count(self, state: OrchestrationState) -> int:
        explicit_requested = state.schema.get("persona_count_requested")
        requested = int(explicit_requested if explicit_requested is not None else (state.user_context.get("agentCount") or 24))
        minimum_allowed = 8 if bool(state.schema.get("allow_lower_persona_target")) else 10
        requested = max(minimum_allowed, min(self.HARD_MAX_PERSONAS, requested))
        if explicit_requested is not None:
            return requested
        if self._has_enough_data(state):
            return max(self.TARGET_MIN_PERSONAS, requested)
        return min(requested, self._reliable_persona_cap(state))

    def _has_enough_data(self, state: OrchestrationState) -> bool:
        structured = state.research.structured_schema if state.research else {}
        evidence_count = len((state.research.evidence if state.research else []) or [])
        research_signal_count = len(self._research_signal_texts(state))
        user_type_count = len([item for item in structured.get("user_types") or [] if str(item).strip()])
        complaint_count = len([item for item in structured.get("complaints") or [] if str(item).strip()])
        behavior_count = len([item for item in structured.get("behaviors") or [] if str(item).strip()])
        reaction_count = len([item for item in structured.get("competition_reactions") or [] if str(item).strip()])
        return (
            evidence_count >= 6
            and research_signal_count >= 10
            and user_type_count >= 3
            and (complaint_count + behavior_count + reaction_count) >= 8
        )

    def _minimum_persona_threshold(self, state: OrchestrationState) -> int:
        raw = state.schema.get("minimum_persona_threshold")
        if raw is None:
            raw = state.user_context.get("minimumPersonaThreshold")
        if raw is None:
            raw = os.getenv("PERSONA_MIN_THRESHOLD", "15")
        try:
            value = int(raw)
        except (TypeError, ValueError):
            value = 15
        return max(5, min(50, value))

    def _minimum_diversity_score(self, state: OrchestrationState) -> float:
        raw = state.schema.get("minimum_diversity_score")
        if raw is None:
            raw = os.getenv("PERSONA_MIN_DIVERSITY_SCORE", "0.55")
        try:
            value = float(raw)
        except (TypeError, ValueError):
            value = 0.55
        return round(max(0.2, min(0.95, value)), 3)

    def _reliable_persona_cap(self, state: OrchestrationState) -> int:
        structured = state.research.structured_schema if state.research else {}
        signal_count = len(self._research_signal_texts(state))
        user_types = len([item for item in structured.get("user_types") or [] if str(item).strip()])
        complaints = len([item for item in structured.get("complaints") or [] if str(item).strip()])
        behaviors = len([item for item in structured.get("behaviors") or [] if str(item).strip()])
        reactions = len([item for item in structured.get("competition_reactions") or [] if str(item).strip()])
        audience_clusters = len(self._audience_clusters(state))
        reliable = max(
            8,
            min(
                self.TARGET_MIN_PERSONAS - 1,
                6 + signal_count + (user_types * 2) + complaints + behaviors + reactions + audience_clusters,
            ),
        )
        return min(self.HARD_MAX_PERSONAS, reliable)

    def _required_segment_count(self, persona_count: int) -> int:
        return max(2, min(4, persona_count // 5 or 1))

    def _persona_signature(self, persona: PersonaProfile) -> str:
        concern_seed = ",".join(sorted(str(text).strip().lower() for text in list(persona.concerns or [])[:2] if str(text).strip()))
        return "|".join(
            [
                str(persona.target_audience_cluster or "").strip().lower(),
                str(persona.age_band or "").strip().lower(),
                str(persona.profession_role or "").strip().lower(),
                str(persona.attitude_baseline or "").strip().lower(),
                str(persona.speaking_style or "").strip().lower(),
                concern_seed,
            ]
        )

    def _build_auto_completion_signal_plan(
        self,
        *,
        state: OrchestrationState,
        signal_plan: Dict[str, Any],
        place_label: str,
        minimum_segments: int,
    ) -> Dict[str, Any]:
        augmented = dict(signal_plan)
        current_clusters = list(
            signal_plan.get("dynamic_segments")
            if isinstance(signal_plan.get("dynamic_segments"), list) and signal_plan.get("dynamic_segments")
            else signal_plan.get("audience_clusters")
            if isinstance(signal_plan.get("audience_clusters"), list)
            else []
        )
        structured_inputs = self._structured_persona_inputs(state)
        market_grounding = (
            signal_plan.get("market_grounding")
            if isinstance(signal_plan.get("market_grounding"), dict) and signal_plan.get("market_grounding")
            else self.build_market_grounding(
                state=state,
                place_label=place_label,
                structured_inputs=structured_inputs,
                memory_context={},
                saved_persona_hints=[],
            )
        )
        fallback_clusters = self._fallback_dynamic_segments(
            state=state,
            place_label=place_label,
            structured_inputs=structured_inputs,
            market_grounding=market_grounding,
            saved_persona_hints=[],
        )
        merged_clusters: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for source in (current_clusters, fallback_clusters):
            for item in source:
                if not isinstance(item, dict):
                    continue
                cluster_name = str(item.get("cluster") or "").strip()
                segment_id = str(item.get("segment_id") or "").strip()
                key = f"{cluster_name.lower()}::{segment_id.lower()}"
                if not cluster_name or key in seen:
                    continue
                seen.add(key)
                merged_clusters.append(item)
        if len(merged_clusters) < minimum_segments:
            merged_clusters.extend(
                self._expand_cluster_variants(
                    clusters=merged_clusters or fallback_clusters or self._audience_clusters(state),
                    minimum_segments=minimum_segments,
                )
            )
        normalized = self._normalize_dynamic_clusters(
            state=state,
            place_label=place_label,
            clusters=merged_clusters,
            fallback_clusters=fallback_clusters or merged_clusters,
            market_grounding=market_grounding,
        )
        normalized = normalized[: max(minimum_segments, len(current_clusters), 1)]
        prioritized_catalog_signals = [
            str(item.get("text") or "").strip()
            for item in self._prioritized_signal_catalog(
                structured_inputs.get("signal_catalog") or [],
                ladder_summary=structured_inputs.get("evidence_confidence") if isinstance(structured_inputs.get("evidence_confidence"), dict) else None,
            )
            if isinstance(item, dict) and str(item.get("text") or "").strip()
        ]
        evidence_signals = self._string_list(
            list(signal_plan.get("evidence_signals") or []) + prioritized_catalog_signals + self._evidence_signals(state),
            fallback=self._research_signal_texts(state),
            limit=24,
        )
        augmented["market_grounding"] = market_grounding
        augmented["audience_clusters"] = list(normalized)
        augmented["dynamic_segments"] = list(normalized)
        augmented["evidence_signals"] = evidence_signals
        return augmented

    def _expand_cluster_variants(self, *, clusters: Sequence[Dict[str, Any]], minimum_segments: int) -> List[Dict[str, Any]]:
        base_clusters = [item for item in clusters if isinstance(item, dict)]
        if not base_clusters:
            return []
        themes = [
            {"label": "Budget-sensitive", "decision_style": "price-first", "price_bucket": "high"},
            {"label": "Convenience-first", "decision_style": "speed-first", "price_bucket": "medium"},
            {"label": "Trust-seeking", "decision_style": "risk-aware", "price_bucket": "medium"},
            {"label": "Early-adopter", "decision_style": "experimentation-led", "price_bucket": "low"},
        ]
        variants: List[Dict[str, Any]] = []
        seen_names = {
            str(item.get("cluster") or "").strip().lower()
            for item in base_clusters
            if str(item.get("cluster") or "").strip()
        }
        attempt = 0
        while len(base_clusters) + len(variants) < minimum_segments and attempt < (minimum_segments * 6):
            base = base_clusters[attempt % len(base_clusters)]
            theme = themes[attempt % len(themes)]
            base_name = str(base.get("cluster") or "").strip() or "Audience"
            variant_name = f"{theme['label']} {base_name}"
            if variant_name.lower() in seen_names:
                attempt += 1
                continue
            seen_names.add(variant_name.lower())
            motivations = self._string_list(base.get("motivations"), fallback=["clear value", "predictable results"], limit=4)
            concerns = self._string_list(base.get("concerns"), fallback=["weak differentiation", "unclear ROI"], limit=4)
            roles = self._string_list(base.get("roles"), fallback=["customer"], limit=4)
            styles = self._string_list(base.get("speaking_styles"), fallback=["practical"], limit=4)
            ages = self._string_list(base.get("age_bands"), fallback=["25-34", "30-44"], limit=3)
            life_stages = self._string_list(base.get("life_stages"), fallback=["habit builder", "working adult"], limit=3)
            variants.append(
                {
                    "cluster": variant_name,
                    "segment_id": self._slug(f"{variant_name}-{attempt + 1}")[:64],
                    "source_kind": str(base.get("source_kind") or "hybrid"),
                    "rationale": f"Auto-expanded from {base_name} to keep simulation coverage healthy.",
                    "signal_refs": self._string_list(base.get("signal_refs"), fallback=[self._slug(base_name)[:48]], limit=4),
                    "roles": roles[attempt % len(roles):] + roles[: attempt % len(roles)] if roles else roles,
                    "motivations": motivations[1:] + motivations[:1] if len(motivations) > 1 else motivations,
                    "concerns": concerns[-1:] + concerns[:-1] if len(concerns) > 1 else concerns,
                    "speaking_styles": styles[1:] + styles[:1] if len(styles) > 1 else styles,
                    "age_bands": ages,
                    "life_stages": life_stages,
                    "archetype_name": str(base.get("archetype_name") or base_name),
                    "price_sensitivity_bucket": theme["price_bucket"],
                    "decision_style": theme["decision_style"],
                    "purchase_triggers": self._string_list(
                        list(base.get("purchase_triggers") or []) + motivations,
                        fallback=["clear value", "easy onboarding"],
                        limit=3,
                    ),
                    "rejection_triggers": self._string_list(
                        list(base.get("rejection_triggers") or []) + concerns,
                        fallback=["hidden cost", "weak trust"],
                        limit=3,
                    ),
                }
            )
            attempt += 1
        return variants

    def _research_signal_texts(self, state: OrchestrationState) -> List[str]:
        structured = state.research.structured_schema if state.research else {}
        values: List[str] = []
        for key in ("signals", "user_types", "complaints", "behaviors", "competition_reactions"):
            for item in structured.get(key) or []:
                text = str(item).strip()
                if text and text not in values:
                    values.append(text)
        for item in (state.research.findings if state.research else [])[:12]:
            text = str(item).strip()
            if text and text not in values:
                values.append(text)
        return values[:24]

    def _structured_persona_inputs(self, state: OrchestrationState) -> Dict[str, Any]:
        structured = state.research.structured_schema if state.research else {}
        signal_catalog = self._signal_catalog_from_state(state)
        evidence_ladder = ensure_evidence_ladder(structured) if isinstance(structured, dict) else []
        evidence_confidence = summarize_evidence_confidence(evidence_ladder)
        prioritized_catalog = self._prioritized_signal_catalog(signal_catalog, ladder_summary=evidence_confidence)
        audience_clusters = self._audience_clusters(state)
        return {
            "signal_catalog": signal_catalog,
            "evidence_signals": [item["text"] for item in prioritized_catalog if item.get("source_kind") == "research_signal"][:18]
            or [item["text"] for item in prioritized_catalog][:18],
            "user_types": self._string_list(structured.get("user_types"), fallback=[], limit=10),
            "complaints": self._string_list(structured.get("complaints"), fallback=[], limit=10),
            "behaviors": self._string_list(structured.get("behaviors"), fallback=[], limit=10),
            "competition_reactions": self._string_list(structured.get("competition_reactions"), fallback=[], limit=10),
            "social_sentiment": self._social_sentiment(state),
            "audience_clusters": audience_clusters,
            "evidence_ladder": evidence_ladder,
            "evidence_confidence": evidence_confidence,
        }

    def build_market_grounding(
        self,
        *,
        state: OrchestrationState,
        place_label: str,
        structured_inputs: Dict[str, Any],
        memory_context: Optional[Dict[str, Any]] = None,
        saved_persona_hints: Optional[Sequence[PersonaProfile]] = None,
    ) -> Dict[str, Any]:
        structured = state.research.structured_schema if state.research else {}
        memory_context = memory_context or {}
        saved_persona_hints = list(saved_persona_hints or [])
        price_sensitivity = str(structured.get("price_sensitivity") or "medium").strip().lower() or "medium"
        competition_level = str(structured.get("competition_level") or "medium").strip().lower() or "medium"
        demand_level = str(structured.get("demand_level") or "medium").strip().lower() or "medium"
        value_prop = str(state.user_context.get("valueProposition") or "").strip()
        delivery_model = str(state.user_context.get("deliveryModel") or "").strip()
        monetization = str(state.user_context.get("monetization") or "").strip()
        idea_text = str(state.user_context.get("idea") or "").strip()
        objections = self._string_list(
            list(structured_inputs.get("complaints") or []) + list(memory_context.get("recurring_objections") or []),
            fallback=[],
            limit=10,
        )
        competitors = self._string_list(
            list(structured_inputs.get("competition_reactions") or []),
            fallback=[],
            limit=8,
        )
        behaviors = self._string_list(
            list(structured_inputs.get("behaviors") or []) + list(memory_context.get("stable_behaviors") or []),
            fallback=[],
            limit=8,
        )
        user_types = self._string_list(structured_inputs.get("user_types"), fallback=[], limit=8)
        idea_understanding = {
            "project_type": str(state.user_context.get("category") or "").strip() or "general",
            "location": place_label or "global",
            "target_audience": list(self._normalized_audiences(state)),
            "price_positioning": self._price_positioning_bucket(price_sensitivity=price_sensitivity, monetization=monetization, idea_text=idea_text),
            "usage_context": self._usage_context(idea_text=idea_text, delivery_model=delivery_model, value_proposition=value_prop),
            "service_level": self._service_level_bucket(idea_text=idea_text, value_proposition=value_prop, monetization=monetization),
            "alternatives": competitors[:4] or objections[:2],
        }
        saved_hint_clusters = self._string_list([persona.target_audience_cluster for persona in saved_persona_hints], fallback=[], limit=6)
        saved_hint_roles = self._string_list([persona.profession_role for persona in saved_persona_hints], fallback=[], limit=8)
        return {
            "idea_understanding": idea_understanding,
            "competition_level": competition_level,
            "demand_level": demand_level,
            "price_sensitivity": price_sensitivity,
            "user_types": user_types,
            "local_objections": objections,
            "competitor_references": competitors,
            "audience_tendencies": behaviors,
            "cultural_factors": self._cultural_factors(place_label=place_label, price_sensitivity=price_sensitivity, objections=objections, behaviors=behaviors),
            "saved_hint_clusters": saved_hint_clusters,
            "saved_hint_roles": saved_hint_roles,
            "saved_hint_count": len(saved_persona_hints),
        }

    async def build_dynamic_segments(
        self,
        *,
        state: OrchestrationState,
        place_label: str,
        structured_inputs: Dict[str, Any],
        market_grounding: Dict[str, Any],
        memory_context: Optional[Dict[str, Any]] = None,
        saved_persona_hints: Optional[Sequence[PersonaProfile]] = None,
    ) -> Dict[str, Any]:
        memory_context = memory_context or {}
        saved_persona_hints = list(saved_persona_hints or [])
        fallback_clusters = self._fallback_dynamic_segments(
            state=state,
            place_label=place_label,
            structured_inputs=structured_inputs,
            market_grounding=market_grounding,
            saved_persona_hints=saved_persona_hints,
        )
        fallback = {
            "audience_clusters": fallback_clusters,
            "archetype_hypotheses": [str(cluster.get("archetype_name") or cluster.get("cluster") or "").strip() for cluster in fallback_clusters if str(cluster.get("cluster") or "").strip()][:10],
            "archetype_guardrails_used": [str(cluster.get("archetype_name") or cluster.get("cluster") or "").strip() for cluster in fallback_clusters if str(cluster.get("cluster") or "").strip()][:10],
            "confidence_score": 0.52 if self._has_enough_data(state) else 0.36,
        }
        prompt = (
            f"Idea: {state.user_context.get('idea')}\n"
            f"Category: {state.user_context.get('category')}\n"
            f"Place context: {place_label or 'global'}\n"
            f"Idea understanding: {market_grounding.get('idea_understanding')}\n"
            f"Competition level: {market_grounding.get('competition_level')}\n"
            f"Demand level: {market_grounding.get('demand_level')}\n"
            f"Price sensitivity: {market_grounding.get('price_sensitivity')}\n"
            f"User types: {' | '.join(market_grounding.get('user_types') or [])}\n"
            f"Local objections: {' | '.join(market_grounding.get('local_objections') or [])}\n"
            f"Competitor references: {' | '.join(market_grounding.get('competitor_references') or [])}\n"
            f"Cultural factors: {' | '.join(market_grounding.get('cultural_factors') or [])}\n"
            f"Memory learnings: {' | '.join(list(memory_context.get('execution_learnings') or [])[:6])}\n"
            f"Saved hint clusters: {' | '.join(market_grounding.get('saved_hint_clusters') or [])}\n"
            "Generate dynamic audience segments grounded in the current idea and market. "
            "Use base archetypes only as guardrails, not as the final source of truth. "
            "Return JSON only with keys audience_clusters, archetype_hypotheses, archetype_guardrails_used, confidence_score. "
            "Each audience_clusters item must include cluster, segment_id, source_kind, rationale, signal_refs, roles, motivations, concerns, speaking_styles, age_bands, life_stages, archetype_name, price_sensitivity_bucket, decision_style, purchase_triggers, rejection_triggers."
        )
        system = (
            "You are a dynamic persona segmentation engine. "
            "Derive current audience segments from live research, place context, objections, and likely usage patterns. "
            "Avoid generic canned segments unless the research is weak."
        )
        raw = await self._generate_json_with_budget(
            prompt=prompt,
            system=system,
            temperature=0.25,
            fallback_json=fallback,
        )
        clusters = raw.get("audience_clusters") if isinstance(raw.get("audience_clusters"), list) and raw.get("audience_clusters") else fallback_clusters
        return {
            "audience_clusters": self._normalize_dynamic_clusters(
                state=state,
                place_label=place_label,
                clusters=clusters,
                fallback_clusters=fallback_clusters,
                market_grounding=market_grounding,
            ),
            "archetype_hypotheses": self._string_list(raw.get("archetype_hypotheses"), fallback=fallback["archetype_hypotheses"], limit=10),
            "archetype_guardrails_used": self._string_list(raw.get("archetype_guardrails_used"), fallback=fallback["archetype_guardrails_used"], limit=10),
            "confidence_score": self._clamp(raw.get("confidence_score"), 0.2, 0.95, fallback=float(fallback["confidence_score"])),
        }

    async def _generate_json_with_budget(
        self,
        *,
        prompt: str,
        system: Optional[str],
        temperature: float,
        fallback_json: Dict[str, Any],
    ) -> Dict[str, Any]:
        try:
            raw = await asyncio.wait_for(
                self.runtime.llm.generate_json(
                    prompt=prompt,
                    system=system,
                    temperature=temperature,
                    fallback_json=fallback_json,
                ),
                timeout=self.LLM_CALL_BUDGET_SECONDS,
            )
        except (asyncio.TimeoutError, TimeoutError):
            return dict(fallback_json)
        except Exception:
            return dict(fallback_json)
        return raw if isinstance(raw, dict) else dict(fallback_json)

    def _signal_catalog_from_state(self, state: OrchestrationState) -> List[Dict[str, Any]]:
        structured = state.research.structured_schema if state.research else {}
        evidence_ladder = ensure_evidence_ladder(structured) if isinstance(structured, dict) else []
        signal_catalog: List[Dict[str, Any]] = []
        seen: set[str] = set()
        evidence_urls = [item.url for item in (state.research.evidence if state.research else [])[:6] if item.url]

        def _add_catalog_entry(
            signal_type: str,
            value: Any,
            source_kind: str,
            source_ref: str,
            *,
            evidence_type: str = "",
            evidence_refs: Optional[Sequence[str]] = None,
            confidence: Optional[float] = None,
            why_it_matters: str = "",
        ) -> None:
            text = str(value or "").strip()
            if not text:
                return
            key = f"{signal_type}:{text.lower()}"
            if key in seen:
                return
            seen.add(key)
            signal_catalog.append(
                {
                    "id": self._slug(key)[:64],
                    "type": signal_type,
                    "text": text,
                    "source_kind": source_kind,
                    "source_ref": str(source_ref or "").strip() or "research",
                    "evidence_type": str(evidence_type or "").strip() or ("derived_signal" if source_kind == "research_signal" else "model_estimate"),
                    "evidence_refs": list(dict.fromkeys(str(ref).strip() for ref in (evidence_refs or []) if str(ref).strip()))[:3],
                    "confidence": round(float(confidence), 3) if isinstance(confidence, (int, float)) else None,
                    "why_it_matters": str(why_it_matters or "").strip(),
                }
            )

        def _add_signal(signal_type: str, value: Any, source_kind: str, source_ref: str) -> None:
            text = str(value or "").strip()
            if not text:
                return
            matching_evidence = find_evidence_by_text(evidence_ladder, text)
            evidence_refs = [
                str(item.get("id") or "").strip()
                for item in matching_evidence
                if str(item.get("id") or "").strip()
            ]
            evidence_types = list(
                dict.fromkeys(
                    str(item.get("evidence_type") or "").strip()
                    for item in matching_evidence
                    if str(item.get("evidence_type") or "").strip()
                )
            )
            confidence_values = [
                float(item.get("confidence"))
                for item in matching_evidence
                if isinstance(item.get("confidence"), (int, float))
            ]
            source_ref_value = source_ref
            if matching_evidence:
                source_ref_value = self._evidence_source_ref(matching_evidence[0], fallback=source_ref)
            _add_catalog_entry(
                signal_type,
                text,
                source_kind,
                source_ref_value,
                evidence_type=evidence_types[0] if evidence_types else ("derived_signal" if source_kind == "research_signal" else "model_estimate"),
                evidence_refs=evidence_refs[:3],
                confidence=max(confidence_values) if confidence_values else None,
                why_it_matters=str(matching_evidence[0].get("why_it_matters") or "").strip() if matching_evidence else "",
            )

        for signal_type in ("signals", "user_types", "complaints", "behaviors", "competition_reactions"):
            for value in structured.get(signal_type) or []:
                _add_signal(signal_type, value, "research_signal", evidence_urls[0] if evidence_urls else "research")

        def _ladder_priority(item: Dict[str, Any]) -> Tuple[int, float]:
            source = item.get("source") if isinstance(item.get("source"), dict) else {}
            kind = str(source.get("kind") or "").strip().lower()
            kind_rank = 0 if kind == "proxy_structured" else 1 if kind == "proxy_search" else 2
            confidence = float(item.get("confidence")) if isinstance(item.get("confidence"), (int, float)) else 0.0
            return kind_rank, -confidence

        def _promote_ladder_rows(evidence_type: str) -> None:
            for item in sorted(
                [
                    row
                    for row in evidence_ladder
                    if isinstance(row, dict) and str(row.get("evidence_type") or "").strip() == evidence_type
                ],
                key=_ladder_priority,
            ):
                if len(signal_catalog) >= 32:
                    break
                text = " ".join(str(item.get("text") or "").split()).strip()
                if not text:
                    continue
                if evidence_type == "direct_evidence" and len(text) > 180:
                    continue
                source = item.get("source") if isinstance(item.get("source"), dict) else {}
                signal_type = str(source.get("field") or "").strip() or "signals"
                source_kind = str(source.get("kind") or "").strip().lower()
                source_ref = source_kind if source_kind in {"proxy_structured", "proxy_search"} else self._evidence_source_ref(item, fallback="research")
                _add_catalog_entry(
                    signal_type,
                    text,
                    "research_signal",
                    source_ref,
                    evidence_type=evidence_type,
                    evidence_refs=[str(item.get("id") or "").strip()],
                    confidence=item.get("confidence") if isinstance(item.get("confidence"), (int, float)) else None,
                    why_it_matters=str(item.get("why_it_matters") or "").strip(),
                )

        _promote_ladder_rows("derived_signal")
        _promote_ladder_rows("direct_evidence")
        research_signal_count = sum(1 for item in signal_catalog if str(item.get("source_kind") or "").strip() == "research_signal")
        if research_signal_count < 18:
            _promote_ladder_rows("model_estimate")

        for cluster in self._audience_clusters(state):
            if len(signal_catalog) >= 32:
                break
            cluster_name = str(cluster.get("cluster") or "").strip()
            source_ref = cluster_name or "audience_fallback"
            for role in cluster.get("roles") or []:
                _add_signal("user_types", role, "audience_fallback", source_ref)
            for concern in cluster.get("concerns") or []:
                _add_signal("complaints", concern, "audience_fallback", source_ref)
            for behavior in list(cluster.get("speaking_styles") or []) + list(cluster.get("motivations") or []):
                _add_signal("behaviors", behavior, "audience_fallback", source_ref)
        return signal_catalog[:32]

    def _default_signal_confidence(self, evidence_type: str) -> float:
        normalized = str(evidence_type or "").strip()
        if normalized == "direct_evidence":
            return 0.85
        if normalized == "derived_signal":
            return 0.62
        if normalized == "model_estimate":
            return 0.35
        return 0.5

    def _signal_priority(
        self,
        signal: Dict[str, Any],
        *,
        index: int,
        ladder_summary: Optional[Dict[str, Any]] = None,
    ) -> Tuple[int, float, int]:
        source_kind = str(signal.get("source_kind") or "").strip()
        evidence_type = str(signal.get("evidence_type") or "").strip()
        source_ref = str(signal.get("source_ref") or "").strip().lower()
        evidence_refs = signal.get("evidence_refs") if isinstance(signal.get("evidence_refs"), list) else []
        explicit_confidence = float(signal.get("confidence")) if isinstance(signal.get("confidence"), (int, float)) else self._default_signal_confidence(evidence_type)
        source_modifier = -0.08 if "proxy_structured" in source_ref else -0.05 if "proxy_search" in source_ref else 0.0
        summary = ladder_summary if isinstance(ladder_summary, dict) else {}
        signal_score = explicit_confidence + source_modifier
        if evidence_type in {"direct_evidence", "derived_signal"}:
            signal_score += 0.04 * float(summary.get("direct_ratio") or 0.0)
        if evidence_type == "model_estimate":
            signal_score -= 0.08 * float(summary.get("estimate_ratio") or 0.0)
        if "proxy_" in source_ref or bool(evidence_refs):
            signal_score -= 0.05 * float(summary.get("proxy_ratio") or 0.0)
        signal_score -= 0.03 * int(summary.get("contradiction_count") or 0)
        signal_score = self._clamp(signal_score, 0.1, 1.0, fallback=0.5)
        source_kind_rank = 0 if source_kind == "research_signal" else 1
        return source_kind_rank, -signal_score, index

    def _prioritized_signal_catalog(
        self,
        signal_catalog: Sequence[Dict[str, Any]],
        *,
        ladder_summary: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        indexed = [
            (index, item)
            for index, item in enumerate(signal_catalog or [])
            if isinstance(item, dict) and str(item.get("text") or "").strip()
        ]
        return [
            item
            for index, item in sorted(
                indexed,
                key=lambda row: self._signal_priority(row[1], index=row[0], ladder_summary=ladder_summary),
            )
        ]

    def _oversample_padding(self, confidence_score: Any) -> int:
        try:
            score = float(confidence_score)
        except (TypeError, ValueError):
            score = 0.0
        return 4 if score < 0.45 else 2

    def _matched_signal_confidence(self, signal_plan: Dict[str, Any], evidence_signals: Sequence[str]) -> Optional[float]:
        normalized_signals = {
            str(item).strip().lower()
            for item in evidence_signals or []
            if str(item).strip()
        }
        if not normalized_signals:
            return None
        matches: List[float] = []
        for item in signal_plan.get("signal_catalog") or []:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip().lower()
            if text not in normalized_signals:
                continue
            matches.append(
                float(item.get("confidence"))
                if isinstance(item.get("confidence"), (int, float))
                else self._default_signal_confidence(str(item.get("evidence_type") or ""))
            )
        if not matches:
            return None
        return round(sum(matches) / len(matches), 3)

    def _ladder_theme_pool(self, signal_catalog: Sequence[Dict[str, Any]]) -> Dict[str, List[str]]:
        roles: List[str] = []
        concerns: List[str] = []
        motivations: List[str] = []
        for item in self._prioritized_signal_catalog(signal_catalog):
            if str(item.get("source_kind") or "").strip() != "research_signal":
                continue
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            signal_type = str(item.get("type") or "").strip()
            evidence_type = str(item.get("evidence_type") or "").strip()
            if signal_type == "user_types" and text not in roles:
                roles.append(text)
            if signal_type == "complaints" and text not in concerns:
                concerns.append(text)
            if signal_type in {"behaviors", "signals"} and evidence_type != "model_estimate" and text not in motivations:
                motivations.append(text)
            if len(roles) >= 4 and len(concerns) >= 4 and len(motivations) >= 4:
                break
        return {"roles": roles[:4], "concerns": concerns[:4], "motivations": motivations[:4]}

    def _cluster_theme_terms(self, cluster: Dict[str, Any]) -> List[str]:
        values: List[str] = []
        for value in [cluster.get("cluster"), *(cluster.get("roles") or []), *(cluster.get("concerns") or []), *(cluster.get("motivations") or [])]:
            text = str(value or "").strip().lower()
            if len(text) >= 4 and text not in values:
                values.append(text)
        return values[:10]

    def _select_cluster_persona_signals(
        self,
        *,
        cluster: Dict[str, Any],
        signal_plan: Dict[str, Any],
        fallback_signals: Sequence[str],
    ) -> List[str]:
        prioritized_catalog = self._prioritized_signal_catalog(signal_plan.get("signal_catalog") or [])
        cluster_signal_refs = {str(item).strip().lower() for item in cluster.get("signal_refs") or [] if str(item).strip()}
        cluster_terms = self._cluster_theme_terms(cluster)
        selected: List[str] = []
        for item in prioritized_catalog:
            text = str(item.get("text") or "").strip()
            lowered = text.lower()
            if not text or text in selected:
                continue
            item_id = str(item.get("id") or "").strip().lower()
            item_ref = str(item.get("source_ref") or "").strip().lower()
            matches_ref = bool(cluster_signal_refs and (item_id in cluster_signal_refs or item_ref in cluster_signal_refs))
            matches_theme = any(term in lowered for term in cluster_terms)
            if matches_ref or matches_theme:
                selected.append(text)
            if len(selected) >= 2:
                break
        if len(selected) < 2:
            for value in fallback_signals:
                text = str(value or "").strip()
                if text and text not in selected:
                    selected.append(text)
                if len(selected) >= 2:
                    break
        return selected[:2]

    def _evidence_source_ref(self, evidence_item: Dict[str, Any], *, fallback: str = "") -> str:
        source = evidence_item.get("source")
        if isinstance(source, dict):
            for key in ("url", "title", "kind", "query", "domain"):
                value = str(source.get(key) or "").strip()
                if value:
                    return value
        text = str(source or "").strip()
        return text or fallback

    def _approved_signal_texts(self, signal_plan: Dict[str, Any]) -> set[str]:
        approved: set[str] = set()
        for item in signal_plan.get("signal_catalog") or []:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip().lower()
            if text:
                approved.add(text)
        for key in ("evidence_signals", "user_types", "complaints", "behaviors", "competition_reactions"):
            for value in signal_plan.get(key) or []:
                text = str(value).strip().lower()
                if text:
                    approved.add(text)
        return approved

    def _signals_are_traceable(self, evidence_signals: Sequence[str], approved_signals: set[str]) -> bool:
        if not evidence_signals:
            return False
        for value in evidence_signals:
            text = str(value or "").strip().lower()
            if text and text in approved_signals:
                return True
        return False

    def _cluster_values(self, signal_plan: Dict[str, Any], cluster: str, field_name: str) -> List[str]:
        for pool_name in ("dynamic_segments", "audience_clusters"):
            for item in signal_plan.get(pool_name) or []:
                if not isinstance(item, dict):
                    continue
                if str(item.get("cluster") or "").strip().lower() != str(cluster or "").strip().lower():
                    continue
                return self._string_list(item.get(field_name), fallback=[], limit=4)
        return []

    def _build_source_attribution(
        self,
        *,
        state: OrchestrationState,
        signal_plan: Dict[str, Any],
        cluster: str,
        evidence_signals: Sequence[str],
        raw_kind: Any,
    ) -> Dict[str, Any]:
        approved_catalog = signal_plan.get("signal_catalog") if isinstance(signal_plan.get("signal_catalog"), list) else []
        signal_refs = []
        source_refs = []
        evidence_refs = []
        evidence_types = []
        for signal in approved_catalog:
            if not isinstance(signal, dict):
                continue
            text = str(signal.get("text") or "").strip().lower()
            if text not in {str(item).strip().lower() for item in evidence_signals if str(item).strip()}:
                continue
            signal_refs.append(str(signal.get("id") or "").strip())
            source_ref = str(signal.get("source_ref") or "").strip()
            if source_ref:
                source_refs.append(source_ref)
            evidence_refs.extend(
                str(ref).strip()
                for ref in (signal.get("evidence_refs") or [])
                if str(ref).strip()
            )
            evidence_type = str(signal.get("evidence_type") or "").strip()
            if evidence_type:
                evidence_types.append(evidence_type)
        kind = self._normalize_source_kind(raw_kind, state, context_location_label(state.user_context))
        return {
            "kind": kind,
            "place_label": context_location_label(state.user_context),
            "audience_cluster": cluster,
            "signal_refs": list(dict.fromkeys(ref for ref in signal_refs if ref)),
            "source_ref": list(dict.fromkeys(ref for ref in source_refs if ref))[:3],
            "evidence_signals": list(evidence_signals)[:4],
            "evidence_refs": list(dict.fromkeys(ref for ref in evidence_refs if ref))[:4],
            "evidence_type": evidence_types[0] if evidence_types else "",
        }

    def _source_type_label(self, state: OrchestrationState, *, saved_persona_hints: Optional[Sequence[PersonaProfile]] = None) -> str:
        if state.persona_source_mode == PersonaSourceMode.SAVED_PLACE_PERSONAS.value or saved_persona_hints:
            return "saved_hints_assisted"
        if state.persona_source_mode == PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value or not self._research_signal_texts(state):
            return "audience_only_fallback"
        return "dynamic_hybrid"

    def _dataset_source_type(self, state: OrchestrationState) -> str:
        return self._source_type_label(state)

    def _coverage_target_count(self, state: OrchestrationState, *, signal_plan: Dict[str, Any], requested_count: int) -> int:
        segment_count = max(1, len(signal_plan.get("dynamic_segments") or signal_plan.get("audience_clusters") or []))
        minimum_threshold = self._minimum_persona_threshold(state)
        if self._has_enough_data(state):
            target = max(minimum_threshold, min(requested_count, segment_count * 5))
        else:
            target = max(minimum_threshold, min(requested_count, segment_count * 4))
        return max(minimum_threshold, min(self.HARD_MAX_PERSONAS, target))

    def _price_positioning_bucket(self, *, price_sensitivity: str, monetization: str, idea_text: str) -> str:
        joined = " ".join([str(price_sensitivity or ""), str(monetization or ""), str(idea_text or "")]).lower()
        if any(token in joined for token in ("cheap", "budget", "affordable", "low-cost", "discount", "اقتصادي", "رخيص")):
            return "budget"
        if any(token in joined for token in ("premium", "luxury", "vip", "high-end", "فاخر")):
            return "premium"
        return "mid"

    def _usage_context(self, *, idea_text: str, delivery_model: str, value_proposition: str) -> str:
        joined = " ".join([str(idea_text or ""), str(delivery_model or ""), str(value_proposition or "")]).lower()
        if any(token in joined for token in ("delivery", "whatsapp", "subscription", "recurring", "remote", "online")):
            return "convenience-led"
        if any(token in joined for token in ("study", "work", "office", "campus", "famil")):
            return "routine-led"
        return "mixed-use"

    def _service_level_bucket(self, *, idea_text: str, value_proposition: str, monetization: str) -> str:
        joined = " ".join([str(idea_text or ""), str(value_proposition or ""), str(monetization or "")]).lower()
        if any(token in joined for token in ("premium", "luxury", "high-end", "exclusive", "فاخر")):
            return "premium"
        if any(token in joined for token in ("fast", "quick", "simple", "basic", "starter", "اقتصادي")):
            return "practical"
        return "balanced"

    def _cultural_factors(self, *, place_label: str, price_sensitivity: str, objections: Sequence[str], behaviors: Sequence[str]) -> List[str]:
        factors: List[str] = []
        if place_label:
            factors.append(f"Local context matters in {place_label}.")
        if str(price_sensitivity or "").lower() == "high":
            factors.append("Price comparison is likely to be strong.")
        if any("trust" in str(item).lower() for item in objections):
            factors.append("Trust and consistency matter in purchase decisions.")
        if any("comparison" in str(item).lower() or "promo" in str(item).lower() for item in behaviors):
            factors.append("People compare alternatives before committing.")
        return self._string_list(factors, fallback=[], limit=5)

    def _fallback_dynamic_segments(
        self,
        *,
        state: OrchestrationState,
        place_label: str,
        structured_inputs: Dict[str, Any],
        market_grounding: Dict[str, Any],
        saved_persona_hints: Sequence[PersonaProfile],
    ) -> List[Dict[str, Any]]:
        base_clusters = list(structured_inputs.get("audience_clusters") or self._audience_clusters(state))
        user_types = [str(item).strip() for item in market_grounding.get("user_types") or [] if str(item).strip()]
        objections = [str(item).strip() for item in market_grounding.get("local_objections") or [] if str(item).strip()]
        ladder_themes = self._ladder_theme_pool(structured_inputs.get("signal_catalog") or [])
        price_bucket = "high" if str(market_grounding.get("price_sensitivity") or "").lower() == "high" else "low" if str(market_grounding.get("price_sensitivity") or "").lower() == "low" else "medium"
        hint_clusters = [persona.target_audience_cluster for persona in saved_persona_hints if persona.target_audience_cluster]
        results: List[Dict[str, Any]] = []
        for index, cluster in enumerate(base_clusters[:8]):
            if not isinstance(cluster, dict):
                continue
            cluster_name = str(cluster.get("cluster") or "").strip()
            roles = self._string_list(cluster.get("roles"), fallback=user_types, limit=4)
            motivations = self._string_list(cluster.get("motivations"), fallback=list(structured_inputs.get("behaviors") or []), limit=4)
            concerns = self._string_list(cluster.get("concerns"), fallback=objections, limit=4)
            if len(roles) < 3:
                roles = self._string_list(roles + user_types + ladder_themes.get("roles", []), fallback=roles + user_types + ladder_themes.get("roles", []), limit=4)
            if len(concerns) < 3:
                concerns = self._string_list(concerns + objections + ladder_themes.get("concerns", []), fallback=concerns + objections + ladder_themes.get("concerns", []), limit=4)
            if len(motivations) < 3:
                motivations = self._string_list(
                    motivations + list(structured_inputs.get("behaviors") or []) + ladder_themes.get("motivations", []),
                    fallback=motivations + list(structured_inputs.get("behaviors") or []) + ladder_themes.get("motivations", []),
                    limit=4,
                )
            speaking_styles = self._string_list(cluster.get("speaking_styles"), fallback=["clear", "practical"], limit=4)
            age_bands = self._string_list(cluster.get("age_bands"), fallback=["25-34", "30-44"], limit=3)
            life_stages = self._string_list(cluster.get("life_stages"), fallback=["early career", "habit builder"], limit=3)
            archetype_name = cluster_name or "General Audience"
            segment_id = self._slug(f"{cluster_name or 'segment'}-{index + 1}")[:64]
            purchase_triggers = self._string_list(
                list(motivations[:2]) + [str((market_grounding.get("idea_understanding") or {}).get("usage_context") or "").strip()],
                fallback=["clear value", "routine fit"],
                limit=3,
            )
            rejection_triggers = self._string_list(
                list(concerns[:2]) + list(objections[:1]),
                fallback=["weak value", "poor differentiation"],
                limit=3,
            )
            rationale_parts = [cluster_name] + roles[:1] + hint_clusters[:1]
            results.append(
                {
                    "cluster": cluster_name,
                    "segment_id": segment_id,
                    "source_kind": str(cluster.get("source_kind") or self._normalize_source_kind(None, state, place_label)),
                    "rationale": " | ".join(part for part in rationale_parts if part)[:240],
                    "signal_refs": self._string_list(cluster.get("signal_refs"), fallback=[self._slug(cluster_name)[:48]], limit=4),
                    "roles": roles,
                    "motivations": motivations,
                    "concerns": concerns,
                    "speaking_styles": speaking_styles,
                    "age_bands": age_bands,
                    "life_stages": life_stages,
                    "archetype_name": archetype_name,
                    "price_sensitivity_bucket": price_bucket,
                    "decision_style": "price-first" if price_bucket == "high" else "comparison-led" if user_types else "fit-first",
                    "purchase_triggers": purchase_triggers,
                    "rejection_triggers": rejection_triggers,
                }
            )
        return results

    def _normalize_dynamic_clusters(
        self,
        *,
        state: OrchestrationState,
        place_label: str,
        clusters: Sequence[Dict[str, Any]],
        fallback_clusters: Sequence[Dict[str, Any]],
        market_grounding: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        fallback_by_name = {
            str(item.get("cluster") or "").strip().lower(): item
            for item in fallback_clusters
            if isinstance(item, dict)
        }
        default_price_bucket = "high" if str(market_grounding.get("price_sensitivity") or "").lower() == "high" else "medium"
        for index, item in enumerate(clusters):
            if not isinstance(item, dict):
                continue
            cluster_name = str(item.get("cluster") or "").strip()
            if not cluster_name:
                continue
            fallback = fallback_by_name.get(cluster_name.lower(), fallback_clusters[index % len(fallback_clusters)] if fallback_clusters else {})
            normalized.append(
                {
                    "cluster": cluster_name,
                    "segment_id": str(item.get("segment_id") or fallback.get("segment_id") or self._slug(f"{cluster_name}-{index + 1}")[:64]),
                    "source_kind": self._normalize_source_kind(item.get("source_kind"), state, place_label),
                    "rationale": str(item.get("rationale") or fallback.get("rationale") or f"Grounded in current market signals for {cluster_name}.").strip(),
                    "signal_refs": self._string_list(item.get("signal_refs"), fallback=list(fallback.get("signal_refs") or []), limit=4),
                    "roles": self._string_list(item.get("roles"), fallback=list(fallback.get("roles") or []), limit=4),
                    "motivations": self._string_list(item.get("motivations"), fallback=list(fallback.get("motivations") or []), limit=4),
                    "concerns": self._string_list(item.get("concerns"), fallback=list(fallback.get("concerns") or []), limit=4),
                    "speaking_styles": self._string_list(item.get("speaking_styles"), fallback=list(fallback.get("speaking_styles") or []), limit=4),
                    "age_bands": self._string_list(item.get("age_bands"), fallback=list(fallback.get("age_bands") or []), limit=3),
                    "life_stages": self._string_list(item.get("life_stages"), fallback=list(fallback.get("life_stages") or []), limit=3),
                    "archetype_name": str(item.get("archetype_name") or fallback.get("archetype_name") or cluster_name).strip(),
                    "price_sensitivity_bucket": str(item.get("price_sensitivity_bucket") or fallback.get("price_sensitivity_bucket") or default_price_bucket).strip().lower() or default_price_bucket,
                    "decision_style": str(item.get("decision_style") or fallback.get("decision_style") or "comparison-led").strip(),
                    "purchase_triggers": self._string_list(item.get("purchase_triggers"), fallback=list(fallback.get("purchase_triggers") or []), limit=3),
                    "rejection_triggers": self._string_list(item.get("rejection_triggers"), fallback=list(fallback.get("rejection_triggers") or []), limit=3),
                }
            )
        return normalized or list(fallback_clusters)

    def _pattern_summary(self, signal_plan: Dict[str, Any]) -> str:
        signals = self._string_list(signal_plan.get("evidence_signals"), fallback=[], limit=4)
        clusters = signal_plan.get("dynamic_segments") if isinstance(signal_plan.get("dynamic_segments"), list) and signal_plan.get("dynamic_segments") else signal_plan.get("audience_clusters") if isinstance(signal_plan.get("audience_clusters"), list) else []
        cluster_labels = [str(item.get("cluster") or "").strip() for item in clusters[:3] if isinstance(item, dict) and str(item.get("cluster") or "").strip()]
        sentiment = signal_plan.get("social_sentiment") if isinstance(signal_plan.get("social_sentiment"), dict) else {}
        market_grounding = signal_plan.get("market_grounding") if isinstance(signal_plan.get("market_grounding"), dict) else {}
        parts = []
        if signals:
            parts.append("Signals: " + " | ".join(signals))
        if cluster_labels:
            parts.append("Dynamic segments: " + " | ".join(cluster_labels))
        if sentiment:
            parts.append(f"Sentiment: {sentiment}")
        if market_grounding:
            parts.append(
                "Grounding: "
                + " | ".join(
                    self._string_list(
                        list(market_grounding.get("local_objections") or []) + list(market_grounding.get("competitor_references") or []),
                        fallback=[],
                        limit=3,
                    )
                )
            )
        return " | ".join(parts)[:500]

    def _normalized_audiences(self, state: OrchestrationState) -> List[str]:
        explicit = [str(item).strip().lower() for item in (state.user_context.get("targetAudience") or []) if str(item).strip()]
        return explicit or self._default_audience_keys(state)

    def _default_audience_keys(self, state: OrchestrationState) -> List[str]:
        category = str(state.user_context.get("category") or "").lower()
        if "saas" in category or "technology" in category:
            return ["developers", "working professionals", "small business owners"]
        if "education" in category:
            return ["students", "parents", "working professionals"]
        if "health" in category:
            return ["parents", "working professionals", "consumers"]
        if "finance" in category:
            return ["working professionals", "small business owners", "investors"]
        return ["consumers", "working professionals", "gen z"]

    def _audience_clusters(self, state: OrchestrationState) -> List[Dict[str, Any]]:
        clusters: List[Dict[str, Any]] = []
        place_label = context_location_label(state.user_context)
        for key in self._normalized_audiences(state):
            family = DEFAULT_AUDIENCE_FAMILIES.get(key.lower()) or DEFAULT_AUDIENCE_FAMILIES["consumers"]
            clusters.append({
                "cluster": family["cluster"],
                "source_kind": self._normalize_source_kind(None, state, place_label),
                "rationale": f"Derived from target audience '{key}'.",
                "signal_refs": [self._slug(f"{family['cluster']}-{key}")[:64]],
                "roles": list(family["roles"]),
                "motivations": list(family["motivations"]),
                "concerns": list(family["concerns"]),
                "speaking_styles": list(family["speaking_styles"]),
                "age_bands": list(family["age_bands"]),
                "life_stages": list(family["life_stages"]),
            })
        return clusters

    def _social_sentiment(self, state: OrchestrationState) -> Dict[str, Any]:
        structured = state.research.structured_schema if state.research else {}
        fragments = " ".join([
            str((state.research.summary if state.research else "") or ""),
            " ".join((state.research.findings if state.research else [])[:8]),
            " ".join((item.snippet or item.content or item.title or "") for item in (state.research.evidence if state.research else [])[:6]),
        ]).lower()
        positive_hits = sum(word in fragments for word in ["love", "fast", "trust", "popular", "growth", "convenient", "strong"])
        negative_hits = sum(word in fragments for word in ["expensive", "risk", "complaint", "slow", "weak", "unclear", "skeptical"])
        overall = "positive" if positive_hits >= negative_hits + 2 else "negative" if negative_hits >= positive_hits + 2 else "mixed"
        return {
            "overall": overall,
            "price_sensitivity": str(structured.get("price_sensitivity") or structured.get("quality", {}).get("price_sensitivity") or "medium"),
            "trust": "low" if "trust" in fragments and negative_hits > positive_hits else "medium" if overall == "mixed" else "high",
            "notable_themes": self._string_list((structured.get("signals") if isinstance(structured.get("signals"), list) else None) or (state.research.findings if state.research else []), fallback=[], limit=5),
        }

    def _evidence_signals(self, state: OrchestrationState) -> List[str]:
        signals: List[str] = []
        structured = state.research.structured_schema if state.research else {}
        for item in structured.get("signals") or []:
            text = str(item).strip()
            if text and text not in signals:
                signals.append(text)
        for item in (state.research.findings if state.research else [])[:10]:
            text = str(item).strip()
            if text and text not in signals:
                signals.append(text)
        for evidence in (state.research.evidence if state.research else [])[:8]:
            fragment = " ".join((evidence.snippet or evidence.content or evidence.title or "").split())[:180]
            if fragment and fragment not in signals:
                signals.append(fragment)
        return signals[:12]

    def _signal_fitted_blueprints(self, state: OrchestrationState, signal_plan: Dict[str, Any], count: int) -> List[Dict[str, Any]]:
        clusters = (
            signal_plan.get("dynamic_segments")
            if isinstance(signal_plan.get("dynamic_segments"), list) and signal_plan.get("dynamic_segments")
            else signal_plan.get("audience_clusters")
            if isinstance(signal_plan.get("audience_clusters"), list) and signal_plan.get("audience_clusters")
            else self._audience_clusters(state)
        )
        signals = list(signal_plan.get("evidence_signals") or [])
        place_label = context_location_label(state.user_context) or "Global"
        if not clusters or not signals:
            return []
        rows: List[Dict[str, Any]] = []
        approved_catalog = signal_plan.get("signal_catalog") if isinstance(signal_plan.get("signal_catalog"), list) else []
        cluster_iterations: Dict[str, int] = {}
        for index in range(max(0, count)):
            cluster = clusters[index % len(clusters)]
            if not isinstance(cluster, dict):
                continue
            cluster_name = str(cluster.get("cluster") or "").strip()
            segment_id = str(cluster.get("segment_id") or self._slug(f"{cluster_name}-{index + 1}")[:64]).strip()
            cluster_key = f"{cluster_name.lower()}::{segment_id.lower()}"
            cluster_iteration = cluster_iterations.get(cluster_key, 0)
            cluster_iterations[cluster_key] = cluster_iteration + 1
            roles = [str(item).strip() for item in cluster.get("roles") or [] if str(item).strip()]
            age_bands = [str(item).strip() for item in cluster.get("age_bands") or [] if str(item).strip()]
            life_stages = [str(item).strip() for item in cluster.get("life_stages") or [] if str(item).strip()]
            styles = [str(item).strip() for item in cluster.get("speaking_styles") or [] if str(item).strip()]
            motivations = [str(item).strip() for item in cluster.get("motivations") or [] if str(item).strip()]
            concerns = [str(item).strip() for item in cluster.get("concerns") or [] if str(item).strip()]
            signal_refs = [str(item).strip() for item in cluster.get("signal_refs") or [] if str(item).strip()]
            role = str((roles[cluster_iteration % len(roles)] if roles else "") or "").strip()
            if not all([role, cluster_name, age_bands, life_stages, styles, motivations, concerns]):
                continue
            rotated_concerns = concerns[cluster_iteration % len(concerns):] + concerns[: cluster_iteration % len(concerns)]
            rotated_motivations = motivations[cluster_iteration % len(motivations):] + motivations[: cluster_iteration % len(motivations)]
            persona_signals = self._select_cluster_persona_signals(
                cluster=cluster,
                signal_plan=signal_plan,
                fallback_signals=signals[index % len(signals): index % len(signals) + 2] or signals[:2],
            )
            source_kind = str(cluster.get("source_kind") or self._normalize_source_kind(None, state, place_label)).strip()
            catalog_matches = [
                item
                for item in approved_catalog
                if isinstance(item, dict)
                and str(item.get("text") or "").strip().lower() in {
                    str(signal).strip().lower() for signal in persona_signals if str(signal).strip()
                }
            ]
            evidence_refs = list(
                dict.fromkeys(
                    str(ref).strip()
                    for item in catalog_matches
                    for ref in (item.get("evidence_refs") or [])
                    if str(ref).strip()
                )
            )
            evidence_types = list(
                dict.fromkeys(
                    str(item.get("evidence_type") or "").strip()
                    for item in catalog_matches
                    if str(item.get("evidence_type") or "").strip()
                )
            )
            rows.append(
                {
                    "display_name": f"{place_label.split(',')[0]} {role.title()} {index + 1}",
                    "source_mode": source_kind,
                    "target_audience_cluster": cluster_name,
                    "segment_id": segment_id,
                    "location_context": place_label,
                    "age_band": age_bands[cluster_iteration % len(age_bands)],
                    "life_stage": life_stages[cluster_iteration % len(life_stages)],
                    "profession_role": role,
                    "attitude_baseline": f"reacts through {persona_signals[0][:48]}".strip(),
                    "skepticism_level": round(0.28 + ((index % 5) * 0.11), 2),
                    "conformity_level": round(0.22 + ((index % 4) * 0.13), 2),
                    "stubbornness_level": round(0.24 + ((index % 6) * 0.09), 2),
                    "innovation_openness": round(0.34 + ((index % 5) * 0.1), 2),
                    "financial_sensitivity": round(0.45 + ((index % 4) * 0.11), 2),
                    "style_of_speaking": styles[cluster_iteration % len(styles)],
                    "main_concerns": rotated_concerns[:3],
                    "probable_motivations": rotated_motivations[:3],
                    "influence_weight": round(0.85 + ((index % 5) * 0.12), 2),
                    "tags": self._fallback_tags(cluster_name, state),
                    "stance": ["accept", "neutral", "reject"][index % 3],
                    "summary": self._persona_summary(cluster_name, role, rotated_concerns[:2], rotated_motivations[:2], place_label),
                    "evidence_signals": persona_signals[:2],
                    "price_sensitivity_bucket": str(cluster.get("price_sensitivity_bucket") or "medium"),
                    "decision_style": str(cluster.get("decision_style") or "comparison-led"),
                    "purchase_trigger": str((cluster.get("purchase_triggers") or ["clear value"])[0]),
                    "rejection_trigger": str((cluster.get("rejection_triggers") or ["weak differentiation"])[0]),
                    "archetype_name": str(cluster.get("archetype_name") or cluster_name),
                    "source_attribution": {
                        "kind": source_kind,
                        "place_label": place_label,
                        "audience_cluster": cluster_name,
                        "signal_refs": signal_refs[:3],
                        "source_ref": signal_refs[:3],
                        "evidence_signals": persona_signals[:2],
                        "evidence_refs": evidence_refs[:4],
                        "evidence_type": evidence_types[0] if evidence_types else "",
                    },
                }
            )
        return rows

    def _merge_traits(
        self,
        base_traits: Dict[str, float],
        *,
        skepticism: float,
        conformity: float,
        stubbornness: float,
        innovation: float,
        financial: float,
        rng: random.Random,
        category_id: str,
        cluster: str,
        index: int,
    ) -> Dict[str, float]:
        traits = dict(base_traits)
        traits["skepticism"] = skepticism
        traits["openness_to_change"] = innovation
        traits["conformity"] = conformity
        traits["stubbornness"] = stubbornness
        traits["financial_sensitivity"] = financial
        traits["risk_tolerance"] = round(max(0.05, min(0.95, 1.0 - financial * 0.6 + rng.uniform(-0.05, 0.05))), 3)
        traits["dynamic_skepticism"] = round(max(0.05, min(0.95, skepticism + rng.uniform(-0.06, 0.06))), 3)
        traits["question_drive"] = round(max(0.05, min(0.98, 0.24 + skepticism * 0.55 + rng.uniform(-0.05, 0.05))), 3)
        traits["evidence_affinity"] = round(max(0.1, min(0.99, 0.38 + innovation * 0.36 + skepticism * 0.12 + rng.uniform(-0.05, 0.05))), 3)
        traits["inertia"] = round(max(0.08, min(0.98, 0.22 + stubbornness * 0.5 + conformity * 0.18 + rng.uniform(-0.05, 0.05))), 3)
        traits["representative_weight"] = round(max(0.3, min(2.0, 0.72 + rng.uniform(-0.1, 0.16))), 3)
        traits["cluster_id"] = f"{category_id}:{self._slug(cluster)}:{index % 11}"
        return traits

    def _normalize_opinion(self, value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw in {"accept", "approve", "positive", "support"}:
            return "accept"
        if raw in {"reject", "negative", "oppose"}:
            return "reject"
        return "neutral"

    def _normalize_source_kind(self, raw: Any, state: OrchestrationState, place_label: str) -> str:
        value = str(raw or "").strip().lower()
        if value in {"place_derived", "audience_default", "hybrid", "research_signal", "audience_fallback"}:
            return value
        if state.persona_source_mode == PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value:
            return "audience_fallback"
        if place_label and self._normalized_audiences(state):
            return "hybrid"
        if place_label:
            return "research_signal"
        return "audience_fallback"

    def _string_list(self, value: Any, *, fallback: Sequence[str], limit: int) -> List[str]:
        if isinstance(value, list):
            items = [str(item).strip() for item in value if str(item).strip()]
            if items:
                return items[:limit]
        return [str(item).strip() for item in fallback if str(item).strip()][:limit]

    def _fallback_tags(self, cluster: str, state: OrchestrationState) -> List[str]:
        tags = [self._slug(cluster) or "audience"]
        if context_location_label(state.user_context):
            tags.append("place-aware")
        if state.user_context.get("category"):
            tags.append(self._slug(str(state.user_context.get("category"))))
        tags.append("research-grounded")
        return list(dict.fromkeys(tag for tag in tags if tag))[:5]

    def _persona_summary(self, cluster: str, role: str, concerns: Sequence[str], motivations: Sequence[str], place_label: str) -> str:
        place = place_label or "the market"
        concern_text = ", ".join(concerns[:2]) or "documented concerns"
        motivation_text = ", ".join(motivations[:2]) or "documented motivations"
        return f"{cluster} persona in {place}, working as {role}, motivated by {motivation_text} but worried about {concern_text}."

    def _library_label(self, state: OrchestrationState, place_label: str) -> str:
        if place_label:
            return place_label
        audiences = ", ".join(item.title() for item in self._normalized_audiences(state))
        return f"Audience: {audiences}" if audiences else "Global Audience"

    def _place_key(self, label: str) -> str:
        return ("-".join(part for part in str(label or "").lower().replace(",", " ").split() if part) or "global")[:191]

    def _source_summary(self, signal_plan: Dict[str, Any]) -> str:
        sentiment = signal_plan.get("social_sentiment") if isinstance(signal_plan.get("social_sentiment"), dict) else {}
        themes = self._string_list(sentiment.get("notable_themes") if isinstance(sentiment, dict) else None, fallback=[], limit=3)
        signals = self._string_list(signal_plan.get("evidence_signals"), fallback=[], limit=3)
        user_types = self._string_list(signal_plan.get("user_types"), fallback=[], limit=2)
        complaints = self._string_list(signal_plan.get("complaints"), fallback=[], limit=2)
        segment_labels = [
            str(item.get("cluster") or "").strip()
            for item in (signal_plan.get("dynamic_segments") or signal_plan.get("audience_clusters") or [])[:3]
            if isinstance(item, dict) and str(item.get("cluster") or "").strip()
        ]
        parts = []
        if themes:
            parts.append("Themes: " + " | ".join(themes))
        if signals:
            parts.append("Signals: " + " | ".join(signals))
        if segment_labels:
            parts.append("Segments: " + " | ".join(segment_labels))
        if user_types:
            parts.append("User types: " + " | ".join(user_types))
        if complaints:
            parts.append("Complaints: " + " | ".join(complaints))
        return " | ".join(parts)[:320]

    def _quality_score(self, *, actual_count: int, requested_count: int, duplicates: int, weak: int, enough_data: bool) -> float:
        coverage = actual_count / max(1, requested_count)
        penalty = min(0.32, (duplicates * 0.01) + (weak * 0.012))
        bonus = 0.12 if enough_data else 0.0
        return round(max(0.1, min(0.98, 0.46 + (coverage * 0.38) + bonus - penalty)), 3)

    def _clamp(self, value: Any, minimum: float, maximum: float, *, fallback: float) -> float:
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            parsed = fallback
        return max(minimum, min(maximum, parsed))

    def _slug(self, value: str) -> str:
        return "-".join(part for part in str(value or "").lower().replace("/", " ").replace("_", " ").split() if part)

    def _fingerprint(self, state: OrchestrationState) -> str:
        seed = "|".join([
            str(state.user_context.get("idea") or ""),
            str(state.user_context.get("category") or ""),
            context_location_label(state.user_context),
            ",".join(self._normalized_audiences(state)),
            str((state.research.summary if state.research else "") or ""),
            str(state.persona_source_mode or ""),
            "persona_asset_v2",
        ])
        return hashlib.sha1(seed.encode("utf-8")).hexdigest()

    def _hydrate_personas(self, payload: Dict[str, Any]) -> List[PersonaProfile]:
        personas: List[PersonaProfile] = []
        for item in payload.get("personas") or []:
            if not isinstance(item, dict):
                continue
            personas.append(
                apply_persona_dynamic_defaults(PersonaProfile(
                    persona_id=str(item.get("persona_id") or item.get("id") or uuid.uuid4()),
                    name=str(item.get("display_name") or item.get("name") or ""),
                    source_mode=str(item.get("source_mode") or ""),
                    target_audience_cluster=str(item.get("target_audience_cluster") or ""),
                    segment_id=str(item.get("segment_id") or item.get("cluster_id") or item.get("target_audience_cluster") or self._slug(str(item.get("display_name") or item.get("name") or ""))[:64]),
                    location_context=str(item.get("location_context") or item.get("location") or ""),
                    age_band=str(item.get("age_band") or ""),
                    life_stage=str(item.get("life_stage") or ""),
                    profession_role=str(item.get("profession_role") or ""),
                    attitude_baseline=str(item.get("attitude_baseline") or ""),
                    skepticism_level=float(item.get("skepticism_level") or 0.5),
                    conformity_level=float(item.get("conformity_level") or 0.5),
                    stubbornness_level=float(item.get("stubbornness_level") or 0.5),
                    innovation_openness=float(item.get("innovation_openness") or 0.5),
                    financial_sensitivity=float(item.get("financial_sensitivity") or 0.5),
                    speaking_style=str(item.get("speaking_style") or item.get("style_of_speaking") or ""),
                    tags=[str(value) for value in item.get("tags") or [] if str(value).strip()],
                    source_attribution=dict(item.get("source_attribution") or {}),
                    evidence_signals=[str(value) for value in item.get("evidence_signals") or [] if str(value).strip()],
                    category_id=str(item.get("category_id") or ""),
                    template_id=str(item.get("template_id") or ""),
                    archetype_name=str(item.get("archetype_name") or item.get("display_name") or item.get("name") or ""),
                    summary=str(item.get("summary") or ""),
                    motivations=[str(value) for value in item.get("probable_motivations") or item.get("motivations") or [] if str(value).strip()],
                    concerns=[str(value) for value in item.get("main_concerns") or item.get("concerns") or [] if str(value).strip()],
                    location=str(item.get("location") or ""),
                    price_sensitivity_bucket=str(item.get("price_sensitivity_bucket") or item.get("priceSensitivityBucket") or "medium"),
                    decision_style=str(item.get("decision_style") or item.get("decisionStyle") or "comparison-led"),
                    purchase_trigger=str(item.get("purchase_trigger") or item.get("purchaseTrigger") or "clear value"),
                    rejection_trigger=str(item.get("rejection_trigger") or item.get("rejectionTrigger") or "weak differentiation"),
                    opinion=str(item.get("opinion") or "neutral"),
                    confidence=float(item.get("confidence") or 0.5),
                    influence_weight=float(item.get("influence_weight") or 1.0),
                    traits=dict(item.get("traits") or {}),
                    biases=[str(value) for value in item.get("biases") or [] if str(value).strip()],
                    opinion_score=float(item.get("opinion_score") or 0.0),
                ))
            )
        return personas

    async def _publish_persona_event(
        self,
        state: OrchestrationState,
        *,
        action: str,
        status: str,
        title: str,
        snippet: str,
        progress_pct: int,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        await self.runtime.event_bus.publish(
            state,
            action,
            {
                "agent": self.name,
                "action": action,
                "status": status,
                "title": title,
                "snippet": snippet[:420],
                "progress_pct": progress_pct,
                "meta": meta or {},
            },
            persist_research=True,
        )
