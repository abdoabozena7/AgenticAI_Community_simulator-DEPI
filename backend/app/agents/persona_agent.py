from __future__ import annotations

import hashlib
import math
import random
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

from ..models.orchestration import (
    IdeaContextType,
    OrchestrationState,
    PersonaProfile,
    PersonaSourceMode,
    context_location_label,
)
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

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        if not state.search_completed or state.research is None:
            raise RuntimeError("Persona generation requires completed search results")
        if not state.persona_source_mode:
            raise RuntimeError("Persona source is unresolved")

        place_label = context_location_label(state.user_context)
        requested_count = self._target_persona_count(state)
        state.persona_set = None
        state.persona_validation_errors = []
        state.persona_generation_debug = {}

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
        signal_plan = await self._build_signal_plan(state=state, place_label=place_label or "global")
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
            },
        )

        state.set_pipeline_step(
            "generating_personas",
            "running",
            detail=f"Generating simulation-ready personas from {state.persona_source_mode}.",
        )

        if state.persona_source_mode == PersonaSourceMode.SAVED_PLACE_PERSONAS.value:
            personas, report = await self._load_saved_personas(state=state, place_label=place_label or "global")
        else:
            personas, report = await self._generate_personas(
                state=state,
                signal_plan=signal_plan,
                requested_count=requested_count,
                place_label=place_label or "global",
            )

        validation = self._validate_personas(
            personas=personas,
            signal_plan=signal_plan,
            state=state,
            target_count=requested_count,
            strict_target=self._has_enough_data(state),
        )
        state.persona_validation_errors = list(validation["errors"])
        report["validation"] = validation
        report["social_sentiment"] = signal_plan.get("social_sentiment") or {}
        report["evidence_signals"] = signal_plan.get("evidence_signals") or []
        report["target_count"] = requested_count
        report["actual_count"] = len(personas)
        report["source_mode"] = state.persona_source_mode
        state.persona_generation_debug = report
        state.schema["persona_generation_report"] = report
        state.schema["persona_count_actual"] = len(personas)
        state.schema["persona_source"] = state.persona_source_mode

        if validation["errors"]:
            await self._publish_persona_event(
                state,
                action="persona_validation_failed",
                status="failed",
                title="Persona validation failed",
                snippet=" | ".join(validation["errors"])[:320],
                progress_pct=86,
                meta=validation,
            )
            raise RuntimeError(f"Persona validation failed: {', '.join(validation['errors'])}")

        state.personas = personas
        state.persona_generation_completed = True
        state.set_pipeline_step("generating_personas", "completed", detail=report.get("message") or f"Generated {len(personas)} personas.")
        await self._publish_persona_event(
            state,
            action="persona_validation_passed",
            status="ok",
            title="Persona validation passed",
            snippet=report.get("message") or f"Generated {len(personas)} simulation-ready personas.",
            progress_pct=90,
            meta={
                "duplicate_rejection_count": report.get("duplicate_rejection_count", 0),
                "final_persona_count": len(personas),
                "diversity": validation.get("diversity"),
            },
        )
        return state

    async def persist(self, state: OrchestrationState) -> OrchestrationState:
        if not state.persona_source_mode:
            raise RuntimeError("Persona source is unresolved")
        if not state.persona_generation_completed or not state.personas:
            raise RuntimeError("Persona generation must finish before persistence")
        if state.persona_validation_errors:
            raise RuntimeError(f"Persona persistence blocked by validation errors: {', '.join(state.persona_validation_errors)}")

        place_label = context_location_label(state.user_context)
        library_label = self._library_label(state, place_label)
        place_key = self._place_key(library_label)
        audience_filters = self._normalized_audiences(state)
        fingerprint = self._fingerprint(state)
        generation_report = dict(state.persona_generation_debug or {})

        state.set_pipeline_step("saving_personas", "running", detail="Persisting persona records and the shared persona set.")
        await self._publish_persona_event(
            state,
            action="persona_persistence_started",
            status="running",
            title="Persisting persona asset",
            snippet="Saving persona records, set metadata, and reusable asset references.",
            progress_pct=92,
        )

        if state.persona_source_mode != PersonaSourceMode.SAVED_PLACE_PERSONAS.value:
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
                    "social_sentiment": generation_report.get("social_sentiment") or {},
                    "research_summary": str((state.research.summary if state.research else "") or ""),
                },
                generation_config={
                    "requested_count": generation_report.get("target_count"),
                    "actual_count": generation_report.get("actual_count"),
                    "batch_size": generation_report.get("batch_size"),
                    "batch_count": generation_report.get("batch_count"),
                    "context_type": state.idea_context_type,
                    "source_mode": state.persona_source_mode,
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
                        "source_summary": generation_report.get("source_summary"),
                        "evidence_summary": {
                            "signals": generation_report.get("evidence_signals") or [],
                            "social_sentiment": generation_report.get("social_sentiment") or {},
                        },
                        "generation_config": {
                            "requested_count": generation_report.get("target_count"),
                            "actual_count": generation_report.get("actual_count"),
                            "batch_size": generation_report.get("batch_size"),
                            "batch_count": generation_report.get("batch_count"),
                        },
                        "quality_score": generation_report.get("quality_score"),
                        "confidence_score": generation_report.get("confidence_score"),
                        "quality_meta": generation_report.get("quality_meta") or {},
                        "validation_meta": generation_report.get("validation") or {},
                        "reusable_dataset_ref": fingerprint,
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
        }

        await self.runtime.repository.persist_personas(
            state.simulation_id,
            [persona.to_agent_row() for persona in state.personas],
        )
        state.persona_persistence_completed = True
        blockers = state.validate_pipeline_ready_for_simulation()
        if blockers:
            raise RuntimeError(f"Simulation blocked until pipeline completes: {', '.join(blockers)}")
        state.set_pipeline_step(
            "saving_personas",
            "completed",
            detail=f"Saved {len(state.personas)} personas and shared persona set metadata.",
        )
        await self._publish_persona_event(
            state,
            action="persona_persistence_completed",
            status="ok",
            title="Persona asset saved",
            snippet=f"Saved {len(state.personas)} personas. Shared set: {state.persona_set.get('place_label')}.",
            progress_pct=100,
            meta={
                "final_persona_count": len(state.personas),
                "persistence_status": "completed",
                "persona_set": state.persona_set,
            },
        )
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
                source_mode=PersonaSourceMode.GENERATE_NEW_FROM_PLACE.value,
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
                batch_goal=batch_goal + 2,
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
        if enough_data and actual_count < self.TARGET_MIN_PERSONAS:
            message = f"Only {actual_count} personas passed validation despite sufficient research. Validation will block simulation."
        elif actual_count < self.TARGET_MIN_PERSONAS:
            message = f"Data was limited, so generated the maximum reliable set of {actual_count} personas."
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
            },
            "message": message,
            "source_summary": self._source_summary(signal_plan),
        }

    async def _build_signal_plan(self, *, state: OrchestrationState, place_label: str) -> Dict[str, Any]:
        evidence_signals = self._evidence_signals(state)
        audience_clusters = self._audience_clusters(state)
        social_sentiment = self._social_sentiment(state)
        fallback = {
            "evidence_signals": evidence_signals[:12],
            "social_sentiment": social_sentiment,
            "audience_clusters": audience_clusters,
            "archetype_hypotheses": [cluster["cluster"] for cluster in audience_clusters[:6]],
            "confidence_score": 0.45 if self._has_enough_data(state) else 0.32,
        }
        prompt = (
            f"Idea: {state.user_context.get('idea')}\n"
            f"Category: {state.user_context.get('category')}\n"
            f"Place context: {place_label or 'none'}\n"
            f"Persona source mode: {state.persona_source_mode}\n"
            f"Target audiences: {', '.join(self._normalized_audiences(state)) or 'none'}\n"
            f"Research summary: {str((state.research.summary if state.research else '') or '')[:900]}\n"
            f"Research findings: {' | '.join((state.research.findings if state.research else [])[:8])}\n"
            f"Evidence signals: {' | '.join(evidence_signals[:12])}\n"
            f"Default audience families: {', '.join(cluster['cluster'] for cluster in audience_clusters[:8])}\n\n"
            "Transform these signals into a persona fitting plan. Return JSON only with:\n"
            '{"evidence_signals":[""],'
            '"social_sentiment":{"overall":"positive|mixed|negative","price_sensitivity":"low|medium|high","trust":"low|medium|high","notable_themes":[""]},'
            '"audience_clusters":[{"cluster":"","source_kind":"place_derived|audience_default|hybrid","rationale":"","roles":[""],"motivations":[""],"concerns":[""],"speaking_styles":[""],"age_bands":[""],"life_stages":[""]}],'
            '"archetype_hypotheses":[""],'
            '"confidence_score":0.0}'
        )
        system = (
            "You are a persona-systems fitting engine. "
            "Infer realistic audience clusters from research, place context, target audience, and default audience families. "
            "Do not invent unsupported demographics."
        )
        raw = await self.runtime.llm.generate_json(
            prompt=prompt,
            system=system,
            temperature=0.2,
            fallback_json=fallback,
        )
        if not isinstance(raw, dict):
            return fallback
        return {
            "evidence_signals": self._string_list(raw.get("evidence_signals"), fallback=evidence_signals[:12], limit=12),
            "social_sentiment": raw.get("social_sentiment") if isinstance(raw.get("social_sentiment"), dict) else social_sentiment,
            "audience_clusters": raw.get("audience_clusters") if isinstance(raw.get("audience_clusters"), list) and raw.get("audience_clusters") else audience_clusters,
            "archetype_hypotheses": self._string_list(raw.get("archetype_hypotheses"), fallback=[cluster["cluster"] for cluster in audience_clusters], limit=10),
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
        clusters = signal_plan.get("audience_clusters") if isinstance(signal_plan.get("audience_clusters"), list) else []
        prompt = (
            f"Idea: {state.user_context.get('idea')}\n"
            f"Context type: {state.idea_context_type or IdeaContextType.GENERAL_NON_LOCATION.value}\n"
            f"Persona source mode: {state.persona_source_mode}\n"
            f"Batch {batch_number} of {batch_count}\n"
            f"Need up to {batch_goal} personas for this batch.\n"
            f"Existing names to avoid: {', '.join(existing_names) or 'none'}\n"
            f"Social sentiment: {signal_plan.get('social_sentiment')}\n"
            f"Audience clusters: {clusters}\n"
            f"Evidence signals:\n{evidence_lines}\n\n"
            "Return JSON only with a personas array. Each persona must include display_name, source_mode, "
            "target_audience_cluster, location_context, age_band, life_stage, profession_role, attitude_baseline, "
            "skepticism_level, conformity_level, stubbornness_level, innovation_openness, financial_sensitivity, "
            "style_of_speaking, main_concerns, probable_motivations, influence_weight, tags, stance, summary, and evidence_signals."
        )
        system = (
            "You are generating simulation-ready human personas from research evidence. "
            "Avoid clones. Vary age band, profession, speaking style, money sensitivity, skepticism, and motivations."
        )
        return await self.runtime.llm.generate_json(
            prompt=prompt,
            system=system,
            temperature=0.35,
            fallback_json={"personas": self._fallback_blueprints(state, signal_plan, batch_goal)},
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
        template_pool = list(self.runtime.dataset.templates_by_category.get(category) or self.runtime.dataset.templates)
        if not template_pool:
            return [], {"duplicate": 0, "weak": requested_count}
        source_rows = blueprint.get("personas") if isinstance(blueprint.get("personas"), list) else []
        if not source_rows:
            source_rows = self._fallback_blueprints(state, signal_plan, requested_count)

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
            concerns = self._string_list(item.get("main_concerns") or item.get("concerns"), fallback=self._fallback_concerns(signal_plan, cluster), limit=4)
            motivations = self._string_list(item.get("probable_motivations") or item.get("motivations"), fallback=self._fallback_motivations(signal_plan, cluster), limit=4)
            tags = self._string_list(item.get("tags"), fallback=self._fallback_tags(cluster, state), limit=5)
            evidence_signals = self._string_list(item.get("evidence_signals"), fallback=list(signal_plan.get("evidence_signals") or [])[:3], limit=4)
            if not all([display_name, age_band, life_stage, profession_role, attitude_baseline, speaking_style, cluster]):
                weak_rejected += 1
                continue
            if len(concerns) < 2 or len(motivations) < 2 or len(tags) < 2 or len(evidence_signals) < 1:
                weak_rejected += 1
                continue

            signature = "|".join([cluster.lower(), age_band.lower(), profession_role.lower(), attitude_baseline.lower(), speaking_style.lower(), ",".join(sorted(text.lower() for text in concerns[:2]))])
            lowered_name = display_name.lower()
            if signature in signatures or lowered_name in used_names:
                duplicate_rejected += 1
                continue
            signatures.add(signature)
            used_names.add(lowered_name)

            template = template_pool[(seed_offset + index) % len(template_pool)]
            category_model = self.runtime.dataset.category_by_id.get(template.category_id)
            category_weight = float(category_model.base_influence_weight if category_model else 1.0)
            skepticism = self._clamp(item.get("skepticism_level"), 0.05, 0.95, fallback=float(template.traits.get("skepticism", 0.5)))
            conformity = self._clamp(item.get("conformity_level"), 0.05, 0.95, fallback=0.48)
            stubbornness = self._clamp(item.get("stubbornness_level"), 0.05, 0.95, fallback=0.46)
            innovation = self._clamp(item.get("innovation_openness"), 0.05, 0.95, fallback=float(template.traits.get("openness_to_change", 0.5)))
            financial = self._clamp(item.get("financial_sensitivity"), 0.05, 0.95, fallback=0.5)
            influence_weight = self._clamp(item.get("influence_weight"), 0.3, 2.0, fallback=round(category_weight * float(template.influence_susceptibility), 3))
            opinion = self._normalize_opinion(item.get("stance"))
            source_kind = self._normalize_source_kind(item.get("source_mode"), state, place_label)
            traits = self._merge_traits(
                template.traits,
                skepticism=skepticism,
                conformity=conformity,
                stubbornness=stubbornness,
                innovation=innovation,
                financial=financial,
                rng=rng,
                category_id=template.category_id,
                cluster=cluster,
                index=seed_offset + index,
            )
            personas.append(
                PersonaProfile(
                    persona_id=str(uuid.uuid4()),
                    name=display_name,
                    source_mode=source_kind,
                    target_audience_cluster=cluster,
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
                    source_attribution={"kind": source_kind, "place_label": place_label or "", "audience_cluster": cluster, "evidence_signals": evidence_signals},
                    evidence_signals=evidence_signals,
                    category_id=template.category_id,
                    template_id=template.template_id,
                    archetype_name=str(item.get("archetype_name") or cluster or template.archetype_name).strip(),
                    summary=str(item.get("summary") or self._persona_summary(cluster, profession_role, concerns, motivations, place_label)).strip(),
                    motivations=motivations[:4],
                    concerns=concerns[:4],
                    location=str(item.get("location_context") or place_label or "").strip(),
                    opinion=opinion,
                    confidence=round(self._clamp(item.get("confidence_score"), 0.38, 0.94, fallback=0.56 + rng.uniform(-0.06, 0.1)), 3),
                    influence_weight=round(influence_weight, 3),
                    traits=traits,
                    biases=self._string_list(item.get("biases"), fallback=list(template.biases), limit=4),
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
        errors: List[str] = []
        if not personas:
            errors.append("persona_count_zero")
        required_missing = 0
        names: set[str] = set()
        persona_ids: set[str] = set()
        attribution_missing = 0
        for persona in personas:
            if not all([persona.persona_id, persona.name, persona.source_mode, persona.target_audience_cluster, persona.age_band, persona.profession_role, persona.attitude_baseline, persona.speaking_style, persona.tags, persona.concerns, persona.motivations]):
                required_missing += 1
            lowered_name = persona.name.lower()
            if lowered_name in names:
                errors.append("duplicate_display_name")
                break
            names.add(lowered_name)
            if persona.persona_id in persona_ids:
                errors.append("duplicate_persona_id")
                break
            persona_ids.add(persona.persona_id)
            if not persona.source_attribution or not persona.source_attribution.get("kind"):
                attribution_missing += 1
        if required_missing:
            errors.append("schema_incomplete")
        if attribution_missing:
            errors.append("source_attribution_missing")

        clusters = {persona.target_audience_cluster for persona in personas if persona.target_audience_cluster}
        roles = {persona.profession_role for persona in personas if persona.profession_role}
        ages = {persona.age_band for persona in personas if persona.age_band}
        speaking_styles = {persona.speaking_style for persona in personas if persona.speaking_style}
        source_kinds = {persona.source_mode for persona in personas if persona.source_mode}
        diversity = {
            "cluster_count": len(clusters),
            "role_count": len(roles),
            "age_band_count": len(ages),
            "speaking_style_count": len(speaking_styles),
            "source_kind_count": len(source_kinds),
        }
        if len(personas) >= 12 and len(clusters) < 3:
            errors.append("diversity_cluster_too_low")
        if len(personas) >= 12 and len(roles) < 6:
            errors.append("diversity_role_too_low")
        if len(personas) >= 12 and len(ages) < 3:
            errors.append("diversity_age_too_low")
        if len(personas) >= 12 and len(speaking_styles) < 3:
            errors.append("diversity_speaking_style_too_low")
        allow_lower_target = bool(state.schema.get("allow_lower_persona_target"))
        if strict_target and len(personas) < self.TARGET_MIN_PERSONAS and not (allow_lower_target and target_count < self.TARGET_MIN_PERSONAS):
            errors.append("persona_count_below_required_minimum")

        return {
            "errors": list(dict.fromkeys(errors)),
            "diversity": diversity,
            "target_count": target_count,
            "actual_count": len(personas),
            "strict_target": strict_target,
            "signal_count": len(signal_plan.get("evidence_signals") or []),
        }

    def _target_persona_count(self, state: OrchestrationState) -> int:
        explicit_requested = state.schema.get("persona_count_requested")
        requested = int(explicit_requested if explicit_requested is not None else (state.user_context.get("agentCount") or 24))
        minimum_allowed = 10 if bool(state.schema.get("allow_lower_persona_target")) else 12
        requested = max(minimum_allowed, min(self.HARD_MAX_PERSONAS, requested))
        if explicit_requested is not None:
            return requested
        return max(self.TARGET_MIN_PERSONAS, requested) if self._has_enough_data(state) else min(24, requested)

    def _has_enough_data(self, state: OrchestrationState) -> bool:
        evidence_count = len((state.research.evidence if state.research else []) or [])
        findings_count = len((state.research.findings if state.research else []) or [])
        return evidence_count >= 6 or findings_count >= 6

    def _pattern_summary(self, signal_plan: Dict[str, Any]) -> str:
        signals = self._string_list(signal_plan.get("evidence_signals"), fallback=[], limit=4)
        clusters = signal_plan.get("audience_clusters") if isinstance(signal_plan.get("audience_clusters"), list) else []
        cluster_labels = [str(item.get("cluster") or "").strip() for item in clusters[:3] if isinstance(item, dict) and str(item.get("cluster") or "").strip()]
        sentiment = signal_plan.get("social_sentiment") if isinstance(signal_plan.get("social_sentiment"), dict) else {}
        parts = []
        if signals:
            parts.append("Signals: " + " | ".join(signals))
        if cluster_labels:
            parts.append("Clusters: " + " | ".join(cluster_labels))
        if sentiment:
            parts.append(f"Sentiment: {sentiment}")
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

    def _fallback_blueprints(self, state: OrchestrationState, signal_plan: Dict[str, Any], count: int) -> List[Dict[str, Any]]:
        clusters = signal_plan.get("audience_clusters") if isinstance(signal_plan.get("audience_clusters"), list) and signal_plan.get("audience_clusters") else self._audience_clusters(state)
        signals = list(signal_plan.get("evidence_signals") or self._evidence_signals(state))
        place_label = context_location_label(state.user_context) or "Global"
        rows: List[Dict[str, Any]] = []
        for index in range(max(0, count)):
            cluster = clusters[index % len(clusters)] if clusters else {"cluster": "Audience", "roles": ["buyer"], "age_bands": ["25-34"], "life_stages": ["adult"], "motivations": ["clear value"], "concerns": ["weak differentiation"], "speaking_styles": ["direct"], "source_kind": self._normalize_source_kind(None, state, place_label)}
            roles = cluster.get("roles") if isinstance(cluster, dict) else []
            age_bands = cluster.get("age_bands") if isinstance(cluster, dict) else []
            life_stages = cluster.get("life_stages") if isinstance(cluster, dict) else []
            styles = cluster.get("speaking_styles") if isinstance(cluster, dict) else []
            motivations = cluster.get("motivations") if isinstance(cluster, dict) else []
            concerns = cluster.get("concerns") if isinstance(cluster, dict) else []
            role = str((roles[index % len(roles)] if roles else "buyer") or "buyer")
            cluster_name = str((cluster.get("cluster") if isinstance(cluster, dict) else "Audience") or "Audience")
            rows.append({
                "display_name": f"{place_label.split(',')[0]} {role.title()} {index + 1}",
                "source_mode": cluster.get("source_kind") if isinstance(cluster, dict) else self._normalize_source_kind(None, state, place_label),
                "target_audience_cluster": cluster_name,
                "location_context": place_label,
                "age_band": str((age_bands[index % len(age_bands)] if age_bands else "25-34") or "25-34"),
                "life_stage": str((life_stages[index % len(life_stages)] if life_stages else "adult") or "adult"),
                "profession_role": role,
                "attitude_baseline": "curious but cautious",
                "skepticism_level": round(0.35 + ((index % 5) * 0.1), 2),
                "conformity_level": round(0.3 + ((index % 4) * 0.12), 2),
                "stubbornness_level": round(0.28 + ((index % 6) * 0.09), 2),
                "innovation_openness": round(0.32 + ((index % 5) * 0.11), 2),
                "financial_sensitivity": round(0.4 + ((index % 5) * 0.1), 2),
                "style_of_speaking": str((styles[index % len(styles)] if styles else "direct and practical") or "direct and practical"),
                "main_concerns": list(concerns[:3] or ["weak differentiation", "unclear value"]),
                "probable_motivations": list(motivations[:3] or ["clear value", "credible execution"]),
                "influence_weight": round(0.85 + ((index % 5) * 0.12), 2),
                "tags": self._fallback_tags(cluster_name, state),
                "stance": ["accept", "neutral", "reject"][index % 3],
                "summary": self._persona_summary(cluster_name, role, list(concerns[:2]), list(motivations[:2]), place_label),
                "evidence_signals": signals[index % max(1, len(signals)): index % max(1, len(signals)) + 2] or signals[:2],
            })
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
        if value in {"place_derived", "audience_default", "hybrid"}:
            return value
        if state.persona_source_mode == PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value:
            return "audience_default"
        if place_label and self._normalized_audiences(state):
            return "hybrid"
        if place_label:
            return "place_derived"
        return "audience_default"

    def _string_list(self, value: Any, *, fallback: Sequence[str], limit: int) -> List[str]:
        if isinstance(value, list):
            items = [str(item).strip() for item in value if str(item).strip()]
            if items:
                return items[:limit]
        return [str(item).strip() for item in fallback if str(item).strip()][:limit]

    def _fallback_motivations(self, signal_plan: Dict[str, Any], cluster: str) -> List[str]:
        for item in signal_plan.get("audience_clusters") or []:
            if isinstance(item, dict) and str(item.get("cluster") or "").strip().lower() == cluster.strip().lower():
                return self._string_list(item.get("motivations"), fallback=["clear value", "credible execution"], limit=4)
        return ["clear value", "credible execution", "low friction"]

    def _fallback_concerns(self, signal_plan: Dict[str, Any], cluster: str) -> List[str]:
        for item in signal_plan.get("audience_clusters") or []:
            if isinstance(item, dict) and str(item.get("cluster") or "").strip().lower() == cluster.strip().lower():
                return self._string_list(item.get("concerns"), fallback=["weak differentiation", "unclear demand"], limit=4)
        return ["weak differentiation", "unclear demand", "execution risk"]

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
        concern_text = ", ".join(concerns[:2]) or "execution risk"
        motivation_text = ", ".join(motivations[:2]) or "clear value"
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
        parts = []
        if themes:
            parts.append("Themes: " + " | ".join(themes))
        if signals:
            parts.append("Signals: " + " | ".join(signals))
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
                PersonaProfile(
                    persona_id=str(item.get("persona_id") or item.get("id") or uuid.uuid4()),
                    name=str(item.get("display_name") or item.get("name") or ""),
                    source_mode=str(item.get("source_mode") or ""),
                    target_audience_cluster=str(item.get("target_audience_cluster") or ""),
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
                    opinion=str(item.get("opinion") or "neutral"),
                    confidence=float(item.get("confidence") or 0.5),
                    influence_weight=float(item.get("influence_weight") or 1.0),
                    traits=dict(item.get("traits") or {}),
                    biases=[str(value) for value in item.get("biases") or [] if str(value).strip()],
                    opinion_score=float(item.get("opinion_score") or 0.0),
                )
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
