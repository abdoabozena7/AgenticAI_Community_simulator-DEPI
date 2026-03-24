from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


def now_ms() -> int:
    return int(time.time() * 1000)


class SimulationPhase(str, Enum):
    IDEA_INTAKE = "idea_intake"
    CONTEXT_CLASSIFICATION = "context_classification"
    INTERNET_RESEARCH = "internet_research"
    PERSONA_GENERATION = "persona_generation"
    PERSONA_PERSISTENCE = "persona_persistence"
    CLARIFICATION_QUESTIONS = "clarification_questions"
    SIMULATION_INITIALIZATION = "simulation_initialization"
    AGENT_DELIBERATION = "agent_deliberation"
    CONVERGENCE = "convergence"
    SUMMARY = "summary"


PHASE_ORDER: List[SimulationPhase] = [
    SimulationPhase.IDEA_INTAKE,
    SimulationPhase.CONTEXT_CLASSIFICATION,
    SimulationPhase.INTERNET_RESEARCH,
    SimulationPhase.PERSONA_GENERATION,
    SimulationPhase.PERSONA_PERSISTENCE,
    SimulationPhase.CLARIFICATION_QUESTIONS,
    SimulationPhase.SIMULATION_INITIALIZATION,
    SimulationPhase.AGENT_DELIBERATION,
    SimulationPhase.CONVERGENCE,
    SimulationPhase.SUMMARY,
]


class SimulationStatus(str, Enum):
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"


class ChangeImpact(str, Enum):
    SMALL = "small"
    MAJOR = "major"


class IdeaContextType(str, Enum):
    LOCATION_BASED = "location_based"
    GENERAL_NON_LOCATION = "general_non_location"
    HYBRID = "hybrid"


class PersonaSourceMode(str, Enum):
    DEFAULT_AUDIENCE_ONLY = "default_audience_only"
    SAVED_PLACE_PERSONAS = "saved_place_personas"
    GENERATE_NEW_FROM_SEARCH = "generate_new_from_search"
    GENERATE_NEW_FROM_PLACE = "generate_new_from_place"


PIPELINE_STEP_ORDER: List[str] = [
    "analyzing_idea_type",
    "building_search_queries",
    "searching_sources",
    "reading_pages",
    "extracting_people_patterns",
    "generating_personas",
    "saving_personas",
    "ready_for_simulation",
]


PIPELINE_STEP_LABELS: Dict[str, Dict[str, str]] = {
    "analyzing_idea_type": {"en": "analyzing idea type", "ar": "تحليل نوع الفكرة"},
    "building_search_queries": {"en": "building search queries", "ar": "بناء استعلامات البحث"},
    "searching_sources": {"en": "searching sources", "ar": "البحث في المصادر"},
    "reading_pages": {"en": "reading pages", "ar": "قراءة الصفحات"},
    "extracting_people_patterns": {"en": "extracting people patterns", "ar": "استخراج أنماط الناس"},
    "generating_personas": {"en": "generating personas", "ar": "توليد الشخصيات"},
    "saving_personas": {"en": "saving personas", "ar": "حفظ الشخصيات"},
    "ready_for_simulation": {"en": "ready for simulation", "ar": "جاهز للمحاكاة"},
}

RESEARCH_RUNTIME_SCHEMA_KEYS = (
    "research_output_ready",
    "research_warnings",
    "research_blockers",
    "fatal_search_failure",
    "research_usable",
    "research_insufficiency_reason",
)

PIPELINE_RUNTIME_SCHEMA_KEYS = (
    "pipeline_status",
)


PIPELINE_BLOCKER_META: Dict[str, Dict[str, str]] = {
    "search_did_not_run": {
        "phase": SimulationPhase.INTERNET_RESEARCH.value,
        "title": "Search did not run",
        "message": "Internet research must complete before personas can be generated.",
        "action": "Run the mandatory search step first.",
    },
    "research_insufficient_for_personas": {
        "phase": SimulationPhase.INTERNET_RESEARCH.value,
        "title": "Research is still too weak",
        "message": "The search finished, but the research output is still too weak for safe downstream persona generation.",
        "action": "Retry search or switch to AI estimation so structured research becomes usable.",
    },
    "fatal_search_failure": {
        "phase": SimulationPhase.INTERNET_RESEARCH.value,
        "title": "Research failed completely",
        "message": "The system could not build any usable research state from search or estimation.",
        "action": "Retry the search with a clearer idea or a stronger location signal.",
    },
    "persona_generation_not_finished": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona generation not finished",
        "message": "The system still needs to finish building personas before the simulation can start.",
        "action": "Wait for persona generation or rerun it if the upstream context changed.",
    },
    "persona_persistence_not_finished": {
        "phase": SimulationPhase.PERSONA_PERSISTENCE.value,
        "title": "Persona persistence not finished",
        "message": "Generated personas were not persisted yet, so the reusable dataset contract is incomplete.",
        "action": "Persist the persona set before starting the simulation.",
    },
    "persona_source_unresolved": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona source is unresolved",
        "message": "The pipeline still does not know which persona source should govern the run.",
        "action": "Resolve the persona source automatically from the generated personas or pick one explicit source.",
    },
    "persona_validation_failed": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona validation failed",
        "message": "The generated persona set has fatal validation issues and cannot be used yet.",
        "action": "Fix the fatal persona validation errors before continuing.",
    },
    "persona_count_zero": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "No personas were generated",
        "message": "Persona generation produced zero usable personas.",
        "action": "Rerun persona generation from a usable research state.",
    },
    "persona_count_below_simulation_minimum": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona count is below the simulation minimum",
        "message": "The persona set was saved, but the count is still below the minimum threshold for simulation.",
        "action": "Generate more personas or lower the configured threshold if policy allows it.",
    },
    "diversity_score_below_threshold": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona diversity is too low",
        "message": "The persona set does not have enough diversity to support a healthy simulation discussion yet.",
        "action": "Regenerate personas with broader signals or a wider audience mix.",
    },
    "schema_incomplete": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona schema is incomplete",
        "message": "Some generated personas are missing required fields.",
        "action": "Regenerate personas until the schema is complete.",
    },
    "source_attribution_missing": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona attribution is missing",
        "message": "At least one persona is missing source attribution.",
        "action": "Regenerate personas with traceable evidence links.",
    },
    "persona_signal_trace_invalid": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona evidence trace is invalid",
        "message": "At least one persona cannot be traced back to approved signals.",
        "action": "Regenerate personas from the structured research signals.",
    },
    "dynamic_persona_schema_incomplete": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Dynamic persona schema is incomplete",
        "message": "At least one generated persona is missing dynamic segment or decision fields.",
        "action": "Regenerate personas with complete dynamic segment metadata.",
    },
    "duplicate_display_name": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Duplicate personas were detected",
        "message": "The persona set still contains duplicate display names.",
        "action": "Regenerate personas and remove duplicates before simulation.",
    },
    "duplicate_persona_id": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Duplicate persona IDs were detected",
        "message": "The persona set still contains duplicate IDs.",
        "action": "Regenerate personas and ensure unique IDs before simulation.",
    },
    "segment_collapse_detected": {
        "phase": SimulationPhase.PERSONA_GENERATION.value,
        "title": "Persona segments collapsed",
        "message": "The generated personas do not cover enough distinct dynamic segments for a healthy simulation.",
        "action": "Regenerate personas with broader segment coverage.",
    },
    "clarification_pending": {
        "phase": SimulationPhase.CLARIFICATION_QUESTIONS.value,
        "title": "Clarification is still required",
        "message": "A required clarification is still waiting for an answer before the simulation can continue.",
        "action": "Answer the active clarification question to continue the pipeline.",
    },
}


PERSONA_SOURCE_OPTIONS: List[Dict[str, str]] = [
    {"mode": PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value, "label": "Default audience personas only"},
    {"mode": PersonaSourceMode.SAVED_PLACE_PERSONAS.value, "label": "Saved place personas"},
    {"mode": PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value, "label": "Generate new personas from search"},
    {"mode": PersonaSourceMode.GENERATE_NEW_FROM_PLACE.value, "label": "Generate new personas from this place"},
]


def phase_position(phase: SimulationPhase | str) -> int:
    key = phase if isinstance(phase, SimulationPhase) else SimulationPhase(str(phase))
    return PHASE_ORDER.index(key)


def _normalize_persona_source_mode(value: Any) -> Optional[str]:
    raw = str(value or "").strip().lower()
    if not raw:
        return None
    aliases = {
        "default": PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value,
        "default_audience": PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value,
        "default_audience_only": PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value,
        "saved_place": PersonaSourceMode.SAVED_PLACE_PERSONAS.value,
        "saved_place_personas": PersonaSourceMode.SAVED_PLACE_PERSONAS.value,
        "saved": PersonaSourceMode.SAVED_PLACE_PERSONAS.value,
        "generate_new": PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value,
        "generate_new_from_search": PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value,
        "generate_from_search": PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value,
        "generate_new_from_place": PersonaSourceMode.GENERATE_NEW_FROM_PLACE.value,
        "generate_from_place": PersonaSourceMode.GENERATE_NEW_FROM_PLACE.value,
        "place": PersonaSourceMode.GENERATE_NEW_FROM_PLACE.value,
    }
    normalized = aliases.get(raw, raw)
    valid = {item.value for item in PersonaSourceMode}
    return normalized if normalized in valid else None


