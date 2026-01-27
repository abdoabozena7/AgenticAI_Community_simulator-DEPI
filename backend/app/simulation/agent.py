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

import uuid
from typing import List, Dict, Optional

from ..models.schemas import PersonaTemplateModel, ReasoningStep, AgentInstanceModel, CategoryModel


class Agent:
    """Internal representation of an agent during a simulation run."""

    def __init__(
        self,
        template: PersonaTemplateModel,
        category: CategoryModel,
        initial_opinion: str = "neutral",
    ) -> None:
        # Assign a unique identifier for the runtime instance
        self.agent_id: str = str(uuid.uuid4())
        self.category_id: str = template.category_id
        self.template_id: str = template.template_id
        self.archetype_name: str = template.archetype_name
        self.biases: List[str] = list(template.biases)
        # Copy trait values from the persona template
        self.traits: Dict[str, float] = dict(template.traits)
        # Compute baseline influence weight combining category base weight and susceptibility
        self.influence_weight: float = category.base_influence_weight * template.influence_susceptibility
        # Set initial opinion and moderate starting confidence
        self.current_opinion: str = initial_opinion
        self.confidence: float = 0.5
        self.neutral_streak: int = 0
        # History of reasoning steps captured during the simulation
        self.history: List[ReasoningStep] = []
        # Short memory for last few reasoning messages
        self.short_memory: List[str] = []

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
        opinion_change: Optional[Dict[str, str]] = None,
    ) -> None:
        """Append a new reasoning step to the agent's history."""
        step = ReasoningStep(
            iteration=iteration,
            message=message,
            triggered_by=triggered_by,
            opinion_change=opinion_change,
        )
        self.history.append(step)
        if message:
            self.short_memory.append(message)
            if len(self.short_memory) > 3:
                self.short_memory = self.short_memory[-3:]
