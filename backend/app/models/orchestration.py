from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional


def now_ms() -> int:
    return int(time.time() * 1000)


class SimulationPhase(str, Enum):
    IDEA_INTAKE = "idea_intake"
    INTERNET_RESEARCH = "internet_research"
    PERSONA_GENERATION = "persona_generation"
    CLARIFICATION_QUESTIONS = "clarification_questions"
    SIMULATION_INITIALIZATION = "simulation_initialization"
    AGENT_DELIBERATION = "agent_deliberation"
    CONVERGENCE = "convergence"
    SUMMARY = "summary"


PHASE_ORDER: List[SimulationPhase] = [
    SimulationPhase.IDEA_INTAKE,
    SimulationPhase.INTERNET_RESEARCH,
    SimulationPhase.PERSONA_GENERATION,
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


def phase_position(phase: SimulationPhase | str) -> int:
    key = phase if isinstance(phase, SimulationPhase) else SimulationPhase(str(phase))
    return PHASE_ORDER.index(key)


def normalize_context(context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    payload = dict(context or {})
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
    return {
        "idea": str(payload.get("idea") or "").strip(),
        "category": str(payload.get("category") or "").strip().lower(),
        "country": str(payload.get("country") or "").strip(),
        "city": str(payload.get("city") or "").strip(),
        "location": str(payload.get("location") or "").strip(),
        "targetAudience": [str(item).strip() for item in target_audience if str(item).strip()],
        "goals": [str(item).strip() for item in goals if str(item).strip()],
        "riskBoundary": str(payload.get("riskBoundary") or payload.get("risk_boundary") or "").strip(),
        "valueProposition": str(payload.get("valueProposition") or payload.get("value_proposition") or "").strip(),
        "deliveryModel": str(payload.get("deliveryModel") or payload.get("delivery_model") or "").strip(),
        "monetization": str(payload.get("monetization") or payload.get("pricing") or "").strip(),
        "datasetHint": str(payload.get("datasetHint") or payload.get("dataset_hint") or "").strip(),
        "notes": str(payload.get("notes") or "").strip(),
        "agentCount": max(5, min(500, agent_count)),
        "language": "ar" if str(payload.get("language") or "en").lower().startswith("ar") else "en",
    }


def context_location_label(context: Dict[str, Any]) -> str:
    parts = [
        str(context.get("location") or "").strip(),
        str(context.get("city") or "").strip(),
        str(context.get("country") or "").strip(),
    ]
    unique: List[str] = []
    for part in parts:
        if not part or part in unique:
            continue
        unique.append(part)
    return ", ".join(unique)


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
    category_id: str
    template_id: str
    archetype_name: str
    summary: str
    motivations: List[str]
    concerns: List[str]
    location: str
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
            "category_id": self.category_id,
            "template_id": self.template_id,
            "archetype_name": self.archetype_name,
            "summary": self.summary,
            "motivations": list(self.motivations),
            "concerns": list(self.concerns),
            "location": self.location,
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
            "traits": self.traits,
            "biases": self.biases,
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
            "archetype_name": self.archetype_name,
            "category_id": self.category_id,
            "current_opinion": self.opinion,
            "confidence": self.confidence,
            "summary": self.summary,
            "motivations": list(self.motivations),
            "concerns": list(self.concerns),
            "influence_weight": self.influence_weight,
            "traits": dict(self.traits),
            "biases": list(self.biases),
            "opinion_score": self.opinion_score,
            "cluster_id": str(self.traits.get("cluster_id") or ""),
            "dynamic_skepticism": float(self.traits.get("dynamic_skepticism", self.traits.get("skepticism", 0.5))),
            "question_drive": float(self.traits.get("question_drive", 0.45)),
        }


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

    def rollback_to(self, phase: SimulationPhase, reason: str) -> None:
        keep = phase_position(phase)
        self.completed_phases = [item for item in self.completed_phases if phase_position(item) < keep]
        self.current_phase = phase
        self.rollback_target = phase.value
        self.status = SimulationStatus.RUNNING.value
        self.status_reason = "rollback"
        self.pending_input = False
        self.summary = ""
        self.summary_ready = False
        self.error = None
        self.phase_details.setdefault(phase.value, {})
        self.phase_details[phase.value]["rollback_reason"] = reason
        if keep <= phase_position(SimulationPhase.INTERNET_RESEARCH):
            self.research = None
        if keep <= phase_position(SimulationPhase.PERSONA_GENERATION):
            self.personas = []
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
        self.phase_details.setdefault(phase.value, {})
        self.phase_details[phase.value]["continue_reason"] = reason
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
        answered = set(self.clarification_answers.keys())
        return [question for question in self.clarification_questions if question.question_id not in answered]

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
        }

    def to_public_state(self) -> Dict[str, Any]:
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
            "event_seq": self.event_seq,
            "can_resume": self.status in {SimulationStatus.PAUSED.value, SimulationStatus.ERROR.value},
            "pending_clarification": [item.to_dict() for item in self.pending_questions()],
            "pending_input": self.pending_input,
            "pending_input_kind": self.pending_input_kind,
            "rollback_target": self.rollback_target,
            "last_change_impact": self.last_change_impact,
            "error": self.error,
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
    )
    state.personas = [
        PersonaProfile(
            persona_id=str(item.get("persona_id") or item.get("agent_id") or ""),
            name=str(item.get("name") or ""),
            category_id=str(item.get("category_id") or ""),
            template_id=str(item.get("template_id") or ""),
            archetype_name=str(item.get("archetype_name") or item.get("name") or ""),
            summary=str(item.get("summary") or ""),
            motivations=[str(value) for value in item.get("motivations") or [] if str(value).strip()],
            concerns=[str(value) for value in item.get("concerns") or [] if str(value).strip()],
            location=str(item.get("location") or ""),
            opinion=str(item.get("opinion") or item.get("current_opinion") or "neutral"),
            confidence=float(item.get("confidence") or 0.5),
            influence_weight=float(item.get("influence_weight") or 1.0),
            traits=dict(item.get("traits") or {}),
            biases=[str(value) for value in item.get("biases") or [] if str(value).strip()],
            opinion_score=float(item.get("opinion_score") or 0.0),
        )
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
    return state
