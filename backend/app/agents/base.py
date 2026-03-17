from __future__ import annotations

from dataclasses import dataclass

from ..core.dataset_loader import Dataset
from ..models.orchestration import OrchestrationState
from ..services.event_bus import EventBus
from ..services.llm_gateway import LLMGateway
from ..services.simulation_repository import SimulationRepository


@dataclass
class AgentRuntime:
    dataset: Dataset
    llm: LLMGateway
    event_bus: EventBus
    repository: SimulationRepository


class BaseAgent:
    name = "base_agent"

    def __init__(self, runtime: AgentRuntime) -> None:
        self.runtime = runtime

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        raise NotImplementedError
