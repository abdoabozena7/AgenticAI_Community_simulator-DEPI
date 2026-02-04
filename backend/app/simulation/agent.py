"""
Agent representation for the social simulation.

This module defines a lightweight class used by the simulation engine to
represent an individual agent. Agents are instantiated from persona
templates and carry over traits and influence weights from the dataset.
They maintain their own opinion, confidence and history of reasoning
steps. The class is intentionally minimal: complex behaviour is
implemented in the simulation engine and influence modules to allow
clear separation of responsibilities.
"""

from __future__ import annotations

import os
import uuid
from typing import List, Dict, Optional, ClassVar

from ..models.schemas import PersonaTemplateModel, ReasoningStep, AgentInstanceModel, CategoryModel


class Agent:
    """Internal representation of an agent during a simulation run."""

    VALID_OPINIONS: ClassVar[set[str]] = {"accept", "reject", "neutral"}
    SHORT_MEMORY_SIZE: ClassVar[int] = 6
    MAX_HISTORY: ClassVar[int] = 200

    def __init__(
        self,
        template: PersonaTemplateModel,
        category: CategoryModel,
        initial_opinion: str = "neutral",
    ) -> None:
        if template is None:
            raise ValueError("template is required")
        if category is None:
            raise ValueError("category is required")
        if initial_opinion not in self.VALID_OPINIONS:
            initial_opinion = "neutral"
        # Assign a unique identifier for the runtime instance
        self.agent_id: str = str(uuid.uuid4())
        self.category_id: str = template.category_id
        self.template_id: str = template.template_id
        self.archetype_name: str = template.archetype_name
        self.biases: List[str] = list(template.biases)
        # Copy trait values from the persona template
        self.traits: Dict[str, float] = dict(template.traits)
        # Compute baseline influence weight combining category base weight and susceptibility
        self.base_influence_weight: float = category.base_influence_weight
        self.influence_weight: float = category.base_influence_weight * template.influence_susceptibility
        # Stubbornness makes opinion changes harder (0-1 range)
        self.stubbornness: float = min(1.0, max(0.0, self._safe_float(template.traits.get("stubbornness", 0.4), 0.4)))
        # Leader/propagandist flags (set by engine)
        self.is_leader: bool = False
        self.fixed_opinion: Optional[str] = None
        # Set initial opinion and moderate starting confidence
        self.current_opinion: str = initial_opinion
        self.initial_opinion: str = initial_opinion
        self.confidence: float = self._compute_initial_confidence()
        self.neutral_streak: int = 0
        # History of reasoning steps captured during the simulation
        self.history: List[ReasoningStep] = []
        # Short memory for last few reasoning messages
        self.short_memory: List[str] = []

    @staticmethod
    def _safe_float(value: object, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _compute_initial_confidence(self) -> float:
        optimism = self._safe_float(self.traits.get("optimism", 0.5), 0.5)
        skepticism = self._safe_float(self.traits.get("skepticism", 0.5), 0.5)
        base = 0.3 + (0.4 * optimism) - (0.2 * skepticism)
        return min(1.0, max(0.1, base))

    def to_model(self) -> AgentInstanceModel:
        """Convert this agent into a Pydantic model for API responses or logging."""
        return AgentInstanceModel(
            agent_id=self.agent_id,
            category_id=self.category_id,
            template_id=self.template_id,
            current_opinion=self.current_opinion,
            confidence=self.confidence,
            traits=self.traits,
            influence_weight=self.influence_weight,
            history=self.history,
        )

    def record_reasoning_step(
        self,
        iteration: int,
        message: str,
        triggered_by: str,
        phase: Optional[str] = None,
        reply_to_agent_id: Optional[str] = None,
        opinion_change: Optional[Dict[str, str]] = None,
    ) -> None:
        """Append a new reasoning step to the agent's history."""
        step = ReasoningStep(
            iteration=iteration,
            message=message,
            triggered_by=triggered_by,
            phase=phase,
            reply_to_agent_id=reply_to_agent_id,
            opinion_change=opinion_change,
        )
        self.history.append(step)
        try:
            max_history = int(os.getenv("SIM_MAX_AGENT_HISTORY", str(self.MAX_HISTORY)) or self.MAX_HISTORY)
        except ValueError:
            max_history = self.MAX_HISTORY
        if max_history > 0 and len(self.history) > max_history:
            self.history = self.history[-max_history:]
        if message:
            self.short_memory.append(message)
            if len(self.short_memory) > self.SHORT_MEMORY_SIZE:
                self.short_memory = self.short_memory[-self.SHORT_MEMORY_SIZE :]

    @property
    def has_changed_opinion(self) -> bool:
        return self.current_opinion != self.initial_opinion

    @property
    def is_neutral(self) -> bool:
        return self.current_opinion == "neutral"

    def trim_history(self, max_steps: int = 200) -> None:
        if max_steps < 1:
            self.history = []
        elif len(self.history) > max_steps:
            self.history = self.history[-max_steps:]