def normalize_context(context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    payload = dict(context or {})
    preflight_answers = payload.get("preflight_answers")
    if isinstance(preflight_answers, dict):
        alias_map = {
            "value_promise": "valueProposition",
            "value_proposition": "valueProposition",
            "target_audience": "targetAudience",
            "audience": "targetAudience",
            "monetization": "monetization",
            "pricing": "monetization",
            "delivery_model": "deliveryModel",
            "delivery": "deliveryModel",
            "risk_boundary": "riskBoundary",
            "risk_limit": "riskBoundary",
            "persona_source_mode": "personaSourceMode",
            "context_scope": "contextScope",
        }
        for source_key, target_key in alias_map.items():
            if payload.get(target_key) not in (None, "", []):
                continue
            value = preflight_answers.get(source_key)
            if value in (None, "", []):
                continue
            payload[target_key] = value
    try:
        agent_count = int(payload.get("agentCount") or payload.get("agent_count") or 24)
    except (TypeError, ValueError):
        agent_count = 24
    target_audience = payload.get("targetAudience") or payload.get("target_audience") or []
    if isinstance(target_audience, str):
        target_audience = [part.strip() for part in target_audience.split(",") if part.strip()]
    goals = payload.get("goals") or []
    if isinstance(goals, str):
        goals = [part.strip() for part in goals.split(",") if part.strip()]
    persona_source_mode = _normalize_persona_source_mode(
        payload.get("personaSourceMode") or payload.get("persona_source_mode")
    )
    place_name = str(
        payload.get("place_name")
        or payload.get("placeName")
        or payload.get("place")
        or ""
    ).strip()
    location = str(payload.get("location") or "").strip()
    if not location and place_name:
        location = place_name
    if not place_name and location:
        place_name = location
    return {
        "idea": str(payload.get("idea") or "").strip(),
        "category": str(payload.get("category") or "").strip().lower(),
        "country": str(payload.get("country") or "").strip(),
        "city": str(payload.get("city") or "").strip(),
        "location": location,
        "place_name": place_name,
        "personaSetKey": str(payload.get("personaSetKey") or payload.get("persona_set_key") or "").strip(),
        "personaSetLabel": str(payload.get("personaSetLabel") or payload.get("persona_set_label") or "").strip(),
        "targetAudience": [str(item).strip() for item in target_audience if str(item).strip()],
        "goals": [str(item).strip() for item in goals if str(item).strip()],
        "riskBoundary": str(payload.get("riskBoundary") or payload.get("risk_boundary") or "").strip(),
        "valueProposition": str(payload.get("valueProposition") or payload.get("value_proposition") or "").strip(),
        "deliveryModel": str(payload.get("deliveryModel") or payload.get("delivery_model") or "").strip(),
        "monetization": str(payload.get("monetization") or payload.get("pricing") or "").strip(),
        "datasetHint": str(payload.get("datasetHint") or payload.get("dataset_hint") or "").strip(),
        "notes": str(payload.get("notes") or "").strip(),
        "agentCount": max(5, min(500, agent_count)),
        "minimumPersonaThreshold": payload.get("minimumPersonaThreshold") or payload.get("minimum_persona_threshold") or None,
        "language": "ar" if str(payload.get("language") or "en").lower().startswith("ar") else "en",
        "personaSourceMode": persona_source_mode or "",
    }


def context_location_label(context: Dict[str, Any]) -> str:
    parts = [
        str(context.get("location") or "").strip(),
        str(context.get("place_name") or "").strip(),
        str(context.get("city") or "").strip(),
        str(context.get("country") or "").strip(),
    ]
    unique: List[str] = []
    for part in parts:
        if not part or part in unique:
            continue
        unique.append(part)
    return ", ".join(unique)


def classify_idea_context(context: Dict[str, Any]) -> IdeaContextType:
    idea = str(context.get("idea") or "").lower()
    category = str(context.get("category") or "").lower()
    location_label = context_location_label(context)
    location_present = bool(location_label)
    general_terms = {
        "saas",
        "software",
        "platform",
        "online",
        "app",
        "marketplace",
        "website",
        "device",
        "invention",
        "global",
        "remote",
    }
    local_terms = {
        "restaurant",
        "cafe",
        "clinic",
        "delivery",
        "salon",
        "gym",
        "school",
        "store",
        "shop",
        "service",
        "local",
    }
    has_general_signal = any(term in idea for term in general_terms) or category in {
        "technology",
        "b2b saas",
        "consumer apps",
        "hardware",
        "social",
        "entertainment",
    }
    has_local_signal = location_present or any(term in idea for term in local_terms) or category in {
        "healthcare",
        "education",
        "e-commerce",
    }
    if location_present and has_general_signal:
        return IdeaContextType.HYBRID
    if has_local_signal and location_present:
        return IdeaContextType.LOCATION_BASED
    if has_local_signal and has_general_signal:
        return IdeaContextType.HYBRID
    if location_present:
        return IdeaContextType.LOCATION_BASED
    return IdeaContextType.GENERAL_NON_LOCATION


def resolve_persona_source_mode(
    context: Dict[str, Any],
    *,
    context_type: IdeaContextType,
) -> tuple[str, bool]:
    explicit = _normalize_persona_source_mode(context.get("personaSourceMode"))
    if explicit:
        return explicit, False
    if context_location_label(context):
        return PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value, True
    if context_type == IdeaContextType.GENERAL_NON_LOCATION:
        return PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value, True
    return PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value, True


def build_default_pipeline_steps() -> Dict[str, Dict[str, Any]]:
    return {
        key: {
            "key": key,
            "label": dict(PIPELINE_STEP_LABELS.get(key) or {}),
            "status": "pending",
        }
        for key in PIPELINE_STEP_ORDER
    }


def reset_pipeline_steps(
    pipeline_steps: Optional[Dict[str, Dict[str, Any]]],
    *,
    from_step: str,
) -> Dict[str, Dict[str, Any]]:
    next_steps = build_default_pipeline_steps()
    current = pipeline_steps or {}
    try:
        from_index = PIPELINE_STEP_ORDER.index(from_step)
    except ValueError:
        return next_steps
    for index, key in enumerate(PIPELINE_STEP_ORDER):
        if index < from_index and isinstance(current.get(key), dict):
            next_steps[key].update(
                {
                    "status": current[key].get("status") if current[key].get("status") == "completed" else "pending",
                    "started_at": current[key].get("started_at"),
                    "completed_at": current[key].get("completed_at"),
                    "detail": current[key].get("detail"),
                }
            )
    return next_steps


def pipeline_reset_step_for_phase(phase: SimulationPhase) -> str:
    if phase in {SimulationPhase.IDEA_INTAKE, SimulationPhase.CONTEXT_CLASSIFICATION}:
        return "analyzing_idea_type"
    if phase == SimulationPhase.INTERNET_RESEARCH:
        return "building_search_queries"
    if phase == SimulationPhase.PERSONA_GENERATION:
        return "extracting_people_patterns"
    if phase == SimulationPhase.PERSONA_PERSISTENCE:
        return "saving_personas"
    return "ready_for_simulation"


@dataclass
class ResearchQuery:
    query: str
    reason: str

    def to_dict(self) -> Dict[str, Any]:
        return {"query": self.query, "reason": self.reason}


@dataclass
class EvidenceItem:
    query: str
    title: str
    url: str
    domain: str
    snippet: str
    content: str = ""
    relevance_score: float = 0.0
    http_status: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query": self.query,
            "title": self.title,
            "url": self.url,
            "domain": self.domain,
            "snippet": self.snippet,
            "content": self.content,
            "relevance_score": self.relevance_score,
            "http_status": self.http_status,
        }


@dataclass
class ResearchReport:
    query_plan: List[ResearchQuery] = field(default_factory=list)
    evidence: List[EvidenceItem] = field(default_factory=list)
    summary: str = ""
    findings: List[str] = field(default_factory=list)
    gaps: List[str] = field(default_factory=list)
    quality: Dict[str, Any] = field(default_factory=dict)
    structured_schema: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "query_plan": [item.to_dict() for item in self.query_plan],
            "evidence": [item.to_dict() for item in self.evidence],
            "summary": self.summary,
            "findings": list(self.findings),
            "gaps": list(self.gaps),
            "quality": dict(self.quality),
            "structured_schema": dict(self.structured_schema),
        }


