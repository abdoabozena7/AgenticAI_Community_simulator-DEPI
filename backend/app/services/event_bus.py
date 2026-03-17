from __future__ import annotations

from typing import Any, Awaitable, Callable, Dict, Optional

from ..models.orchestration import DialogueTurn, OrchestrationState
from .simulation_repository import SimulationRepository


BroadcastFn = Callable[[Dict[str, Any]], Awaitable[None]]


class EventBus:
    def __init__(
        self,
        *,
        broadcaster: BroadcastFn,
        repository: SimulationRepository,
    ) -> None:
        self._broadcaster = broadcaster
        self._repository = repository

    async def publish(
        self,
        state: OrchestrationState,
        event_type: str,
        payload: Dict[str, Any],
        *,
        persist_research: bool = False,
    ) -> Dict[str, Any]:
        event = state.append_event(event_type, payload)
        message = event.to_dict(state.simulation_id)
        if persist_research:
            await self._repository.persist_research_event(state.simulation_id, event.seq, payload)
        await self._broadcaster(message)
        return message

    async def publish_turn(self, state: OrchestrationState, turn: DialogueTurn) -> Dict[str, Any]:
        event = state.append_event(
            "agent_opinion_changed",
            {
                "step_uid": turn.step_uid,
                "iteration": turn.iteration,
                "agent_id": turn.agent_id,
                "agent_name": turn.agent_name,
                "reply_to_agent_id": turn.reply_to_agent_id,
                "reply_to_agent_name": turn.reply_to_agent_name,
                "message": turn.message,
                "stance_before": turn.stance_before,
                "stance_after": turn.stance_after,
                "confidence": turn.confidence,
                "influence_delta": turn.influence_delta,
                "evidence_urls": list(turn.evidence_urls),
                "reason_tag": turn.reason_tag,
                "message_type": turn.message_type,
                "argument_id": turn.argument_id,
                "insight_tag": turn.insight_tag,
                "question_asked": turn.question_asked,
            },
        )
        await self._repository.persist_dialogue_turn(state.simulation_id, turn, event.seq)
        message = event.to_dict(state.simulation_id)
        await self._broadcaster(message)
        return message
