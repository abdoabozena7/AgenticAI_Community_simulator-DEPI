"""
Pydantic data models for the social simulation backend.

This module defines the core data structures used throughout the
application. These models map directly onto the JSON dataset files and
represent the runtime state of individual agents and reasoning steps.

The CategoryModel, PersonaTemplateModel and InteractionRuleModel are
loaded from the dataset JSON files on application startup. They are
designed to closely follow the provided dataset schema specification.

The AgentInstanceModel and ReasoningStep are used only at runtime to
represent the state of an instantiated agent and the reasoning
observations produced during the simulation. AgentInstanceModel is
excluded from dataset loading because it contains runtime-only fields
(e.g. current opinion, confidence and history). These models still
inherit from BaseModel to leverage Pydantic's validation and type hints,
but they are not persisted to disk.

Note: Pydantic v2 is used throughout this project. See the official
documentation (https://docs.pydantic.dev/) for more details on the
behaviour of BaseModel and Field.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, ConfigDict


class CategoryModel(BaseModel):
    """Represents a persona category.

    Attributes:
        category_id: Unique identifier for the category.
        description: Human readable description of the category.
        base_influence_weight: Baseline weight used when computing
            social influence from this category onto another.
        typical_contexts: List of example contexts in which this
            category typically operates. Stored as a list of strings.
    """

    category_id: str = Field(..., description="Unique identifier for the category")
    description: str = Field(..., description="Human readable description")
    base_influence_weight: float = Field(..., description="Baseline influence weight")
    typical_contexts: List[str] = Field(
        default_factory=list,
        description="List of example contexts for this category",
    )

    model_config = ConfigDict(extra="forbid")


class PersonaTemplateModel(BaseModel):
    """Represents a persona template defining archetypal traits.

    Each persona template belongs to a single category (category_id).
    The traits dictionary defines five core personality traits which
    influence how an agent behaves during the simulation. Additional
    fields capture the agent's decision style, biases, reaction
    variability and influence susceptibility.
    """

    template_id: str = Field(..., description="Unique identifier for the template")
    category_id: str = Field(..., description="Identifier of the associated category")
    archetype_name: str = Field(..., description="Name of the archetype")
    traits: Dict[str, float] = Field(
        ...,
        description=(
            "Dictionary of personality traits: optimism, risk_tolerance, "
            "openness_to_change, skepticism, emotional_reactivity"
        ),
    )
    decision_style: str = Field(..., description="Decision-making style of the persona")
    biases: List[str] = Field(default_factory=list, description="List of cognitive biases")
    reaction_variability: float = Field(
        ..., description="Degree of variability in reactions (0–1 range)"
    )
    influence_susceptibility: float = Field(
        ..., description="Susceptibility to social influence (0–1 range)"
    )

    model_config = ConfigDict(extra="forbid")

    @field_validator("traits")
    def validate_traits(cls, v: Dict[str, float]) -> Dict[str, float]:
        """Ensure that all required trait keys are present and values are within [0,1]."""
        required_keys = {
            "optimism",
            "risk_tolerance",
            "openness_to_change",
            "skepticism",
            "emotional_reactivity",
        }
        if set(v.keys()) != required_keys:
            missing = required_keys - set(v.keys())
            extra = set(v.keys()) - required_keys
            msg_parts = []
            if missing:
                msg_parts.append(f"missing {missing}")
            if extra:
                msg_parts.append(f"unexpected keys {extra}")
            raise ValueError(
                f"Traits must contain exactly these keys: {', '.join(sorted(required_keys))}; "
                f"{'; '.join(msg_parts)}"
            )
        for key, value in v.items():
            if not 0.0 <= value <= 1.0:
                raise ValueError(f"Trait '{key}' must be between 0 and 1, got {value}")
        return v


class InteractionRuleModel(BaseModel):
    """Defines how agents from one category influence agents from another category.

    Attributes:
        from_category: The category identifier of the influencing agent.
        to_category: The category identifier of the influenced agent.
        influence_multiplier: Multiplier applied to the base influence weight.
        notes: Free-text notes about this rule.
    """

    from_category: str = Field(..., description="Category of influencing agent")
    to_category: str = Field(..., description="Category of influenced agent")
    influence_multiplier: float = Field(
        ..., description="Multiplier applied to base influence weight"
    )
    notes: str = Field(default="", description="Optional descriptive notes")

    model_config = ConfigDict(extra="forbid")


class ReasoningStep(BaseModel):
    """Represents a single reasoning step emitted during the simulation.

    Attributes:
        iteration: Simulation iteration number at which the step occurred.
        message: Human readable message describing the reasoning.
        triggered_by: Identifier of the agent or 'environment' that triggered this step.
        opinion_change: Optional tuple describing the change in opinion (previous, new) if any.
    """

    iteration: int = Field(..., description="Iteration number")
    message: str = Field(..., description="Explanation of the reasoning")
    triggered_by: str = Field(..., description="Agent ID or 'environment'")
    opinion_change: Optional[Dict[str, str]] = Field(
        default=None,
        description="Optional details of opinion change represented as {'from': <prev>, 'to': <new>}"
    )

    model_config = ConfigDict(extra="forbid")


class AgentInstanceModel(BaseModel):
    """Runtime representation of an agent during the simulation.

    This model is used internally by the simulation engine to keep track
    of each agent's state. It extends BaseModel for consistency but
    includes fields that are populated at runtime rather than loaded
    from the dataset. Traits are inherited from the associated persona
    template on instantiation.

    Attributes:
        agent_id: Unique identifier for the agent instance.
        category_id: Category identifier of the agent (copied from template).
        template_id: Template identifier used to instantiate this agent.
        current_opinion: Current stance of the agent: 'accept', 'neutral' or 'reject'.
        confidence: Confidence level in the current opinion (0–1 range).
        traits: Mapping of trait names to values inherited from the persona template.
        influence_weight: Calculated influence weight derived from the agent's category
            and template characteristics.
        history: List of reasoning steps encountered by this agent.
    """

    agent_id: str = Field(..., description="Runtime unique identifier")
    category_id: str = Field(..., description="Category identifier")
    template_id: str = Field(..., description="Persona template identifier")
    current_opinion: str = Field(..., description="Current opinion: accept, neutral or reject")
    confidence: float = Field(..., description="Confidence level in current opinion")
    traits: Dict[str, float] = Field(..., description="Inherited trait values")
    influence_weight: float = Field(..., description="Computed influence weight")
    history: List[ReasoningStep] = Field(default_factory=list, description="History of reasoning steps")

    model_config = ConfigDict(extra="forbid")