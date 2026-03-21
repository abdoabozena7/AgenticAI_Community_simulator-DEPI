from __future__ import annotations

import asyncio
import uuid
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from .agents.base import AgentRuntime
from .agents.clarification_agent import ClarificationAgent
from .agents.persona_agent import PersonaAgent
from .agents.search_agent import SearchAgent
from .agents.simulation_agent import SimulationAgent
from .core.dataset_loader import Dataset
from .models.orchestration import (
    ChangeImpact,
    OrchestrationState,
    PHASE_ORDER,
    SimulationPhase,
    SimulationStatus,
    classify_idea_context,
    context_location_label,
    normalize_context,
    phase_position,
    resolve_persona_source_mode,
)
from .services.event_bus import EventBus
from .services.llm_gateway import LLMGateway
from .services.simulation_repository import SimulationRepository


class SimulationOrchestrator:
    def __init__(
        self,
        *,
        dataset: Dataset,
        broadcaster: Callable[[Dict[str, Any]], Awaitable[None]],
    ) -> None:
        self.repository = SimulationRepository()
        self.llm = LLMGateway()
        self.event_bus = EventBus(broadcaster=broadcaster, repository=self.repository)
        runtime = AgentRuntime(
            dataset=dataset,
            llm=self.llm,
            event_bus=self.event_bus,
            repository=self.repository,
        )
        self.search_agent = SearchAgent(runtime)
        self.persona_agent = PersonaAgent(runtime)
        self.clarification_agent = ClarificationAgent(runtime)
        self.simulation_agent = SimulationAgent(runtime)
        self._states: Dict[str, OrchestrationState] = {}
        self._tasks: Dict[str, asyncio.Task[None]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}

    def _ensure_runtime_collections(self) -> None:
        if not hasattr(self, "_states") or self._states is None:
            self._states = {}
        if not hasattr(self, "_tasks") or self._tasks is None:
            self._tasks = {}
        if not hasattr(self, "_locks") or self._locks is None:
            self._locks = {}

    async def start_simulation(
        self,
        *,
        user_context: Dict[str, Any],
        user_id: Optional[int],
    ) -> OrchestrationState:
        self._ensure_runtime_collections()
        simulation_id = str(uuid.uuid4())
        state = OrchestrationState(
            simulation_id=simulation_id,
            user_id=user_id,
            user_context=normalize_context(user_context),
        )
        self._states[simulation_id] = state
        await self.repository.create_run(state)
        self._schedule(simulation_id, state.current_phase)
        return state

    async def get_state(self, simulation_id: str) -> Optional[OrchestrationState]:
        self._ensure_runtime_collections()
        state = self._states.get(simulation_id)
        if state is not None:
            return state
        state = await self.repository.load_state(simulation_id)
        if state is not None:
            self._states[simulation_id] = state
        return state

    async def pause_simulation(self, simulation_id: str, reason: Optional[str] = None) -> Optional[OrchestrationState]:
        self._ensure_runtime_collections()
        state = await self.get_state(simulation_id)
        if state is None:
            return None
        task = self._tasks.get(simulation_id)
        if task and not task.done():
            task.cancel()
        state.status = SimulationStatus.PAUSED.value
        state.status_reason = str(reason or "paused_manual")
        await self.repository.save_state(state)
        await self.event_bus.publish(
            state,
            "simulation_paused",
            {"reason": state.status_reason, "agent": "orchestrator"},
        )
        return state

    async def resume_simulation(self, simulation_id: str) -> Optional[OrchestrationState]:
        self._ensure_runtime_collections()
        state = await self.get_state(simulation_id)
        if state is None:
            return None
        state.reconcile_runtime_contracts()
        if state.pending_input and state.pending_input_kind:
            state.status = SimulationStatus.PAUSED.value
            state.status_reason = {
                "clarification": "awaiting_clarification",
                "research_review": "paused_research_review",
                "orchestrator_intervention": "paused_coach_intervention",
                "orchestrator_apply_suggestions": "paused_coach_intervention",
                "execution_followup": "paused_manual",
            }.get(str(state.pending_input_kind), "paused_manual")
            await self.repository.save_state(state)
            return state
        state.status = SimulationStatus.RUNNING.value
        state.status_reason = "running"
        state.pending_input = False
        await self.repository.save_state(state)
        self._schedule(simulation_id, state.current_phase)
        return state

    async def answer_clarifications(
        self,
        simulation_id: str,
        answers: List[Dict[str, Any]],
    ) -> Optional[OrchestrationState]:
        state = await self.get_state(simulation_id)
        if state is None:
            return None
        if state.pending_input_kind == "research_review":
            answer_text = " ".join(
                str(item.get("answer") or item.get("text") or "").strip()
                for item in answers
                if str(item.get("answer") or item.get("text") or "").strip()
            ).strip().lower()
            use_ai = any(token in answer_text for token in ["ai", "estimation", "estimate", "use_ai_estimation", "ذكاء", "تقدير"])
            retry = any(token in answer_text for token in ["retry", "again", "re-search", "إعادة", "اعادة", "retry_search"])
            state.pending_input = False
            state.pending_input_kind = None
            state.pending_resume_phase = None
            state.clarification_questions = []
            state.error = None
            if use_ai and not retry:
                state.user_context["researchEstimationMode"] = "ai_estimation"
                state.schema["research_estimation_mode"] = "ai_estimation"
                state.continue_from_phase(SimulationPhase.INTERNET_RESEARCH, reason="research_ai_estimation")
            else:
                state.user_context["researchEstimationMode"] = ""
                state.schema["research_estimation_mode"] = "retry"
                state.continue_from_phase(SimulationPhase.INTERNET_RESEARCH, reason="research_retry")
            await self.repository.save_state(state)
            self._schedule(simulation_id, state.current_phase, force=True)
            return state
        if state.pending_input_kind == "insight_followup":
            await self.simulation_agent.handle_insight_response(state, answers)
            if not state.pending_input:
                resume_phase = SimulationPhase(str(state.pending_resume_phase or SimulationPhase.AGENT_DELIBERATION.value))
                state.continue_from_phase(resume_phase, reason="insight_followup_resolved")
                await self.repository.save_state(state)
                self._schedule(simulation_id, state.current_phase, force=True)
            else:
                await self.repository.save_state(state)
            return state
        if state.pending_input_kind in {"orchestrator_intervention", "orchestrator_apply_suggestions"}:
            await self.simulation_agent.handle_orchestrator_intervention_response(state, answers)
            if not state.pending_input:
                resume_phase = SimulationPhase(str(state.pending_resume_phase or SimulationPhase.AGENT_DELIBERATION.value))
                state.continue_from_phase(resume_phase, reason=str(state.status_reason or "coach_intervention_resolved"))
                await self.repository.save_state(state)
                self._schedule(simulation_id, state.current_phase, force=True)
            else:
                await self.repository.save_state(state)
            return state
        if state.pending_input_kind == "execution_followup":
            await self.simulation_agent.handle_execution_followup_response(state, answers)
            await self.repository.save_state(state)
            return state
        questions_by_id = {question.question_id: question for question in state.clarification_questions}
        resolved_question_ids: List[str] = []
        for answer in answers:
            question_id = str(answer.get("question_id") or answer.get("questionId") or "").strip()
            text = str(answer.get("answer") or answer.get("text") or "").strip()
            if not question_id or not text:
                continue
            question = questions_by_id.get(question_id)
            if question is None:
                continue
            state.clarification_answers[question_id] = text
            state.user_context[question.field_name] = text
            state.schema[question.field_name] = text
            resolved_question_ids.append(question_id)
        if not state.pending_questions():
            state.pending_input = False
            if state.pending_input_kind == "clarification":
                state.pending_input_kind = None
                state.pending_resume_phase = None
                if getattr(self, "event_bus", None) is not None and getattr(self, "clarification_agent", None) is not None:
                    for question_id in resolved_question_ids:
                        await self.event_bus.publish(
                            state,
                            "clarification_resolved",
                            {
                                "agent": self.clarification_agent.name,
                                "question_id": question_id,
                                "answer_source": "custom",
                            },
                        )
            snapshot = state.pipeline_status_snapshot()
            blockers = list(snapshot.get("blockers") or [])
            if not blockers:
                state.status = SimulationStatus.RUNNING.value
                state.status_reason = "running"
                state.current_phase = SimulationPhase.SIMULATION_INITIALIZATION
                await self.repository.save_state(state)
                self._schedule(simulation_id, state.current_phase)
            else:
                blocked_phase_key = str(snapshot.get("blocked_phase") or "").strip()
                blocked_phase = (
                    SimulationPhase(blocked_phase_key)
                    if blocked_phase_key in {item.value for item in SimulationPhase}
                    else None
                )
                if blocked_phase and phase_position(blocked_phase) >= phase_position(SimulationPhase.INTERNET_RESEARCH):
                    state.continue_from_phase(blocked_phase, reason="clarification_resolved_resume")
                    await self.repository.save_state(state)
                    self._schedule(simulation_id, state.current_phase, force=True)
                else:
                    state.status = SimulationStatus.ERROR.value
                    state.status_reason = "pipeline_blocked"
                    state.error = f"Simulation blocked until pipeline completes: {', '.join(blockers)}"
                    await self.repository.save_state(state)
        else:
            await self.repository.save_state(state)
        return state

    async def apply_context_update(
        self,
        simulation_id: str,
        updates: Dict[str, Any],
    ) -> Optional[Tuple[OrchestrationState, ChangeImpact, SimulationPhase]]:
        self._ensure_runtime_collections()
        state = await self.get_state(simulation_id)
        if state is None:
            return None
        merged = dict(state.user_context)
        merged.update(updates or {})
        normalized = normalize_context(merged)
        impact, rollback_phase = self._classify_change(state.user_context, normalized, state.current_phase)
        changed_fields = sorted(key for key in normalized.keys() if normalized.get(key) != state.user_context.get(key))
        state.user_context = normalized
        state.last_change_impact = impact.value
        can_resume_inside_deliberation = (
            impact == ChangeImpact.SMALL
            and rollback_phase == SimulationPhase.AGENT_DELIBERATION
            and phase_position(state.current_phase) >= phase_position(SimulationPhase.SIMULATION_INITIALIZATION)
        )
        if can_resume_inside_deliberation:
            state.deliberation_state.setdefault("pending_context_updates", [])
            state.deliberation_state["pending_context_updates"].append(
                {
                    "impact": impact.value,
                    "changed_fields": changed_fields,
                    "timestamp": state.updated_at,
                }
            )
            state.continue_from_phase(SimulationPhase.AGENT_DELIBERATION, reason=f"context_update:{impact.value}")
            rollback_phase = SimulationPhase.AGENT_DELIBERATION
        else:
            state.rollback_to(rollback_phase, reason=f"context_update:{impact.value}")
        await self.repository.save_state(state)
        await self.event_bus.publish(
            state,
            "context_updated",
            {
                "agent": "orchestrator",
                "change_impact": impact.value,
                "rollback_phase": rollback_phase.value,
                "changed_fields": changed_fields,
            },
        )
        task = self._tasks.get(simulation_id)
        if task and not task.done():
            task.cancel()
        self._schedule(simulation_id, rollback_phase, force=True)
        return state, impact, rollback_phase

    async def get_result(self, simulation_id: str) -> Optional[Dict[str, Any]]:
        state = await self.get_state(simulation_id)
        if state is None:
            return None
        return {
            "simulation_id": simulation_id,
            "status": state.status,
            "summary": state.summary,
            "metrics": state.metrics,
            "agents": [item.to_public_agent() for item in state.personas],
            "research": state.research.to_dict() if state.research else None,
        }

    def is_running(self, simulation_id: str) -> bool:
        self._ensure_runtime_collections()
        task = self._tasks.get(simulation_id)
        return bool(task and not task.done())

    def _schedule(self, simulation_id: str, start_phase: SimulationPhase, force: bool = False) -> None:
        self._ensure_runtime_collections()
        task = self._tasks.get(simulation_id)
        if task and not task.done() and not force:
            return
        self._tasks[simulation_id] = asyncio.create_task(self._drive(simulation_id, start_phase))

    async def _drive(self, simulation_id: str, start_phase: SimulationPhase) -> None:
        lock = self._locks.setdefault(simulation_id, asyncio.Lock())
        async with lock:
            state = await self.get_state(simulation_id)
            if state is None:
                return
            state.current_phase = start_phase
            state.status = SimulationStatus.RUNNING.value
            if not str(state.status_reason or "").strip() or state.status_reason in {"paused_manual", "awaiting_clarification"}:
                state.status_reason = "running"
            state.error = None
            await self.repository.save_state(state)

            try:
                for phase in PHASE_ORDER:
                    if phase_position(phase) < phase_position(start_phase):
                        continue
                    if phase.value in state.completed_phases and phase != state.current_phase:
                        continue
                    state.mark_phase_started(phase)
                    await self.repository.save_state(state)
                    await self.event_bus.publish(
                        state,
                        "phase_started",
                        {"agent": "orchestrator", "phase_key": phase.value},
                    )
                    should_stop = await self._run_phase(state, phase)
                    if should_stop:
                        await self.repository.save_state(state)
                        return
                    state.mark_phase_completed(phase)
                    await self.repository.save_state(state)
                    await self.event_bus.publish(
                        state,
                        "phase_completed",
                        {"agent": "orchestrator", "phase_key": phase.value},
                    )
                    next_phase = state.next_phase()
                    if next_phase is not None:
                        state.current_phase = next_phase

                state.status = SimulationStatus.COMPLETED.value
                state.status_reason = "completed"
                await self.repository.finalize_run(state)
                await self.event_bus.publish(
                    state,
                    "simulation_completed",
                    {
                        "agent": "orchestrator",
                        "summary": state.summary,
                        "metrics": state.metrics,
                    },
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                state.status = SimulationStatus.ERROR.value
                state.status_reason = "error"
                state.error = str(exc)
                await self.repository.finalize_run(state)
                await self.event_bus.publish(
                    state,
                    "simulation_failed",
                    {"agent": "orchestrator", "error": str(exc)},
                )

    async def _run_phase(self, state: OrchestrationState, phase: SimulationPhase) -> bool:
        state.refresh_persona_source_resolution()
        if phase == SimulationPhase.IDEA_INTAKE:
            return await self._run_idea_intake(state)
        if phase == SimulationPhase.CONTEXT_CLASSIFICATION:
            return await self._run_context_classification(state)
        if phase == SimulationPhase.INTERNET_RESEARCH:
            await self.search_agent.run(state)
            return state.pending_input
        if phase == SimulationPhase.PERSONA_GENERATION:
            await self.persona_agent.run(state)
            await self.event_bus.publish(
                state,
                "personas_generated",
                {"agent": self.persona_agent.name, "count": len(state.personas)},
            )
            return False
        if phase == SimulationPhase.PERSONA_PERSISTENCE:
            await self.persona_agent.persist(state)
            await self.event_bus.publish(
                state,
                "personas_saved",
                {"agent": self.persona_agent.name, "count": len(state.personas)},
            )
            return False
        if phase == SimulationPhase.CLARIFICATION_QUESTIONS:
            await self.clarification_agent.run(state)
            if state.pending_input:
                question = state.active_pending_clarification()
                await self.event_bus.publish(
                    state,
                    "clarification_request",
                    {
                        "agent": self.clarification_agent.name,
                        "question_id": question.question_id if question else None,
                        "question": question.prompt if question else "",
                        "options": [{"id": option or f"opt_{index + 1}", "label": option} for index, option in enumerate(question.options)] if question else [],
                        "reason_tag": question.field_name if question else None,
                        "reason_summary": question.reason if question else None,
                        "created_at": state.updated_at,
                        "required": True,
                    },
                )
                return True
            await self.event_bus.publish(
                state,
                "clarification_completed",
                {"agent": self.clarification_agent.name},
            )
            return False
        if phase == SimulationPhase.SIMULATION_INITIALIZATION:
            blockers = state.validate_pipeline_ready_for_simulation()
            if blockers:
                state.status = SimulationStatus.ERROR.value
                state.status_reason = "pipeline_blocked"
                state.error = f"Simulation blocked until pipeline completes: {', '.join(blockers)}"
                await self.event_bus.publish(
                    state,
                    "pipeline_blocked",
                    {
                        "agent": "orchestrator",
                        "blockers": blockers,
                        "pipeline": state.schema.get("pipeline_status") or {},
                    },
                )
                return True
            await self.simulation_agent.initialize_simulation(state)
            await self.event_bus.publish(
                state,
                "simulation_initialized",
                {
                    "agent": self.simulation_agent.name,
                    "participant_count": len(state.personas),
                    "location": context_location_label(state.user_context),
                },
            )
            return False
        if phase == SimulationPhase.AGENT_DELIBERATION:
            await self.simulation_agent.run_deliberation(state)
            return state.pending_input
        if phase == SimulationPhase.CONVERGENCE:
            await self.simulation_agent.run_convergence(state)
            return state.pending_input
        if phase == SimulationPhase.SUMMARY:
            state.summary = await self.simulation_agent.build_summary(state)
            state.summary_ready = True
            return False
        return False

    async def _run_idea_intake(self, state: OrchestrationState) -> bool:
        required = ["idea", "category"]
        missing = [field for field in required if not state.user_context.get(field)]
        state.search_completed = False
        state.persona_generation_completed = False
        state.persona_persistence_completed = False
        state.simulation_ready = False
        state.schema.update(
            {
                "idea": state.user_context.get("idea"),
                "category": state.user_context.get("category"),
                "location": context_location_label(state.user_context),
                "targetAudience": list(state.user_context.get("targetAudience") or []),
                "goals": list(state.user_context.get("goals") or []),
                "valueProposition": state.user_context.get("valueProposition"),
                "deliveryModel": state.user_context.get("deliveryModel"),
                "monetization": state.user_context.get("monetization"),
                "riskBoundary": state.user_context.get("riskBoundary"),
                "persona_source_requested": state.user_context.get("personaSourceMode"),
                "minimum_persona_threshold": state.user_context.get("minimumPersonaThreshold"),
            }
        )
        if not missing:
            return False
        state.pending_input = True
        state.pending_input_kind = "idea_intake"
        state.pending_resume_phase = SimulationPhase.IDEA_INTAKE.value
        state.status = SimulationStatus.PAUSED.value
        state.status_reason = "awaiting_context"
        state.error = f"Missing required context: {', '.join(missing)}"
        await self.event_bus.publish(
            state,
            "idea_intake_blocked",
            {
                "agent": "orchestrator",
                "missing_fields": missing,
            },
        )
        return True

    async def _run_context_classification(self, state: OrchestrationState) -> bool:
        state.set_pipeline_step(
            "analyzing_idea_type",
            "running",
            detail="Determining whether the idea is location-based, general, or hybrid.",
        )
        context_type = classify_idea_context(state.user_context)
        state.idea_context_type = context_type.value
        persona_source_mode, auto_selected = state.resolve_persona_source_contract()
        location_label = context_location_label(state.user_context)
        notice: Optional[str] = None
        if persona_source_mode == resolve_persona_source_mode(state.user_context, context_type=context_type)[0] and not location_label:
            notice = (
                "This idea looks general, so the system will use default audience personas unless you choose to generate custom personas."
            )
        state.persona_source_mode = persona_source_mode
        state.persona_source_auto_selected = auto_selected
        state.persona_source_notice = notice
        state.user_context["personaSourceMode"] = persona_source_mode
        state.schema.update(
            {
                "idea_context_type": context_type.value,
                "persona_source": persona_source_mode,
                "location": location_label,
            }
        )
        state.set_pipeline_step(
            "analyzing_idea_type",
            "completed",
            detail=f"Classified as {context_type.value}. Persona source: {persona_source_mode}.",
        )
        await self.event_bus.publish(
            state,
            "context_classified",
            {
                "agent": "orchestrator",
                "context_type": context_type.value,
                "persona_source_mode": persona_source_mode,
                "auto_selected": auto_selected,
                "location": location_label,
            },
        )
        return False

    def _classify_change(
        self,
        previous: Dict[str, Any],
        updated: Dict[str, Any],
        current_phase: SimulationPhase,
    ) -> Tuple[ChangeImpact, SimulationPhase]:
        major_fields = {"idea", "category", "country", "city", "location", "place_name"}
        medium_fields = {"targetAudience", "valueProposition", "monetization", "deliveryModel", "riskBoundary"}
        persona_fields = {"personaSourceMode", "personaSetKey", "personaSetLabel"}
        changed = {key for key in updated.keys() if updated.get(key) != previous.get(key)}
        if changed & major_fields:
            return ChangeImpact.MAJOR, SimulationPhase.CONTEXT_CLASSIFICATION
        if changed & persona_fields:
            return ChangeImpact.MAJOR, SimulationPhase.PERSONA_GENERATION
        if changed & medium_fields:
            return ChangeImpact.MAJOR, SimulationPhase.INTERNET_RESEARCH
        if phase_position(current_phase) >= phase_position(SimulationPhase.AGENT_DELIBERATION):
            return ChangeImpact.SMALL, SimulationPhase.AGENT_DELIBERATION
        return ChangeImpact.SMALL, current_phase