@dataclass
class PersonaProfile:
    persona_id: str
    name: str
    source_mode: str
    target_audience_cluster: str
    location_context: str
    age_band: str
    life_stage: str
    profession_role: str
    attitude_baseline: str
    skepticism_level: float
    conformity_level: float
    stubbornness_level: float
    innovation_openness: float
    financial_sensitivity: float
    speaking_style: str
    tags: List[str]
    source_attribution: Dict[str, Any]
    evidence_signals: List[str]
    category_id: str
    template_id: str
    archetype_name: str
    summary: str
    motivations: List[str]
    concerns: List[str]
    location: str
    segment_id: str = ""
    price_sensitivity_bucket: str = "medium"
    decision_style: str = ""
    purchase_trigger: str = ""
    rejection_trigger: str = ""
    opinion: str = "neutral"
    confidence: float = 0.5
    influence_weight: float = 1.0
    traits: Dict[str, float] = field(default_factory=dict)
    biases: List[str] = field(default_factory=list)
    opinion_score: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "persona_id": self.persona_id,
            "name": self.name,
            "display_name": self.name,
            "source_mode": self.source_mode,
            "target_audience_cluster": self.target_audience_cluster,
            "segment_id": self.segment_id,
            "location_context": self.location_context,
            "age_band": self.age_band,
            "life_stage": self.life_stage,
            "profession_role": self.profession_role,
            "attitude_baseline": self.attitude_baseline,
            "skepticism_level": self.skepticism_level,
            "conformity_level": self.conformity_level,
            "stubbornness_level": self.stubbornness_level,
            "innovation_openness": self.innovation_openness,
            "financial_sensitivity": self.financial_sensitivity,
            "speaking_style": self.speaking_style,
            "tags": list(self.tags),
            "source_attribution": dict(self.source_attribution),
            "evidence_signals": list(self.evidence_signals),
            "category_id": self.category_id,
            "template_id": self.template_id,
            "archetype_name": self.archetype_name,
            "summary": self.summary,
            "motivations": list(self.motivations),
            "concerns": list(self.concerns),
            "location": self.location,
            "price_sensitivity_bucket": self.price_sensitivity_bucket,
            "decision_style": self.decision_style,
            "purchase_trigger": self.purchase_trigger,
            "rejection_trigger": self.rejection_trigger,
            "opinion": self.opinion,
            "confidence": self.confidence,
            "influence_weight": self.influence_weight,
            "traits": dict(self.traits),
            "biases": list(self.biases),
            "opinion_score": self.opinion_score,
        }

    def to_agent_row(self) -> Dict[str, Any]:
        return {
            "agent_id": self.persona_id,
            "agent_short_id": self.persona_id[:4],
            "category_id": self.category_id,
            "template_id": self.template_id,
            "archetype_name": self.archetype_name,
            "display_name": self.name,
            "source_mode": self.source_mode,
            "target_audience_cluster": self.target_audience_cluster,
            "segment_id": self.segment_id,
            "location_context": self.location_context,
            "age_band": self.age_band,
            "life_stage": self.life_stage,
            "profession_role": self.profession_role,
            "attitude_baseline": self.attitude_baseline,
            "skepticism_level": self.skepticism_level,
            "conformity_level": self.conformity_level,
            "stubbornness_level": self.stubbornness_level,
            "innovation_openness": self.innovation_openness,
            "financial_sensitivity": self.financial_sensitivity,
            "speaking_style": self.speaking_style,
            "main_concerns": list(self.concerns),
            "probable_motivations": list(self.motivations),
            "tags": list(self.tags),
            "source_attribution": dict(self.source_attribution),
            "evidence_signals": list(self.evidence_signals),
            "traits": self.traits,
            "biases": self.biases,
            "price_sensitivity_bucket": self.price_sensitivity_bucket,
            "decision_style": self.decision_style,
            "purchase_trigger": self.purchase_trigger,
            "rejection_trigger": self.rejection_trigger,
            "influence_weight": self.influence_weight,
            "is_leader": False,
            "fixed_opinion": None,
            "initial_opinion": self.opinion,
            "opinion": self.opinion,
            "confidence": self.confidence,
        }

    def to_public_agent(self) -> Dict[str, Any]:
        return {
            "agent_id": self.persona_id,
            "name": self.name,
            "display_name": self.name,
            "archetype_name": self.archetype_name,
            "category_id": self.category_id,
            "source_mode": self.source_mode,
            "target_audience_cluster": self.target_audience_cluster,
            "segment_id": self.segment_id,
            "location_context": self.location_context,
            "age_band": self.age_band,
            "life_stage": self.life_stage,
            "profession_role": self.profession_role,
            "attitude_baseline": self.attitude_baseline,
            "skepticism_level": self.skepticism_level,
            "conformity_level": self.conformity_level,
            "stubbornness_level": self.stubbornness_level,
            "innovation_openness": self.innovation_openness,
            "financial_sensitivity": self.financial_sensitivity,
            "speaking_style": self.speaking_style,
            "current_opinion": self.opinion,
            "confidence": self.confidence,
            "summary": self.summary,
            "motivations": list(self.motivations),
            "concerns": list(self.concerns),
            "tags": list(self.tags),
            "source_attribution": dict(self.source_attribution),
            "evidence_signals": list(self.evidence_signals),
            "price_sensitivity_bucket": self.price_sensitivity_bucket,
            "decision_style": self.decision_style,
            "purchase_trigger": self.purchase_trigger,
            "rejection_trigger": self.rejection_trigger,
            "influence_weight": self.influence_weight,
            "traits": dict(self.traits),
            "biases": list(self.biases),
            "opinion_score": self.opinion_score,
            "cluster_id": str(self.traits.get("cluster_id") or ""),
            "dynamic_skepticism": float(self.traits.get("dynamic_skepticism", self.traits.get("skepticism", 0.5))),
            "question_drive": float(self.traits.get("question_drive", 0.45)),
        }


def apply_persona_dynamic_defaults(persona: PersonaProfile) -> PersonaProfile:
    basis = " ".join(
        part
        for part in [
            str(persona.target_audience_cluster or "").strip(),
            str(persona.persona_id or persona.name or "persona").strip(),
        ]
        if part
    ).lower()
    slug = "-".join(part for part in basis.replace("/", " ").replace("_", " ").split() if part) or "persona"
    if not str(persona.segment_id or "").strip():
        persona.segment_id = slug[:64]
    if not str(persona.price_sensitivity_bucket or "").strip():
        persona.price_sensitivity_bucket = "medium"
    if not str(persona.decision_style or "").strip():
        persona.decision_style = "comparison-led"
    if not str(persona.purchase_trigger or "").strip():
        persona.purchase_trigger = "clear value"
    if not str(persona.rejection_trigger or "").strip():
        persona.rejection_trigger = "weak differentiation"
    return persona


@dataclass
class ClarificationQuestion:
    question_id: str
    field_name: str
    prompt: str
    reason: str
    required: bool = True
    options: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "question_id": self.question_id,
            "field_name": self.field_name,
            "prompt": self.prompt,
            "reason": self.reason,
            "required": self.required,
            "options": list(self.options),
        }


@dataclass
class DialogueTurn:
    step_uid: str
    iteration: int
    phase: str
    agent_id: str
    agent_name: str
    reply_to_agent_id: Optional[str]
    reply_to_agent_name: Optional[str]
    message: str
    stance_before: str
    stance_after: str
    confidence: float
    influence_delta: float
    evidence_urls: List[str] = field(default_factory=list)
    reason_tag: str = "debate"
    message_type: str = "argument"
    argument_id: Optional[str] = None
    insight_tag: Optional[str] = None
    question_asked: Optional[str] = None

    def to_reasoning_row(self) -> Dict[str, Any]:
        return {
            "step_uid": self.step_uid,
            "agent_id": self.agent_id,
            "agent_short_id": self.agent_id[:4],
            "agent_label": self.agent_name,
            "archetype_name": self.agent_name,
            "iteration": self.iteration,
            "phase": self.phase,
            "reply_to_agent_id": self.reply_to_agent_id,
            "reply_to_short_id": (self.reply_to_agent_id or "")[:4] or None,
            "opinion": self.stance_after,
            "opinion_source": "agent_deliberation",
            "stance_confidence": self.confidence,
            "reasoning_length": "full",
            "fallback_reason": None,
            "relevance_score": self.influence_delta,
            "policy_guard": False,
            "policy_reason": None,
            "stance_locked": False,
            "reason_tag": self.reason_tag,
            "clarification_triggered": bool(self.question_asked),
            "event_seq": None,
            "stance_before": self.stance_before,
            "stance_after": self.stance_after,
            "message": self.message,
            "evidence_keys": list(self.evidence_urls),
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            "step_uid": self.step_uid,
            "iteration": self.iteration,
            "phase": self.phase,
            "agent_id": self.agent_id,
            "agent_name": self.agent_name,
            "reply_to_agent_id": self.reply_to_agent_id,
            "reply_to_agent_name": self.reply_to_agent_name,
            "message": self.message,
            "stance_before": self.stance_before,
            "stance_after": self.stance_after,
            "confidence": self.confidence,
            "influence_delta": self.influence_delta,
            "evidence_urls": list(self.evidence_urls),
            "reason_tag": self.reason_tag,
            "message_type": self.message_type,
            "argument_id": self.argument_id,
            "insight_tag": self.insight_tag,
            "question_asked": self.question_asked,
        }


