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

    async def start_simulation(
        self,
        *,
        user_context: Dict[str, Any],
        user_id: Optional[int],
    ) -> OrchestrationState:
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
        state = self._states.get(simulation_id)
        if state is not None:
            return state
        state = await self.repository.load_state(simulation_id)
        if state is not None:
            self._states[simulation_id] = state
        return state

    async def pause_simulation(self, simulation_id: str, reason: Optional[str] = None) -> Optional[OrchestrationState]:
        state = await self.get_state(simulation_id)
        if state is None:
            return None
        task = self._tasks.get(simulation_id)
        if task and not task.done():
            task.cancel()
        state.status = SimulationStatus.PAUSED.value
        state.status_reason = str(reason or "paused_manual")
        state.pending_input = False
        await self.repository.save_state(state)
        await self.event_bus.publish(
            state,
            "simulation_paused",
            {"reason": state.status_reason, "agent": "orchestrator"},
        )
        return state

    async def resume_simulation(self, simulation_id: str) -> Optional[OrchestrationState]:
        state = await self.get_state(simulation_id)
        if state is None:
            return None
        if state.pending_questions():
            state.status = SimulationStatus.PAUSED.value
            state.status_reason = "awaiting_clarification"
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
        questions_by_id = {question.question_id: question for question in state.clarification_questions}
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
        if not state.pending_questions():
            state.pending_input = False
            blockers = state.validate_pipeline_ready_for_simulation()
            if blockers:
                state.status = SimulationStatus.ERROR.value
                state.status_reason = "error"
                state.error = f"Simulation blocked until pipeline completes: {', '.join(blockers)}"
                await self.repository.save_state(state)
            else:
                state.status = SimulationStatus.RUNNING.value
                state.status_reason = "running"
                state.current_phase = SimulationPhase.SIMULATION_INITIALIZATION
                await self.repository.save_state(state)
                self._schedule(simulation_id, state.current_phase)
        else:
            await self.repository.save_state(state)
        return state

    async def apply_context_update(
        self,
        simulation_id: str,
        updates: Dict[str, Any],
    ) -> Optional[Tuple[OrchestrationState, ChangeImpact, SimulationPhase]]:
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
        if phase_position(state.current_phase) >= phase_position(SimulationPhase.SIMULATION_INITIALIZATION):
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
        task = self._tasks.get(simulation_id)
        return bool(task and not task.done())

    def _schedule(self, simulation_id: str, start_phase: SimulationPhase, force: bool = False) -> None:
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
        if phase == SimulationPhase.IDEA_INTAKE:
            return await self._run_idea_intake(state)
        if phase == SimulationPhase.CONTEXT_CLASSIFICATION:
            return await self._run_context_classification(state)
        if phase == SimulationPhase.INTERNET_RESEARCH:
            await self.search_agent.run(state)
            return False
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
                await self.event_bus.publish(
                    state,
                    "clarification_requested",
                    {
                        "agent": self.clarification_agent.name,
                        "questions": [item.to_dict() for item in state.pending_questions()],
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
                raise RuntimeError(f"Simulation blocked until pipeline completes: {', '.join(blockers)}")
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
        persona_source_mode, auto_selected = resolve_persona_source_mode(
            state.user_context,
            context_type=context_type,
        )
        location_label = context_location_label(state.user_context)
        notice: Optional[str] = None
        if not location_label:
            notice = (
                "This idea looks general, so the system will use default audience personas unless you choose to generate custom personas."
            )
        state.idea_context_type = context_type.value
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
        major_fields = {"idea", "category", "country", "city", "location"}
        medium_fields = {"targetAudience", "valueProposition", "monetization", "deliveryModel", "riskBoundary"}
        changed = {key for key in updated.keys() if updated.get(key) != previous.get(key)}
        if changed & major_fields:
            return ChangeImpact.MAJOR, SimulationPhase.CONTEXT_CLASSIFICATION
        if changed & medium_fields:
            return ChangeImpact.MAJOR, SimulationPhase.INTERNET_RESEARCH
        if phase_position(current_phase) >= phase_position(SimulationPhase.AGENT_DELIBERATION):
            return ChangeImpact.SMALL, SimulationPhase.AGENT_DELIBERATION
        return ChangeImpact.SMALL, current_phase
