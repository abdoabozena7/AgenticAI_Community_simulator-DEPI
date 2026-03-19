from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..core import db as db_core
from ..models.orchestration import DialogueTurn, OrchestrationState, hydrate_state


class SimulationRepository:
    async def create_run(self, state: OrchestrationState) -> None:
        await db_core.insert_simulation(
            simulation_id=state.simulation_id,
            user_context=state.user_context,
            status=state.status,
            user_id=state.user_id,
        )
        await self.save_state(state)

    async def save_state(self, state: OrchestrationState) -> None:
        await db_core.update_simulation_context(state.simulation_id, state.user_context)
        await db_core.upsert_simulation_checkpoint(
            simulation_id=state.simulation_id,
            checkpoint=state.to_checkpoint(),
            status=state.status,
            last_error=state.error,
            status_reason=state.status_reason,
            current_phase_key=state.current_phase.value,
            phase_progress_pct=state.phase_progress_pct(),
            event_seq=state.event_seq,
        )

    async def finalize_run(self, state: OrchestrationState) -> None:
        ended_at = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        await db_core.update_simulation(
            simulation_id=state.simulation_id,
            status=state.status,
            summary=state.summary,
            ended_at=ended_at,
            final_metrics=state.metrics,
        )
        await self.save_state(state)

    async def load_state(self, simulation_id: str) -> Optional[OrchestrationState]:
        checkpoint = await db_core.fetch_simulation_checkpoint(simulation_id)
        if checkpoint and isinstance(checkpoint.get("checkpoint"), dict):
            payload = dict(checkpoint.get("checkpoint") or {})
            payload.setdefault("simulation_id", simulation_id)
            payload.setdefault("status", checkpoint.get("status"))
            payload.setdefault("status_reason", checkpoint.get("status_reason"))
            payload.setdefault("current_phase", checkpoint.get("current_phase_key"))
            payload.setdefault("event_seq", checkpoint.get("event_seq"))
            return hydrate_state(payload)
        snapshot = await db_core.fetch_simulation_snapshot(simulation_id)
        if not snapshot:
            return None
        payload = {
            "simulation_id": simulation_id,
            "user_context": snapshot.get("user_context") or {},
            "status": snapshot.get("status") or "running",
            "status_reason": snapshot.get("status_reason") or "running",
            "current_phase": snapshot.get("current_phase_key") or "idea_intake",
            "metrics": snapshot.get("metrics") or {},
            "summary": snapshot.get("summary") or "",
            "summary_ready": bool(snapshot.get("summary_ready")),
            "event_seq": int(snapshot.get("event_seq") or 0),
        }
        return hydrate_state(payload)

    async def persist_personas(self, simulation_id: str, agents: List[Dict[str, Any]]) -> None:
        await db_core.insert_agents(simulation_id, agents)

    async def update_persona_state(
        self,
        *,
        simulation_id: str,
        agent_id: str,
        opinion: str,
        confidence: float,
        phase: str,
        influence_weight: Optional[float] = None,
    ) -> None:
        await db_core.update_agent_state(
            simulation_id=simulation_id,
            agent_id=agent_id,
            opinion=opinion,
            confidence=confidence,
            phase=phase,
            influence_weight=influence_weight,
        )

    async def sync_persona_states(
        self,
        *,
        simulation_id: str,
        personas: List[Any],
        phase: str,
    ) -> None:
        await db_core.bulk_update_agent_states(
            simulation_id=simulation_id,
            items=[
                {
                    "agent_id": getattr(persona, "persona_id", None),
                    "opinion": getattr(persona, "opinion", "neutral"),
                    "confidence": float(getattr(persona, "confidence", 0.5)),
                    "phase": phase,
                    "influence_weight": float(getattr(persona, "influence_weight", 1.0)),
                }
                for persona in personas
            ],
        )

    async def persist_dialogue_turn(self, simulation_id: str, turn: DialogueTurn, event_seq: int) -> None:
        row = turn.to_reasoning_row()
        row["event_seq"] = event_seq
        await db_core.insert_reasoning_step(simulation_id, row)

    async def persist_research_event(self, simulation_id: str, event_seq: int, payload: Dict[str, Any]) -> None:
        record = {
            "event_seq": event_seq,
            "cycle_id": payload.get("cycle_id"),
            "url": payload.get("url"),
            "domain": payload.get("domain"),
            "favicon_url": payload.get("favicon_url"),
            "action": payload.get("action") or payload.get("type"),
            "status": payload.get("status") or "ok",
            "title": payload.get("title"),
            "http_status": payload.get("http_status"),
            "content_chars": payload.get("content_chars"),
            "relevance_score": payload.get("relevance_score"),
            "snippet": payload.get("snippet"),
            "error": payload.get("error"),
            "meta_json": payload.get("meta") or {},
        }
        await db_core.insert_research_event(simulation_id, record)

    async def persist_metrics(self, simulation_id: str, metrics: Dict[str, Any]) -> None:
        await db_core.insert_metrics(simulation_id, metrics)

    async def fetch_owner(self, simulation_id: str) -> Optional[int]:
        return await db_core.get_simulation_owner(simulation_id)

    async def fetch_transcript(self, simulation_id: str) -> List[Dict[str, Any]]:
        return await db_core.fetch_transcript(simulation_id)

    async def fetch_agents(
        self,
        *,
        simulation_id: str,
        stance: Optional[str],
        phase: Optional[str],
        page: int,
        page_size: int,
    ) -> Dict[str, Any]:
        return await db_core.fetch_simulation_agents_filtered(
            simulation_id=simulation_id,
            stance=stance,
            phase=phase,
            page=page,
            page_size=page_size,
        )

    async def fetch_research_events(self, simulation_id: str) -> List[Dict[str, Any]]:
        return await db_core.fetch_research_events(simulation_id)

    async def list_runs(
        self,
        *,
        user_id: Optional[int],
        include_all: bool,
        limit: int,
        offset: int,
    ) -> List[Dict[str, Any]]:
        rows = await db_core.fetch_simulations(
            user_id=user_id,
            include_all=include_all,
            limit=limit,
            offset=offset,
        )
        items: List[Dict[str, Any]] = []
        for row in rows:
            context = row.get("user_context") or {}
            if isinstance(context, str):
                try:
                    context = json.loads(context)
                except Exception:
                    context = {}
            metrics = row.get("final_metrics") or {}
            if isinstance(metrics, str):
                try:
                    metrics = json.loads(metrics)
                except Exception:
                    metrics = {}
            items.append(
                {
                    "simulation_id": row.get("simulation_id"),
                    "status": row.get("status") or "running",
                    "idea": context.get("idea") or "",
                    "category": context.get("category") or "",
                    "summary": row.get("summary") or "",
                    "created_at": row.get("created_at"),
                    "ended_at": row.get("ended_at"),
                    "acceptance_rate": metrics.get("acceptance_rate"),
                    "total_agents": metrics.get("total_agents"),
                }
            )
        return items

    async def count_runs(self, *, user_id: Optional[int], include_all: bool) -> int:
        return await db_core.count_simulations(user_id=user_id, include_all=include_all)

    async def fetch_persona_library_record(
        self,
        *,
        user_id: Optional[int],
        place_key: str,
        audience_filters: Optional[List[str]] = None,
        source_mode: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        return await db_core.fetch_persona_library_record(
            user_id=user_id,
            place_key=place_key,
            audience_filters=audience_filters,
            source_mode=source_mode,
        )

    async def upsert_persona_library_record(
        self,
        *,
        user_id: Optional[int],
        place_key: str,
        place_label: str,
        scope: str,
        source_policy: str,
        payload: Dict[str, Any],
        audience_filters: Optional[List[str]] = None,
        source_summary: Optional[str] = None,
        evidence_summary: Optional[Dict[str, Any]] = None,
        generation_config: Optional[Dict[str, Any]] = None,
        quality_score: Optional[float] = None,
        confidence_score: Optional[float] = None,
        quality_meta: Optional[Dict[str, Any]] = None,
        validation_meta: Optional[Dict[str, Any]] = None,
        reusable_dataset_ref: Optional[str] = None,
        context_type: Optional[str] = None,
        shared_asset: bool = True,
    ) -> None:
        await db_core.upsert_persona_library_record(
            user_id=user_id,
            place_key=place_key,
            place_label=place_label,
            scope=scope,
            source_policy=source_policy,
            payload=payload,
            audience_filters=audience_filters,
            source_summary=source_summary,
            evidence_summary=evidence_summary,
            generation_config=generation_config,
            quality_score=quality_score,
            confidence_score=confidence_score,
            quality_meta=quality_meta,
            validation_meta=validation_meta,
            reusable_dataset_ref=reusable_dataset_ref,
            context_type=context_type,
            shared_asset=shared_asset,
        )

    async def list_persona_library_records(
        self,
        *,
        user_id: Optional[int],
        place_query: Optional[str] = None,
        audience: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        min_count: Optional[int] = None,
        max_count: Optional[int] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        return await db_core.list_persona_library_records(
            user_id=user_id,
            place_query=place_query,
            audience=audience,
            date_from=date_from,
            date_to=date_to,
            min_count=min_count,
            max_count=max_count,
            limit=limit,
        )

    async def fetch_persona_library_record_by_set_key(
        self,
        *,
        user_id: Optional[int],
        set_key: str,
    ) -> Optional[Dict[str, Any]]:
        return await db_core.fetch_persona_library_record_by_set_key(
            user_id=user_id,
            set_key=set_key,
        )
