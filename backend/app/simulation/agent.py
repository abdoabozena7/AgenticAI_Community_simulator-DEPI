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
        self.agent_id: str = str(uuid.uuid4())
        self.category_id: str = template.category_id
        self.template_id: str = template.template_id
        self.traits: Dict[str, float] = dict(template.traits)
        # baseline influence weight derived from category and template
        self.influence_weight: float = category.base_influence_weight * template.influence_susceptibility
        self.current_opinion: str = initial_opinion
        # Start with a moderate confidence (could be tuned). We'll use 0.5.
        self.confidence: float = 0.5
        self.history: List[ReasoningStep] = []

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
        self, iteration: int, message: str, triggered_by: str, opinion_change: Optional[Dict[str, str]] = None
    ) -> None:
        """Append a new reasoning step to the agent's history."""
        step = ReasoningStep(
            iteration=iteration,
            message=message,
            triggered_by=triggered_by,
            opinion_change=opinion_change,
        )
        self.history.append(step)