@dataclass
class OrchestrationEvent:
    seq: int
    event_type: str
    phase: str
    payload: Dict[str, Any]
    timestamp_ms: int = field(default_factory=now_ms)

    def to_dict(self, simulation_id: str) -> Dict[str, Any]:
        return {
            "simulation_id": simulation_id,
            "event_seq": self.seq,
            "type": self.event_type,
            "phase": self.phase,
            "timestamp_ms": self.timestamp_ms,
            **self.payload,
        }


@dataclass
class OrchestrationState:
    simulation_id: str
    user_id: Optional[int]
    user_context: Dict[str, Any]
    status: str = SimulationStatus.RUNNING.value
    status_reason: str = SimulationStatus.RUNNING.value
    current_phase: SimulationPhase = SimulationPhase.IDEA_INTAKE
    completed_phases: List[str] = field(default_factory=list)
    phase_details: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    schema: Dict[str, Any] = field(default_factory=dict)
    research: Optional[ResearchReport] = None
    personas: List[PersonaProfile] = field(default_factory=list)
    clarification_questions: List[ClarificationQuestion] = field(default_factory=list)
    clarification_answers: Dict[str, str] = field(default_factory=dict)
    dialogue_turns: List[DialogueTurn] = field(default_factory=list)
    argument_bank: List[Dict[str, Any]] = field(default_factory=list)
    critical_insights: List[Dict[str, Any]] = field(default_factory=list)
    deliberation_state: Dict[str, Any] = field(default_factory=dict)
    metrics: Dict[str, Any] = field(default_factory=dict)
    summary: str = ""
    summary_ready: bool = False
    rollback_target: Optional[str] = None
    last_change_impact: Optional[str] = None
    pending_input: bool = False
    pending_input_kind: Optional[str] = None
    pending_resume_phase: Optional[str] = None
    error: Optional[str] = None
    event_seq: int = 0
    event_log: List[OrchestrationEvent] = field(default_factory=list)
    created_at: int = field(default_factory=now_ms)
    updated_at: int = field(default_factory=now_ms)
    idea_context_type: Optional[str] = None
    persona_source_mode: Optional[str] = None
    persona_source_auto_selected: bool = False
    persona_source_notice: Optional[str] = None
    persona_set: Optional[Dict[str, Any]] = None
    persona_generation_debug: Dict[str, Any] = field(default_factory=dict)
    persona_validation_errors: List[str] = field(default_factory=list)
    pipeline_steps: Dict[str, Dict[str, Any]] = field(default_factory=build_default_pipeline_steps)
    search_completed: bool = False
    persona_generation_completed: bool = False
    persona_persistence_completed: bool = False
    simulation_ready: bool = False

    def _research_contract_ready(self) -> bool:
        if self.search_completed and (self.persona_generation_completed or self.persona_persistence_completed or self.personas):
            return True
        structured = self.research.structured_schema if self.research and isinstance(self.research.structured_schema, dict) else {}
        if not str(structured.get("summary") or "").strip():
            return False
        if any(not str(structured.get(key) or "").strip() for key in ("competition_level", "demand_level", "price_sensitivity")):
            return False
        sentiment = structured.get("user_sentiment") if isinstance(structured.get("user_sentiment"), dict) else {}
        sentiment_count = sum(
            len([str(item).strip() for item in sentiment.get(key) or [] if str(item).strip()])
            for key in ("positive", "negative", "neutral")
        )
        signal_count = sum(
            len([str(item).strip() for item in structured.get(key) or [] if str(item).strip()])
            for key in ("signals", "complaints", "behaviors", "behavior_patterns", "gaps_in_market")
        )
        return sentiment_count >= 1 and signal_count >= 3

    def _research_runtime_status(self) -> Dict[str, Any]:
        search_finished = bool(self.schema.get("search_finished"))
        estimated = bool(self.schema.get("research_estimated"))
        usable = self._research_contract_ready()
        structured = self.research.structured_schema if self.research and isinstance(getattr(self.research, "structured_schema", None), dict) else {}
        summary = str(getattr(self.research, "summary", "") or "").strip()
        findings = list(getattr(self.research, "findings", []) or [])
        evidence = list(getattr(self.research, "evidence", []) or [])
        has_live_report = bool(
            self.research
            and (
                summary
                or findings
                or evidence
                or any(str(value).strip() for value in structured.values() if value is not None)
            )
        )
        insufficient = has_live_report and not usable
        fatal = search_finished and not has_live_report
        warnings: List[str] = []
        blockers: List[str] = []
        if estimated:
            warnings.append("used_ai_estimation_due_to_weak_search")
        if str(self.schema.get("research_insufficiency_reason") or "").strip():
            warnings.append("research_insufficient_for_personas")
        if fatal:
            blockers.append("fatal_search_failure")
        elif insufficient:
            blockers.append("research_insufficient_for_personas")
        return {
            "search_finished": search_finished,
            "estimated": estimated,
            "usable": usable,
            "has_live_report": has_live_report,
            "insufficient": insufficient,
            "fatal": fatal,
            "warnings": warnings,
            "blockers": blockers,
        }

    def _persona_generation_ready(self) -> bool:
        validation = self._validation_snapshot()
        actual_count = max(len(self.personas), int(validation.get("actual_count") or 0))
        return bool(self.persona_generation_completed and actual_count > 0)

    def _persona_persistence_ready(self) -> bool:
        return bool(self.persona_persistence_completed and (self.persona_set or self.personas))

    def pending_questions_snapshot(self) -> List[ClarificationQuestion]:
        answered = set(self.clarification_answers.keys())
        return [
            question
            for question in self.clarification_questions
            if question.question_id not in answered and not self.is_field_resolved(question.field_name)
        ]

    def active_pending_clarification(self) -> Optional[ClarificationQuestion]:
        if not self.pending_input or self.pending_input_kind != "clarification":
            return None
        questions = self.pending_questions_snapshot()
        return questions[0] if questions else None

    def reconcile_runtime_contracts(self) -> None:
        self.search_completed = self._research_contract_ready()
        validation = self._validation_snapshot()
        actual_count = max(len(self.personas), int(validation.get("actual_count") or 0))
        if actual_count <= 0:
            self.persona_generation_completed = False
        if not self.personas and actual_count <= 0:
            self.persona_generation_completed = False
        if not self.persona_set and not self.personas:
            self.persona_persistence_completed = False
        self.refresh_persona_source_resolution()
        self.prune_stale_clarifications()
        if self.pending_input_kind != "clarification" and not self.pending_input:
            self.clarification_questions = []
            self.clarification_answers = {}
        self.schema["research_usable"] = self.search_completed

    def phase_progress_pct(self) -> float:
        base = phase_position(self.current_phase)
        completed = len(self.completed_phases)
        value = max(completed, base) / max(1, len(PHASE_ORDER))
        return round(min(1.0, value) * 100.0, 2)

    def mark_phase_started(self, phase: SimulationPhase) -> None:
        if phase_position(phase) > 0:
            prior = PHASE_ORDER[phase_position(phase) - 1]
            if prior.value not in self.completed_phases:
                raise RuntimeError(f"Cannot enter phase {phase.value} before {prior.value}")
        self.current_phase = phase
        self.phase_details.setdefault(phase.value, {})
        self.phase_details[phase.value]["status"] = "running"
        self.phase_details[phase.value]["started_at"] = now_ms()
        self.updated_at = now_ms()

    def mark_phase_completed(self, phase: SimulationPhase, meta: Optional[Dict[str, Any]] = None) -> None:
        if phase.value not in self.completed_phases:
            self.completed_phases.append(phase.value)
        self.phase_details.setdefault(phase.value, {})
        self.phase_details[phase.value]["status"] = "completed"
        self.phase_details[phase.value]["completed_at"] = now_ms()
        if meta:
            self.phase_details[phase.value].update(meta)
        self.updated_at = now_ms()

    def set_pipeline_step(
        self,
        key: str,
        status: str,
        *,
        detail: Optional[str] = None,
        meta: Optional[Dict[str, Any]] = None,
    ) -> None:
        if key not in self.pipeline_steps:
            self.pipeline_steps[key] = {
                "key": key,
                "label": dict(PIPELINE_STEP_LABELS.get(key) or {}),
            }
        step = self.pipeline_steps[key]
        step["status"] = status
        timestamp = now_ms()
        if status == "running":
            step["started_at"] = step.get("started_at") or timestamp
            step.pop("completed_at", None)
        if status == "completed":
            step["started_at"] = step.get("started_at") or timestamp
            step["completed_at"] = timestamp
        if status in {"pending", "blocked"}:
            step.pop("completed_at", None)
        if detail:
            step["detail"] = detail
        elif detail == "":
            step.pop("detail", None)
        if meta:
            step.update(meta)
        self.updated_at = timestamp

    def reset_pipeline_from(self, step_key: str) -> None:
        self.pipeline_steps = reset_pipeline_steps(self.pipeline_steps, from_step=step_key)
        self.simulation_ready = False
        self.updated_at = now_ms()

    def _validation_snapshot(self) -> Dict[str, Any]:
        validation = (self.persona_generation_debug or {}).get("validation") if isinstance(self.persona_generation_debug, dict) else {}
        if not isinstance(validation, dict):
            validation = {}
        return {
            "fatal_errors": [str(item).strip() for item in validation.get("fatal_errors") or [] if str(item).strip()],
            "simulation_blockers": [str(item).strip() for item in validation.get("simulation_blockers") or [] if str(item).strip()],
            "warnings": [str(item).strip() for item in validation.get("warnings") or [] if str(item).strip()],
            "actual_count": int(validation.get("actual_count") or 0),
            "raw": validation,
        }

    def clear_runtime_schema_state(self, *, include_research: bool = False) -> None:
        keys = list(PIPELINE_RUNTIME_SCHEMA_KEYS)
        if include_research:
            keys.extend(RESEARCH_RUNTIME_SCHEMA_KEYS)
        for key in keys:
            self.schema.pop(key, None)

    def resolve_persona_source_contract(self) -> tuple[Optional[str], bool]:
        requested_mode = _normalize_persona_source_mode(self.user_context.get("personaSourceMode"))
        selected_set_key = str(self.user_context.get("personaSetKey") or "").strip()
        if requested_mode == PersonaSourceMode.SAVED_PLACE_PERSONAS.value or selected_set_key:
            return PersonaSourceMode.SAVED_PLACE_PERSONAS.value, bool(not requested_mode)

        if self.persona_generation_completed and self.personas:
            source_kinds = {
                str((persona.source_attribution or {}).get("kind") or "").strip()
                for persona in self.personas
                if isinstance(persona.source_attribution, dict)
            }
            source_kinds.discard("")
            if requested_mode == PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value:
                return PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value, False
            if source_kinds and source_kinds <= {"audience_fallback"}:
                return PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value, True
            if self._research_contract_ready():
                return PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value, True

        if requested_mode:
            return requested_mode, False

        if context_location_label(self.user_context):
            return PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value, True
        if (self.idea_context_type or "") == IdeaContextType.GENERAL_NON_LOCATION.value:
            return PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value, True
        if self._research_contract_ready():
            return PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value, True
        return None, False

    def refresh_persona_source_resolution(self) -> Optional[str]:
        mode, auto_selected = self.resolve_persona_source_contract()
        self.persona_source_mode = mode
        self.persona_source_auto_selected = auto_selected if mode else False
        self.user_context["personaSourceMode"] = mode or ""
        self.schema["persona_source"] = mode or ""
        self.schema["persona_source_auto_selected"] = self.persona_source_auto_selected
        return mode

    def is_field_resolved(self, field_name: str) -> bool:
        direct_value = self.user_context.get(field_name)
        if isinstance(direct_value, str) and direct_value.strip():
            return True
        if isinstance(direct_value, list) and any(str(item).strip() for item in direct_value):
            return True
        schema_value = self.schema.get(field_name)
        if isinstance(schema_value, str) and schema_value.strip():
            return True
        if isinstance(schema_value, list) and any(str(item).strip() for item in schema_value):
            return True

        aliases = {
            "targetAudience": "targetAudience",
            "target_audience": "targetAudience",
            "valueProposition": "valueProposition",
            "monetization": "monetization",
            "deliveryModel": "deliveryModel",
            "riskBoundary": "riskBoundary",
            "personaSourceMode": "personaSourceMode",
        }
        key = aliases.get(field_name, field_name)
        if key == "targetAudience":
            audience = self.user_context.get("targetAudience") or self.schema.get("targetAudience") or []
            return isinstance(audience, list) and any(str(item).strip() for item in audience)
        if key == "personaSourceMode":
            return bool(self.refresh_persona_source_resolution())
        return False

    def prune_stale_clarifications(self) -> None:
        filtered = []
        answered = {}
        for question in self.clarification_questions:
            if self.is_field_resolved(question.field_name):
                continue
            filtered.append(question)
            if question.question_id in self.clarification_answers:
                answered[question.question_id] = self.clarification_answers[question.question_id]
        self.clarification_questions = filtered
        self.clarification_answers = answered
        if not self.clarification_questions and self.pending_input_kind == "clarification":
            self.pending_input = False
            self.pending_input_kind = None
            self.pending_resume_phase = None

    def pipeline_status_snapshot(self) -> Dict[str, Any]:
        validation = self._validation_snapshot()
        actual_count = max(len(self.personas), int(validation.get("actual_count") or 0))
        persona_source_mode, persona_source_auto_selected = self.resolve_persona_source_contract()
        pending_questions = self.pending_questions_snapshot()
        blockers: List[str] = []
        research_status = self._research_runtime_status()
        research_warnings = list(research_status["warnings"])
        research_blockers = list(research_status["blockers"])
        warnings = list(dict.fromkeys(validation["warnings"] + research_warnings))
        fatal_errors = list(dict.fromkeys(validation["fatal_errors"]))
        search_ready = bool(research_status["usable"])
        persona_generation_ready = self._persona_generation_ready()
        persona_persistence_ready = self._persona_persistence_ready()

        if self.pending_input_kind == "research_review":
            blockers.append("research_insufficient_for_personas")
        elif not search_ready:
            if research_blockers:
                blockers.extend(research_blockers)
            elif research_status["has_live_report"]:
                blockers.append("research_insufficient_for_personas")
            else:
                blockers.append("search_did_not_run")
        elif not persona_generation_ready:
            blockers.append("persona_generation_not_finished")
            if actual_count <= 0:
                blockers.append("persona_count_zero")
        else:
            if not persona_source_mode:
                blockers.append("persona_source_unresolved")
            if fatal_errors:
                blockers.extend(fatal_errors)
                blockers.append("persona_validation_failed")
            blockers.extend(validation["simulation_blockers"])
            if self.pending_input_kind == "clarification" and pending_questions:
                blockers.append("clarification_pending")
            elif not blockers and not persona_persistence_ready:
                blockers.append("persona_persistence_not_finished")

        unique_blockers = list(dict.fromkeys([item for item in blockers if item]))
        blocker_details: List[Dict[str, Any]] = []
        blocked_phase = None
        for code in unique_blockers:
            meta = PIPELINE_BLOCKER_META.get(code) or {}
            phase_key = str(meta.get("phase") or (
                SimulationPhase.INTERNET_RESEARCH.value
                if code.startswith("search") or code.startswith("research")
                else SimulationPhase.PERSONA_GENERATION.value
            ))
            blocked_phase = blocked_phase or phase_key
            blocker_details.append(
                {
                    "code": code,
                    "phase_key": phase_key,
                    "title": str(meta.get("title") or code.replace("_", " ")).strip(),
                    "message": str(meta.get("message") or code.replace("_", " ")).strip(),
                    "action": str(meta.get("action") or "").strip() or None,
                }
            )
        actively_blocked = bool(unique_blockers) and (
            (
                self.status == SimulationStatus.ERROR.value
                and str(self.status_reason or "").strip() == "pipeline_blocked"
            )
            or phase_position(self.current_phase) >= phase_position(SimulationPhase.SIMULATION_INITIALIZATION)
        )
        return {
            "ready_for_simulation": len(unique_blockers) == 0,
            "blockers": unique_blockers,
            "blocker_details": blocker_details,
            "blocked_phase": blocked_phase,
            "actively_blocked": actively_blocked,
            "warnings": warnings,
            "fatal_errors": fatal_errors,
            "validation": validation["raw"],
            "persona_source_mode": persona_source_mode,
            "persona_source_auto_selected": persona_source_auto_selected,
        }

    def pipeline_blockers(self) -> List[str]:
        return list(self.pipeline_status_snapshot().get("blockers") or [])

    def validate_pipeline_ready_for_simulation(self) -> List[str]:
        self.reconcile_runtime_contracts()
        snapshot = self.pipeline_status_snapshot()
        blockers = list(snapshot.get("blockers") or [])
        self.simulation_ready = bool(snapshot.get("ready_for_simulation"))
        self.persona_source_mode = snapshot.get("persona_source_mode")
        self.persona_source_auto_selected = bool(snapshot.get("persona_source_auto_selected"))
        self.schema["pipeline_status"] = snapshot
        if self.simulation_ready:
            self.set_pipeline_step("ready_for_simulation", "completed", detail="Pipeline validated.")
        else:
            blocked_detail = " | ".join(
                str(item.get("message") or "").strip()
                for item in snapshot.get("blocker_details") or []
                if isinstance(item, dict) and str(item.get("message") or "").strip()
            )[:320]
            self.set_pipeline_step(
                "ready_for_simulation",
                "blocked" if snapshot.get("actively_blocked") else "pending",
                detail=(
                    (blocked_detail or "The pipeline is blocked until required upstream state is resolved.")
                    if snapshot.get("actively_blocked")
                    else "Upstream stages are still running; simulation readiness will unlock automatically."
                ),
                meta={
                    "blocked_phase": snapshot.get("blocked_phase"),
                    "actively_blocked": bool(snapshot.get("actively_blocked")),
                },
            )
        return blockers

    def rollback_to(self, phase: SimulationPhase, reason: str) -> None:
        keep = phase_position(phase)
        self.completed_phases = [item for item in self.completed_phases if phase_position(item) < keep]
        self.current_phase = phase
        self.rollback_target = phase.value
        self.status = SimulationStatus.RUNNING.value
        self.status_reason = "rollback"
        self.pending_input = False
        self.pending_input_kind = None
        self.pending_resume_phase = None
        self.summary = ""
        self.summary_ready = False
        self.error = None
        self.simulation_ready = False
        self.phase_details.setdefault(phase.value, {})
        self.phase_details[phase.value]["rollback_reason"] = reason
        self.reset_pipeline_from(pipeline_reset_step_for_phase(phase))
        self.clear_runtime_schema_state(include_research=keep <= phase_position(SimulationPhase.INTERNET_RESEARCH))
        if keep <= phase_position(SimulationPhase.CONTEXT_CLASSIFICATION):
            self.idea_context_type = None
            self.persona_source_mode = None
            self.persona_source_auto_selected = False
            self.persona_source_notice = None
        if keep <= phase_position(SimulationPhase.INTERNET_RESEARCH):
            self.research = None
            self.search_completed = False
        if keep <= phase_position(SimulationPhase.PERSONA_GENERATION):
            self.personas = []
            self.persona_generation_completed = False
            self.persona_generation_debug = {}
            self.persona_validation_errors = []
        if keep <= phase_position(SimulationPhase.PERSONA_PERSISTENCE):
            self.persona_persistence_completed = False
            self.persona_set = None
        if keep <= phase_position(SimulationPhase.CLARIFICATION_QUESTIONS):
            self.clarification_questions = []
            self.clarification_answers = {}
        if keep <= phase_position(SimulationPhase.AGENT_DELIBERATION):
            self.dialogue_turns = []
            self.argument_bank = []
            self.critical_insights = []
            self.deliberation_state = {}
            self.metrics = {}
        self.updated_at = now_ms()

    def continue_from_phase(self, phase: SimulationPhase, reason: str) -> None:
        keep = phase_position(phase)
        self.completed_phases = [item for item in self.completed_phases if phase_position(item) < keep]
        self.current_phase = phase
        self.rollback_target = phase.value
        self.status = SimulationStatus.RUNNING.value
        self.status_reason = reason
        self.pending_input = False
        self.pending_input_kind = None
        self.pending_resume_phase = None
        self.summary = ""
        self.summary_ready = False
        self.error = None
        self.simulation_ready = False
        self.phase_details.setdefault(phase.value, {})
        self.phase_details[phase.value]["continue_reason"] = reason
        self.reset_pipeline_from(pipeline_reset_step_for_phase(phase))
        self.clear_runtime_schema_state(include_research=keep <= phase_position(SimulationPhase.INTERNET_RESEARCH))
        if keep <= phase_position(SimulationPhase.INTERNET_RESEARCH):
            self.research = None
            self.search_completed = False
        if keep <= phase_position(SimulationPhase.PERSONA_GENERATION):
            self.personas = []
            self.persona_generation_completed = False
            self.persona_generation_debug = {}
            self.persona_validation_errors = []
        if keep <= phase_position(SimulationPhase.PERSONA_PERSISTENCE):
            self.persona_persistence_completed = False
            self.persona_set = None
        if keep <= phase_position(SimulationPhase.CLARIFICATION_QUESTIONS):
            self.clarification_questions = []
            self.clarification_answers = {}
        if keep <= phase_position(SimulationPhase.AGENT_DELIBERATION):
            self.dialogue_turns = []
            self.argument_bank = []
            self.critical_insights = []
            self.deliberation_state = {}
            self.metrics = {}
        self.updated_at = now_ms()

    def resume_from_phase_in_place(self, phase: SimulationPhase, reason: str) -> None:
        keep = phase_position(phase)
        self.completed_phases = [item for item in self.completed_phases if phase_position(item) < keep]
        self.current_phase = phase
        self.rollback_target = phase.value
        self.status = SimulationStatus.RUNNING.value
        self.status_reason = reason
        self.pending_input = False
        self.pending_input_kind = None
        self.pending_resume_phase = None
        self.summary = ""
        self.summary_ready = False
        self.error = None
        self.simulation_ready = False
        self.phase_details.setdefault(phase.value, {})
        self.phase_details[phase.value]["continue_reason"] = reason
        self.reset_pipeline_from(pipeline_reset_step_for_phase(phase))
        self.clear_runtime_schema_state(include_research=False)
        if keep <= phase_position(SimulationPhase.CLARIFICATION_QUESTIONS):
            self.clarification_questions = []
            self.clarification_answers = {}
        self.updated_at = now_ms()

    def next_phase(self) -> Optional[SimulationPhase]:
        current_index = phase_position(self.current_phase)
        if current_index >= len(PHASE_ORDER) - 1:
            return None
        return PHASE_ORDER[current_index + 1]

    def append_event(self, event_type: str, payload: Dict[str, Any]) -> OrchestrationEvent:
        self.event_seq += 1
        event = OrchestrationEvent(
            seq=self.event_seq,
            event_type=event_type,
            phase=self.current_phase.value,
            payload=payload,
        )
        self.event_log.append(event)
        self.event_log = self.event_log[-250:]
        self.updated_at = now_ms()
        return event

    def pending_questions(self) -> List[ClarificationQuestion]:
        self.prune_stale_clarifications()
        return self.pending_questions_snapshot()

    def persona_source_options(self) -> List[Dict[str, Any]]:
        resolved_mode, auto_selected = self.resolve_persona_source_contract()
        location_present = bool(context_location_label(self.user_context))
        options: List[Dict[str, Any]] = []
        for item in PERSONA_SOURCE_OPTIONS:
            option_mode = item["mode"]
            if option_mode == PersonaSourceMode.GENERATE_NEW_FROM_PLACE.value and not location_present:
                continue
            options.append(
                {
                    **item,
                    "recommended": option_mode == resolved_mode and auto_selected,
                }
            )
        if not location_present:
            options.append({"mode": "persona_lab", "label": "Go to persona lab", "recommended": False})
            options.append(
                {
                    "mode": "default_generated_audience",
                    "label": "Continue with default generated audience personas",
                    "recommended": resolved_mode == PersonaSourceMode.DEFAULT_AUDIENCE_ONLY.value,
                }
            )
        return options

    def to_checkpoint(self) -> Dict[str, Any]:
        return {
            "simulation_id": self.simulation_id,
            "user_id": self.user_id,
            "user_context": dict(self.user_context),
            "status": self.status,
            "status_reason": self.status_reason,
            "current_phase": self.current_phase.value,
            "completed_phases": list(self.completed_phases),
            "phase_details": dict(self.phase_details),
            "schema": dict(self.schema),
            "research": self.research.to_dict() if self.research else None,
            "personas": [item.to_dict() for item in self.personas],
            "clarification_questions": [item.to_dict() for item in self.clarification_questions],
            "clarification_answers": dict(self.clarification_answers),
            "dialogue_turns": [item.to_dict() for item in self.dialogue_turns],
            "argument_bank": list(self.argument_bank),
            "critical_insights": list(self.critical_insights),
            "deliberation_state": dict(self.deliberation_state),
            "metrics": dict(self.metrics),
            "summary": self.summary,
            "summary_ready": self.summary_ready,
            "rollback_target": self.rollback_target,
            "last_change_impact": self.last_change_impact,
            "pending_input": self.pending_input,
            "pending_input_kind": self.pending_input_kind,
            "pending_resume_phase": self.pending_resume_phase,
            "error": self.error,
            "event_seq": self.event_seq,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "idea_context_type": self.idea_context_type,
            "persona_source_mode": self.persona_source_mode,
            "persona_source_auto_selected": self.persona_source_auto_selected,
            "persona_source_notice": self.persona_source_notice,
            "persona_set": dict(self.persona_set or {}),
            "persona_generation_debug": dict(self.persona_generation_debug or {}),
            "persona_validation_errors": list(self.persona_validation_errors),
            "pipeline_steps": dict(self.pipeline_steps),
            "search_completed": self.search_completed,
            "persona_generation_completed": self.persona_generation_completed,
            "persona_persistence_completed": self.persona_persistence_completed,
            "simulation_ready": self.simulation_ready,
        }

    def to_public_state(self) -> Dict[str, Any]:
        pipeline_status = self.pipeline_status_snapshot()
        pending_question = self.active_pending_clarification()
        coach_entries = [
            item
            for item in self.critical_insights
            if isinstance(item, dict) and str(item.get("kind") or "").strip() == "orchestrator_intervention"
        ]
        active_coach = next((item for item in reversed(coach_entries) if not bool(item.get("resolved"))), None)

        def build_coach_payload(item: Dict[str, Any], *, index: int) -> Dict[str, Any]:
            suggestions = []
            for suggestion_index, suggestion in enumerate(item.get("suggestions") or [], start=1):
                text = str(suggestion or "").strip()
                if not text:
                    continue
                suggestions.append(
                    {
                        "suggestion_id": f"{str(item.get('tag') or 'coach').strip() or 'coach'}-{suggestion_index}",
                        "kind": "context_patch",
                        "title": text[:80],
                        "one_liner": text,
                        "rationale": str(item.get("message") or item.get("user_message") or "").strip(),
                        "cta_label": "Apply and rerun",
                        "evidence_ref_ids": [],
                        "context_patch": {},
                        "rerun_from_stage": "agent_deliberation",
                        "estimated_eta_delta_seconds": 0,
                    }
                )
            return {
                "intervention_id": str(item.get("intervention_id") or f"coach-{index + 1}").strip(),
                "simulation_id": self.simulation_id,
                "blocker_tag": str(item.get("tag") or "").strip(),
                "blocker_summary": str(item.get("user_message") or item.get("message") or "").strip(),
                "severity": "high" if float(item.get("severity") or 0.0) >= 0.85 else "medium",
                "should_pause": not bool(item.get("resolved")),
                "ui_state": (
                    "options_ready"
                    if self.pending_input_kind == "orchestrator_apply_suggestions" and not bool(item.get("resolved"))
                    else "diagnosed"
                    if self.pending_input_kind == "orchestrator_intervention" and not bool(item.get("resolved"))
                    else "resolved"
                ),
                "guide_message": str(item.get("message") or item.get("user_message") or "").strip() or None,
                "phase_key": SimulationPhase.AGENT_DELIBERATION.value,
                "suggestions": suggestions,
                "created_at": int(item.get("created_at") or self.updated_at),
                "resolved_at": int(item.get("resolved_at") or 0) or None,
                "resolution": str(item.get("resolution") or "").strip() or None,
                "history": (
                    [{"type": "suggestions_ready", "label": "Suggestions ready"}]
                    if suggestions
                    else [{"type": "detected", "label": "Issue detected"}]
                ),
            }

        return {
            "simulation_id": self.simulation_id,
            "status": self.status,
            "status_reason": self.status_reason,
            "current_phase_key": self.current_phase.value,
            "phase_progress_pct": self.phase_progress_pct(),
            "completed_phases": list(self.completed_phases),
            "user_context": dict(self.user_context),
            "schema": dict(self.schema),
            "research": self.research.to_dict() if self.research else None,
            "research_sources": [item.to_dict() for item in (self.research.evidence if self.research else [])],
            "agents": [item.to_public_agent() for item in self.personas],
            "reasoning": [item.to_dict() for item in self.dialogue_turns],
            "argument_bank": list(self.argument_bank[-12:]),
            "critical_insights": list(self.critical_insights),
            "deliberation_state": dict(self.deliberation_state),
            "metrics": dict(self.metrics),
            "summary": self.summary,
            "summary_ready": self.summary_ready,
            "reasoning_started": bool(self.dialogue_turns),
            "event_seq": self.event_seq,
            "report_status": self.schema.get("report_status"),
            "final_report": self.schema.get("final_report"),
            "report_summary": self.schema.get("report_summary"),
            "event_log_status": self.schema.get("event_log_status"),
            "event_log_count": int(self.schema.get("event_log_count") or 0),
            "search_finished": bool(self.schema.get("search_finished")),
            "research_ready": bool(self.schema.get("research_ready")),
            "research_estimated": bool(self.schema.get("research_estimated")),
            "research_usable": bool(self._research_contract_ready()),
            "search_provider_health": list(self.schema.get("search_provider_health") or []),
            "search_provider_attempts": list(self.schema.get("search_provider_attempts") or []),
            "memory_status": self.schema.get("memory_status"),
            "memory_provider": self.schema.get("memory_provider"),
            "memory_scope_key": self.schema.get("memory_scope_key"),
            "memory_hits_count": int(self.schema.get("memory_hits_count") or 0),
            "memory_last_update_seq": int(self.schema.get("memory_last_update_seq") or 0),
            "can_resume": self.status in {SimulationStatus.PAUSED.value, SimulationStatus.ERROR.value},
            "pending_clarification": (
                {
                    "question_id": pending_question.question_id,
                    "question": pending_question.prompt,
                    "options": [{"id": option or f"opt_{index + 1}", "label": option} for index, option in enumerate(pending_question.options)],
                    "reason_tag": pending_question.field_name,
                    "reason_summary": pending_question.reason,
                    "supporting_snippets": [pending_question.reason] if pending_question.reason else [],
                    "created_at": self.updated_at,
                    "required": True,
                }
                if pending_question is not None
                else None
            ),
            "can_answer_clarification": pending_question is not None,
            "pending_research_review": (
                {
                    "cycle_id": str(self.rollback_target or SimulationPhase.INTERNET_RESEARCH.value),
                    "query_plan": [str(item.query or "").strip() for item in (self.research.query_plan if self.research else []) if str(item.query or "").strip()],
                    "candidate_urls": [
                        {
                            "id": f"candidate_{index + 1}",
                            "url": evidence.url,
                            "domain": evidence.domain,
                            "title": evidence.title,
                            "snippet": evidence.snippet,
                        }
                        for index, evidence in enumerate((self.research.evidence if self.research else [])[:6])
                        if str(evidence.url or "").strip()
                    ],
                    "quality_snapshot": dict((self.research.quality if self.research else {}) or {}),
                    "gap_summary": " | ".join((self.research.gaps if self.research else [])[:3]) if self.research else None,
                    "suggested_queries": [
                        str(item.get("text") if isinstance(item, dict) else item).strip()
                        for item in (self.schema.get("search_query_variants") or [])
                        if str(item.get("text") if isinstance(item, dict) else item).strip()
                    ],
                    "required": True,
                }
                if self.pending_input_kind == "research_review"
                else None
            ),
            "pending_input": self.pending_input,
            "pending_input_kind": self.pending_input_kind,
            "rollback_target": self.rollback_target,
            "last_change_impact": self.last_change_impact,
            "error": self.error,
            "coach_intervention": build_coach_payload(active_coach, index=len(coach_entries) - 1) if active_coach is not None else None,
            "coach_history": [
                {
                    "intervention_id": str(item.get("intervention_id") or f"coach-{index + 1}").strip(),
                    "blocker_tag": str(item.get("tag") or "").strip(),
                    "blocker_summary": str(item.get("user_message") or item.get("message") or "").strip(),
                    "resolution": str(item.get("resolution") or "").strip() or None,
                    "resolved_at": int(item.get("resolved_at") or 0) or None,
                }
                for index, item in enumerate(coach_entries)
            ],
            "idea_context_type": self.idea_context_type,
            "persona_set": dict(self.persona_set or {}),
            "persona_generation": dict(self.persona_generation_debug or {}),
            "persona_validation_errors": list(self.persona_validation_errors),
            "persona_source": {
                "mode": pipeline_status.get("persona_source_mode"),
                "resolved": bool(pipeline_status.get("persona_source_mode")),
                "auto_selected": bool(pipeline_status.get("persona_source_auto_selected")),
                "notice": self.persona_source_notice,
                "selected_set_key": str(self.user_context.get("personaSetKey") or "").strip() or None,
                "selected_set_label": str(self.user_context.get("personaSetLabel") or "").strip() or None,
                "options": self.persona_source_options(),
            },
            "pipeline": {
                "ready_for_simulation": bool(pipeline_status.get("ready_for_simulation")),
                "blockers": list(pipeline_status.get("blockers") or []),
                "blocker_details": list(pipeline_status.get("blocker_details") or []),
                "blocked_phase": pipeline_status.get("blocked_phase"),
                "actively_blocked": bool(pipeline_status.get("actively_blocked")),
                "warnings": list(pipeline_status.get("warnings") or []),
                "fatal_errors": list(pipeline_status.get("fatal_errors") or []),
                "steps": [
                    {
                        "key": key,
                        "label": dict((self.pipeline_steps.get(key) or {}).get("label") or PIPELINE_STEP_LABELS.get(key) or {}),
                        "status": str((self.pipeline_steps.get(key) or {}).get("status") or "pending"),
                        "detail": (self.pipeline_steps.get(key) or {}).get("detail"),
                        "started_at": (self.pipeline_steps.get(key) or {}).get("started_at"),
                        "completed_at": (self.pipeline_steps.get(key) or {}).get("completed_at"),
                    }
                    for key in PIPELINE_STEP_ORDER
                ],
            },
        }


