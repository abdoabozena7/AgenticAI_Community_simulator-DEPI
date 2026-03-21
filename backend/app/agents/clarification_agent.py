from __future__ import annotations

from typing import List

from ..models.orchestration import ClarificationQuestion, OrchestrationState
from .base import BaseAgent


class ClarificationAgent(BaseAgent):
    name = "clarification_agent"

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        state.validate_pipeline_ready_for_simulation()
        pipeline_status = dict(state.schema.get("pipeline_status") or {})
        active_blockers = [str(item).strip() for item in pipeline_status.get("blockers") or [] if str(item).strip()]
        candidates = [] if active_blockers else self._question_candidates(state)
        questions: List[ClarificationQuestion] = []
        for question in candidates:
            if state.is_field_resolved(question.field_name):
                continue
            if question.question_id in state.clarification_answers:
                continue
            questions.append(question)
            break

        state.clarification_questions = questions
        state.pending_input = bool(questions)
        if questions:
            state.status = "paused"
            state.status_reason = "awaiting_clarification"
            state.pending_input_kind = "clarification"
            state.pending_resume_phase = state.pending_resume_phase or "simulation_initialization"
            state.schema["clarification_fields"] = [item.field_name for item in questions]
            state.set_pipeline_step(
                "ready_for_simulation",
                "blocked",
                detail=questions[0].prompt,
                meta={"blocked_phase": "clarification_questions"},
            )
        else:
            state.schema["clarification_fields"] = []
            if state.pending_input_kind == "clarification":
                state.pending_input_kind = None
        return state

    def _question_candidates(self, state: OrchestrationState) -> List[ClarificationQuestion]:
        language = state.user_context.get("language") or "en"
        gaps = list((state.research.gaps if state.research else []) or [])
        is_ar = str(language).lower().startswith("ar")

        prompts = {
            "valueProposition": (
                "What single outcome should this simulation optimize for first?",
                "ما النتيجة الأساسية التي يجب أن تعطيها الفكرة أولاً؟",
            ),
            "targetAudience": (
                "Which audience must be convinced first for the idea to work?",
                "من أول شريحة يجب إقناعها حتى تنجح الفكرة؟",
            ),
            "monetization": (
                "What is the first monetization model to test?",
                "ما أول نموذج إيراد تريد اختباره؟",
            ),
            "deliveryModel": (
                "How will the first version be delivered in practice?",
                "كيف ستُقدَّم النسخة الأولى عملياً؟",
            ),
            "riskBoundary": (
                "What non-negotiable risk boundary should agents respect?",
                "ما الحد غير القابل للتفاوض في المخاطر؟",
            ),
        }
        reasons = {
            "valueProposition": "Research shows the promise is still too broad.",
            "targetAudience": "Personas need a primary audience to argue from a real position.",
            "monetization": "Research surfaced viability signals but not the revenue path.",
            "deliveryModel": "Execution constraints are unclear without a concrete delivery model.",
            "riskBoundary": "The debate should not proceed without an explicit risk boundary.",
        }

        order = [
            "valueProposition",
            "targetAudience",
            "monetization",
            "deliveryModel",
            "riskBoundary",
        ]
        candidates: List[ClarificationQuestion] = []
        for field_name in order:
            if state.is_field_resolved(field_name):
                continue
            prompt_en, prompt_ar = prompts[field_name]
            reason = reasons[field_name]
            if field_name == "riskBoundary" and any("risk" in gap.lower() for gap in gaps):
                reason = gaps[0]
            if field_name == "monetization" and any("monet" in gap.lower() for gap in gaps):
                reason = next(gap for gap in gaps if "monet" in gap.lower())
            if field_name == "valueProposition" and not any(token in " ".join(gaps).lower() for token in ["promise", "value", "broad", "position"]):
                continue
            if field_name == "targetAudience" and not any(token in " ".join(gaps).lower() for token in ["audience", "segment"]):
                continue
            if field_name == "monetization" and not any(token in " ".join(gaps).lower() for token in ["monet", "revenue", "pricing", "price"]):
                continue
            if field_name == "deliveryModel" and not any(token in " ".join(gaps).lower() for token in ["delivery", "execution", "channel"]):
                continue
            if field_name == "riskBoundary" and not any(token in " ".join(gaps).lower() for token in ["risk", "guard", "boundary"]):
                continue
            candidates.append(
                ClarificationQuestion(
                    question_id=f"clarify_{field_name}",
                    field_name=field_name,
                    prompt=prompt_ar if is_ar else prompt_en,
                    reason=reason,
                )
            )
        return candidates[:1]