def _hydrate_research(raw: Optional[Dict[str, Any]]) -> Optional[ResearchReport]:
    if not isinstance(raw, dict):
        return None
    return ResearchReport(
        query_plan=[
            ResearchQuery(query=str(item.get("query") or ""), reason=str(item.get("reason") or ""))
            for item in raw.get("query_plan") or []
            if isinstance(item, dict)
        ],
        evidence=[
            EvidenceItem(
                query=str(item.get("query") or ""),
                title=str(item.get("title") or ""),
                url=str(item.get("url") or ""),
                domain=str(item.get("domain") or ""),
                snippet=str(item.get("snippet") or ""),
                content=str(item.get("content") or ""),
                relevance_score=float(item.get("relevance_score") or 0.0),
                http_status=int(item.get("http_status")) if item.get("http_status") is not None else None,
            )
            for item in raw.get("evidence") or []
            if isinstance(item, dict)
        ],
        summary=str(raw.get("summary") or ""),
        findings=[str(item) for item in raw.get("findings") or [] if str(item).strip()],
        gaps=[str(item) for item in raw.get("gaps") or [] if str(item).strip()],
        quality=dict(raw.get("quality") or {}),
        structured_schema=dict(raw.get("structured_schema") or {}),
    )


def hydrate_state(raw: Dict[str, Any]) -> OrchestrationState:
    state = OrchestrationState(
        simulation_id=str(raw.get("simulation_id") or ""),
        user_id=raw.get("user_id"),
        user_context=normalize_context(raw.get("user_context")),
        status=str(raw.get("status") or SimulationStatus.RUNNING.value),
        status_reason=str(raw.get("status_reason") or SimulationStatus.RUNNING.value),
        current_phase=SimulationPhase(str(raw.get("current_phase") or SimulationPhase.IDEA_INTAKE.value)),
        completed_phases=[str(item) for item in raw.get("completed_phases") or [] if str(item).strip()],
        phase_details=dict(raw.get("phase_details") or {}),
        schema=dict(raw.get("schema") or {}),
        research=_hydrate_research(raw.get("research")),
        clarification_answers=dict(raw.get("clarification_answers") or {}),
        argument_bank=[dict(item) for item in raw.get("argument_bank") or [] if isinstance(item, dict)],
        critical_insights=[dict(item) for item in raw.get("critical_insights") or [] if isinstance(item, dict)],
        deliberation_state=dict(raw.get("deliberation_state") or {}),
        metrics=dict(raw.get("metrics") or {}),
        summary=str(raw.get("summary") or ""),
        summary_ready=bool(raw.get("summary_ready")),
        rollback_target=str(raw.get("rollback_target") or "") or None,
        last_change_impact=str(raw.get("last_change_impact") or "") or None,
        pending_input=bool(raw.get("pending_input")),
        pending_input_kind=str(raw.get("pending_input_kind") or "") or None,
        pending_resume_phase=str(raw.get("pending_resume_phase") or "") or None,
        error=str(raw.get("error") or "") or None,
        event_seq=int(raw.get("event_seq") or 0),
        created_at=int(raw.get("created_at") or now_ms()),
        updated_at=int(raw.get("updated_at") or now_ms()),
        idea_context_type=str(raw.get("idea_context_type") or "") or None,
        persona_source_mode=str(raw.get("persona_source_mode") or "") or None,
        persona_source_auto_selected=bool(raw.get("persona_source_auto_selected")),
        persona_source_notice=str(raw.get("persona_source_notice") or "") or None,
        persona_set=dict(raw.get("persona_set") or {}),
        persona_generation_debug=dict(raw.get("persona_generation_debug") or {}),
        persona_validation_errors=[str(item) for item in raw.get("persona_validation_errors") or [] if str(item).strip()],
        pipeline_steps=dict(raw.get("pipeline_steps") or build_default_pipeline_steps()),
        search_completed=bool(raw.get("search_completed")),
        persona_generation_completed=bool(raw.get("persona_generation_completed")),
        persona_persistence_completed=bool(raw.get("persona_persistence_completed")),
        simulation_ready=bool(raw.get("simulation_ready")),
    )
    state.personas = [
        apply_persona_dynamic_defaults(PersonaProfile(
            persona_id=str(item.get("persona_id") or item.get("agent_id") or ""),
            name=str(item.get("display_name") or item.get("name") or ""),
            source_mode=str(item.get("source_mode") or ""),
            target_audience_cluster=str(item.get("target_audience_cluster") or ""),
            segment_id=str(item.get("segment_id") or item.get("cluster_id") or item.get("target_audience_cluster") or ""),
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
            speaking_style=str(item.get("speaking_style") or ""),
            tags=[str(value) for value in item.get("tags") or [] if str(value).strip()],
            source_attribution=dict(item.get("source_attribution") or {}),
            evidence_signals=[str(value) for value in item.get("evidence_signals") or [] if str(value).strip()],
            category_id=str(item.get("category_id") or ""),
            template_id=str(item.get("template_id") or ""),
            archetype_name=str(item.get("archetype_name") or item.get("name") or ""),
            summary=str(item.get("summary") or ""),
            motivations=[str(value) for value in item.get("motivations") or item.get("probable_motivations") or [] if str(value).strip()],
            concerns=[str(value) for value in item.get("concerns") or item.get("main_concerns") or [] if str(value).strip()],
            location=str(item.get("location") or ""),
            price_sensitivity_bucket=str(item.get("price_sensitivity_bucket") or item.get("priceSensitivityBucket") or "medium"),
            decision_style=str(item.get("decision_style") or item.get("decisionStyle") or ""),
            purchase_trigger=str(item.get("purchase_trigger") or item.get("purchaseTrigger") or ""),
            rejection_trigger=str(item.get("rejection_trigger") or item.get("rejectionTrigger") or ""),
            opinion=str(item.get("opinion") or item.get("current_opinion") or "neutral"),
            confidence=float(item.get("confidence") or 0.5),
            influence_weight=float(item.get("influence_weight") or 1.0),
            traits=dict(item.get("traits") or {}),
            biases=[str(value) for value in item.get("biases") or [] if str(value).strip()],
            opinion_score=float(item.get("opinion_score") or 0.0),
        ))
        for item in raw.get("personas") or []
        if isinstance(item, dict)
    ]
    state.clarification_questions = [
        ClarificationQuestion(
            question_id=str(item.get("question_id") or ""),
            field_name=str(item.get("field_name") or ""),
            prompt=str(item.get("prompt") or ""),
            reason=str(item.get("reason") or ""),
            required=bool(item.get("required", True)),
            options=[str(value) for value in item.get("options") or [] if str(value).strip()],
        )
        for item in raw.get("clarification_questions") or []
        if isinstance(item, dict)
    ]
    state.dialogue_turns = [
        DialogueTurn(
            step_uid=str(item.get("step_uid") or ""),
            iteration=int(item.get("iteration") or 0),
            phase=str(item.get("phase") or ""),
            agent_id=str(item.get("agent_id") or ""),
            agent_name=str(item.get("agent_name") or item.get("agent_label") or ""),
            reply_to_agent_id=str(item.get("reply_to_agent_id") or "") or None,
            reply_to_agent_name=str(item.get("reply_to_agent_name") or "") or None,
            message=str(item.get("message") or ""),
            stance_before=str(item.get("stance_before") or "neutral"),
            stance_after=str(item.get("stance_after") or "neutral"),
            confidence=float(item.get("confidence") or item.get("stance_confidence") or 0.5),
            influence_delta=float(item.get("influence_delta") or item.get("relevance_score") or 0.0),
            evidence_urls=[str(value) for value in item.get("evidence_urls") or item.get("evidence_keys") or [] if str(value).strip()],
            reason_tag=str(item.get("reason_tag") or "debate"),
            message_type=str(item.get("message_type") or "argument"),
            argument_id=str(item.get("argument_id") or "") or None,
            insight_tag=str(item.get("insight_tag") or "") or None,
            question_asked=str(item.get("question_asked") or "") or None,
        )
        for item in raw.get("dialogue_turns") or []
        if isinstance(item, dict)
    ]
    for key in PIPELINE_STEP_ORDER:
        state.pipeline_steps.setdefault(
            key,
            {
                "key": key,
                "label": dict(PIPELINE_STEP_LABELS.get(key) or {}),
                "status": "pending",
            },
        )
    state.reconcile_runtime_contracts()
    return state
