from __future__ import annotations

import json
import re
import uuid
from typing import Any, Dict, List, Optional, Tuple

from ..core.ollama_client import generate_ollama


AXES: List[str] = [
    "value_proposition",
    "target_segment",
    "pricing_or_monetization",
    "delivery_model",
    "risk_boundary",
]

AXIS_LABELS: Dict[str, Dict[str, str]] = {
    "value_proposition": {"ar": "القيمة الأساسية", "en": "Value proposition"},
    "target_segment": {"ar": "الشريحة المستهدفة", "en": "Target segment"},
    "pricing_or_monetization": {"ar": "التسعير/الإيراد", "en": "Pricing/monetization"},
    "delivery_model": {"ar": "نموذج التنفيذ", "en": "Delivery model"},
    "risk_boundary": {"ar": "حدود المخاطر", "en": "Risk boundary"},
}

GENERIC_QUESTION_MARKERS = {
    "clarify",
    "please clarify",
    "need more details",
    "for you",
    "more details",
    "more clarification",
    "محتاج توضيح",
    "محتاج تفاصيل",
    "وضّح أكثر",
    "وضح أكثر",
    "عايز تفاصيل",
}

GENERIC_OPTIONS = {
    "option 1",
    "option 2",
    "option 3",
    "اختيار 1",
    "اختيار 2",
    "اختيار 3",
}

# Normalized Arabic labels/markers to avoid mojibake leakage in runtime text.
AXIS_LABELS.update(
    {
        "value_proposition": {"ar": "القيمة الأساسية", "en": "Value proposition"},
        "target_segment": {"ar": "الشريحة المستهدفة", "en": "Target segment"},
        "pricing_or_monetization": {"ar": "التسعير/الإيراد", "en": "Pricing/monetization"},
        "delivery_model": {"ar": "نموذج التنفيذ", "en": "Delivery model"},
        "risk_boundary": {"ar": "حدود المخاطر", "en": "Risk boundary"},
    }
)
GENERIC_QUESTION_MARKERS.update(
    {
        "محتاج توضيح",
        "محتاج تفاصيل",
        "وضح أكثر",
        "وضّح أكثر",
        "عايز تفاصيل",
    }
)
GENERIC_OPTIONS.update({"اختيار 1", "اختيار 2", "اختيار 3"})


def _looks_mojibake(text: str) -> bool:
    raw = str(text or "")
    if not raw:
        return False
    return bool(re.search(r"ط[^\u0600-\u06FF\s]|ظ[^\u0600-\u06FF\s]|[ÃÂØÙ]", raw))


def _fallback_question_clean(axis: str, language: str, idea: str, reason_summary: str) -> Dict[str, Any]:
    is_ar = language == "ar"
    idea_label = _clip(idea or ("الفكرة الحالية" if is_ar else "the current idea"), 90)
    templates: Dict[str, Dict[str, Any]] = {
        "value_proposition": {
            "question_ar": f"في فكرة \"{idea_label}\"، ما القيمة التي نلتزم بها أولاً قبل التنفيذ؟",
            "question_en": f"For \"{idea_label}\", what value do we commit to first before execution?",
            "options_ar": [
                "توفير تكلفة مباشرة قابلة للقياس",
                "رفع جودة/دقة واضحة للمستخدم",
                "تقليل المخاطر والامتثال أولاً",
            ],
            "options_en": [
                "Measurable direct cost savings",
                "Clear quality/accuracy uplift",
                "Risk and compliance reduction first",
            ],
        },
        "target_segment": {
            "question_ar": f"لفكرة \"{idea_label}\"، من الشريحة الأولى التي سنبدأ بها؟",
            "question_en": f"For \"{idea_label}\", who is the first segment to target?",
            "options_ar": [
                "شركات صغيرة/متوسطة في Pilot محدود",
                "مستخدمون أفراد في مدينة واحدة أولاً",
                "شركاء مؤسسيون بعقود تجريبية",
            ],
            "options_en": [
                "SMBs in a limited pilot",
                "Consumers in one city first",
                "Enterprise partners via pilot contracts",
            ],
        },
        "pricing_or_monetization": {
            "question_ar": f"ما نموذج الإيراد الأنسب كبداية لفكرة \"{idea_label}\"؟",
            "question_en": f"What is the best initial monetization model for \"{idea_label}\"?",
            "options_ar": ["اشتراك شهري ثابت", "الدفع حسب الاستخدام", "Pilot مدفوع ثم عقد سنوي"],
            "options_en": ["Fixed monthly subscription", "Usage-based pricing", "Paid pilot then annual contract"],
        },
        "delivery_model": {
            "question_ar": f"كيف سننفذ \"{idea_label}\" عملياً في النسخة الأولى؟",
            "question_en": f"How should \"{idea_label}\" be delivered in v1?",
            "options_ar": ["منصة SaaS سحابية", "خدمة مُدارة مع تشغيل جزئي", "إطلاق هجين بتكامل محدود"],
            "options_en": ["Cloud SaaS", "Managed service with partial ops", "Hybrid rollout with limited integration"],
        },
        "risk_boundary": {
            "question_ar": f"قبل تشغيل \"{idea_label}\"، ما حد المخاطر غير القابل للتجاوز؟",
            "question_en": f"Before starting \"{idea_label}\", what risk boundary is non-negotiable?",
            "options_ar": [
                "منع استخدام البيانات الحساسة بالكامل",
                "استخدام محدود بموافقة صريحة وتدقيق دوري",
                "Pilot مغلق مع مراجعة بشرية للقرارات الحرجة",
            ],
            "options_en": [
                "No sensitive data usage at all",
                "Limited use with explicit consent and recurring audits",
                "Closed pilot with human oversight for critical decisions",
            ],
        },
    }
    template = templates.get(axis) or templates["value_proposition"]
    options_seed = template["options_ar"] if is_ar else template["options_en"]
    return {
        "axis": axis,
        "question": template["question_ar"] if is_ar else template["question_en"],
        "options": [{"id": f"opt_{idx + 1}", "label": str(label)} for idx, label in enumerate(options_seed[:3])],
        "reason_summary": reason_summary,
    }


def _summary_clean(language: str, axis_answers: Dict[str, str], missing_axes: List[str]) -> str:
    is_ar = language == "ar"
    lines = ["ملخص التوضيح قبل التنفيذ:" if is_ar else "Preflight clarification summary:"]
    for axis in AXES:
        label = AXIS_LABELS.get(axis, {}).get(language, axis)
        answer = str(axis_answers.get(axis) or "").strip()
        if answer:
            lines.append(f"- {label}: {answer}")
    if missing_axes:
        missing_labels = [AXIS_LABELS.get(axis, {}).get(language, axis) for axis in missing_axes]
        suffix = " (افتراضات مبدئية)" if is_ar else " (default assumptions)"
        lines.append(f"- {', '.join(missing_labels)}{suffix}")
    return "\n".join(lines)


def _preferred_idea_description_clean(language: str, context: Dict[str, Any], axis_answers: Dict[str, str]) -> str:
    is_ar = language == "ar"
    idea = str(context.get("idea") or "").strip() or ("الفكرة غير موضحة" if is_ar else "Idea is not fully specified")
    category = str(context.get("category") or "").strip() or ("غير محدد" if is_ar else "unspecified")
    audience = ", ".join([str(x).strip() for x in (context.get("target_audience") or []) if str(x).strip()])
    audience = audience or ("غير محدد" if is_ar else "unspecified")
    value = str(axis_answers.get("value_proposition") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")
    pricing = str(axis_answers.get("pricing_or_monetization") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")
    delivery = str(axis_answers.get("delivery_model") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")
    risk = str(axis_answers.get("risk_boundary") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")
    if is_ar:
        text = (
            f"الوصف المقترح للفكرة: {idea}. "
            f"الفئة: {category}. "
            f"الشريحة الأولى: {audience}. "
            f"القيمة الأساسية: {value}. "
            f"نموذج الإيراد: {pricing}. "
            f"طريقة التنفيذ: {delivery}. "
            f"حدود المخاطر: {risk}."
        )
    else:
        text = (
            f"Proposed idea description: {idea}. "
            f"Category: {category}. "
            f"First segment: {audience}. "
            f"Core value: {value}. "
            f"Monetization: {pricing}. "
            f"Delivery model: {delivery}. "
            f"Risk boundary: {risk}."
        )
    return _clip(text, 700)


def _norm(text: str) -> str:
    return " ".join(str(text or "").strip().lower().split())


def _clip(text: str, limit: int) -> str:
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 3)].rstrip() + "..."


def _extract_terms(text: str, limit: int = 20) -> List[str]:
    words = re.findall(r"[A-Za-z]{4,}|[\u0600-\u06FF]{4,}", str(text or ""))
    out: List[str] = []
    seen = set()
    for word in words:
        key = word.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(key)
        if len(out) >= limit:
            break
    return out


def _parse_json_object(raw: str) -> Dict[str, Any]:
    text = str(raw or "").strip()
    if not text:
        return {}

    candidates = [text]
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        candidates.append(fenced.group(1))
    direct = re.search(r"(\{.*\})", text, re.DOTALL)
    if direct:
        candidates.append(direct.group(1))

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed
    return {}


def _normalize_context(draft_context: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "idea": str(draft_context.get("idea") or "").strip(),
        "country": str(draft_context.get("country") or "").strip(),
        "city": str(draft_context.get("city") or "").strip(),
        "category": str(draft_context.get("category") or "").strip(),
        "target_audience": [str(x).strip() for x in (draft_context.get("target_audience") or []) if str(x).strip()],
        "goals": [str(x).strip() for x in (draft_context.get("goals") or []) if str(x).strip()],
        "idea_maturity": str(draft_context.get("idea_maturity") or "").strip(),
        "risk_appetite": draft_context.get("risk_appetite"),
        "preflight_axis_answers": dict(draft_context.get("preflight_axis_answers") or {}),
    }


def _extract_history(history: Any) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    rows: List[Dict[str, Any]] = []
    axis_answers: Dict[str, str] = {}
    if not isinstance(history, list):
        return rows, axis_answers

    for item in history:
        if not isinstance(item, dict):
            continue
        axis = str(item.get("axis") or "").strip()
        question_id = str(item.get("question_id") or item.get("questionId") or "").strip()
        answer = str(
            item.get("applied_answer")
            or item.get("custom_text")
            or item.get("customText")
            or item.get("selected_option_label")
            or item.get("selectedOptionLabel")
            or item.get("answer")
            or ""
        ).strip()
        row = {
            "question_id": question_id,
            "axis": axis,
            "question": str(item.get("question") or "").strip(),
            "answer": answer,
            "options": item.get("options") if isinstance(item.get("options"), list) else [],
        }
        if row["question_id"] or row["axis"] or row["question"]:
            rows.append(row)
        if axis in AXES and answer:
            axis_answers[axis] = answer
    return rows, axis_answers


def _option_label_by_id(options: Any, selected_id: str) -> str:
    if not selected_id or not isinstance(options, list):
        return ""
    for option in options:
        if not isinstance(option, dict):
            continue
        option_id = str(option.get("id") or "").strip()
        if option_id != selected_id:
            continue
        return str(option.get("label") or option.get("text") or option.get("value") or "").strip()
    return ""


def _resolve_answer_text(answer: Dict[str, Any], history_rows: List[Dict[str, Any]]) -> Tuple[str, Optional[Dict[str, Any]]]:
    custom = str(answer.get("custom_text") or "").strip()
    question_id = str(answer.get("question_id") or "").strip()
    selected = str(answer.get("selected_option_id") or "").strip()

    target: Optional[Dict[str, Any]] = None
    if question_id:
        for row in reversed(history_rows):
            if str(row.get("question_id") or "").strip() == question_id:
                target = row
                break
    if target is None and history_rows:
        target = history_rows[-1]

    if custom:
        return custom, target

    selected_label = _option_label_by_id((target or {}).get("options"), selected)
    if selected_label:
        return selected_label, target
    return "", target


def _find_missing_axes(ctx: Dict[str, Any], axis_answers: Dict[str, str]) -> List[str]:
    missing: List[str] = []
    idea = str(ctx.get("idea") or "").strip()
    audience = ctx.get("target_audience") if isinstance(ctx.get("target_audience"), list) else []
    goals = ctx.get("goals") if isinstance(ctx.get("goals"), list) else []

    if not idea:
        missing.append("value_proposition")
    elif not (axis_answers.get("value_proposition") or goals):
        missing.append("value_proposition")
    if not (axis_answers.get("target_segment") or audience):
        missing.append("target_segment")
    if not axis_answers.get("pricing_or_monetization"):
        missing.append("pricing_or_monetization")
    if not axis_answers.get("delivery_model"):
        missing.append("delivery_model")
    if not axis_answers.get("risk_boundary"):
        missing.append("risk_boundary")

    return [axis for axis in AXES if axis in missing]


def _clarity_score(axis_answers: Dict[str, str], missing_axes: List[str]) -> float:
    coverage = (len(AXES) - len(missing_axes)) / max(1, len(AXES))
    quality_bonus = 0.0
    for axis in AXES:
        answer = str(axis_answers.get(axis) or "").strip()
        if len(answer) >= 14:
            quality_bonus += 0.02
    score = min(1.0, max(0.0, coverage + min(0.10, quality_bonus)))
    return round(score, 3)


def _is_actionable_option(label: str) -> bool:
    text = _norm(label)
    if not text:
        return False
    if text in GENERIC_OPTIONS:
        return False
    if len(text) < 8:
        return False
    if len(text.split()) < 2:
        return False
    return True


def _fallback_question(axis: str, language: str, idea: str, reason_summary: str) -> Dict[str, Any]:
    is_ar = language == "ar"
    idea_label = _clip(idea or ("الفكرة الحالية" if is_ar else "the current idea"), 90)

    templates: Dict[str, Dict[str, Any]] = {
        "value_proposition": {
            "question_ar": f"في فكرة \"{idea_label}\"، ما القيمة التي نلتزم بها أولاً قبل التنفيذ؟",
            "question_en": f"For \"{idea_label}\", what value do we commit to first before execution?",
            "options_ar": [
                "توفير تكلفة مباشرة قابلة للقياس",
                "رفع جودة الخدمة للمستخدم النهائي",
                "تقليل المخاطر والامتثال قبل أي توسع",
            ],
            "options_en": [
                "Measurable direct cost savings",
                "Clear end-user quality improvement",
                "Risk and compliance reduction before scaling",
            ],
        },
        "target_segment": {
            "question_ar": f"لفكرة \"{idea_label}\"، من الشريحة الأولى التي سنبدأ بها؟",
            "question_en": f"For \"{idea_label}\", who is the first segment to target?",
            "options_ar": [
                "شركات متوسطة B2B بعقود تجريبية",
                "مستخدمون أفراد داخل مدينة واحدة أولاً",
                "جهات مؤسسية محددة مع Pilot مغلق",
            ],
            "options_en": [
                "Mid-size B2B companies via pilots",
                "Consumers in one city first",
                "Named enterprise partners in a closed pilot",
            ],
        },
        "pricing_or_monetization": {
            "question_ar": f"ما نموذج الإيراد الأنسب كبداية لفكرة \"{idea_label}\"؟",
            "question_en": f"What is the best initial monetization model for \"{idea_label}\"?",
            "options_ar": [
                "اشتراك شهري ثابت",
                "الدفع حسب الاستخدام",
                "Pilot مدفوع ثم عقود سنوية",
            ],
            "options_en": [
                "Fixed monthly subscription",
                "Usage-based pricing",
                "Paid pilot then annual contracts",
            ],
        },
        "delivery_model": {
            "question_ar": f"كيف سننفذ \"{idea_label}\" عملياً في النسخة الأولى؟",
            "question_en": f"How should \"{idea_label}\" be delivered in v1?",
            "options_ar": [
                "منصة SaaS سحابية بالكامل",
                "خدمة مُدارة مع إعداد وتشغيل مبدئي",
                "إطلاق هجين بتكامل محدود أولاً",
            ],
            "options_en": [
                "Fully cloud SaaS",
                "Managed service with onboarding",
                "Hybrid rollout with limited integration first",
            ],
        },
        "risk_boundary": {
            "question_ar": f"قبل تشغيل \"{idea_label}\"، ما حد المخاطر غير القابل للتجاوز؟",
            "question_en": f"Before starting \"{idea_label}\", what risk boundary is non-negotiable?",
            "options_ar": [
                "منع استخدام أي بيانات حساسة تماماً",
                "استخدام محدود مع موافقة صريحة وتدقيق دوري",
                "Pilot مغلق مع مراجعة بشرية كاملة لكل قرار حرج",
            ],
            "options_en": [
                "No sensitive data usage at all",
                "Limited use with explicit consent and periodic audits",
                "Closed pilot with full human oversight for critical decisions",
            ],
        },
    }

    template = templates.get(axis) or templates["value_proposition"]
    question = template["question_ar"] if is_ar else template["question_en"]
    options_seed = template["options_ar"] if is_ar else template["options_en"]
    options = [{"id": f"opt_{idx + 1}", "label": str(label)} for idx, label in enumerate(options_seed[:3])]
    return {
        "axis": axis,
        "question": question,
        "options": options,
        "reason_summary": reason_summary,
    }


def _fallback_question(axis: str, language: str, idea: str, reason_summary: str) -> Dict[str, Any]:
    # Keep backward compatibility for any external/internal callers.
    return _fallback_question_clean(axis, language, idea, reason_summary)


def _question_quality(question: str, options: List[Dict[str, str]], axis: str, anchor_source: str) -> Tuple[float, List[str]]:
    checks: Dict[str, bool] = {}
    q_norm = _norm(question)
    labels = [str(item.get("label") or "").strip() for item in options]
    combined = f"{question}\n" + "\n".join(labels)
    anchors = _extract_terms(anchor_source)

    checks["axis_present"] = axis in AXES
    checks["idea_anchor"] = any(anchor in _norm(combined) for anchor in anchors[:10]) if anchors else bool(anchor_source.strip())
    checks["three_options"] = len(options) == 3
    checks["options_unique"] = len({_norm(label) for label in labels if label}) == 3
    checks["actionable_options"] = all(_is_actionable_option(label) for label in labels)
    checks["non_generic_question"] = (
        bool(q_norm)
        and q_norm not in GENERIC_OPTIONS
        and not any(marker in q_norm for marker in GENERIC_QUESTION_MARKERS)
    )

    passed = [key for key, ok in checks.items() if ok]
    score = round((len(passed) / max(1, len(checks))) * 100, 1)
    return score, passed


async def _llm_question(
    *,
    axis: str,
    language: str,
    idea: str,
    context: Dict[str, Any],
    axis_answers: Dict[str, str],
) -> Dict[str, Any]:
    language_label = "Arabic" if language == "ar" else "English"
    reason_summary = (
        "نحتاج قراراً واضحاً في هذا المحور قبل بدء التنفيذ."
        if language == "ar"
        else "One concrete decision on this axis is required before execution."
    )

    prompt = (
        "Generate one pre-execution clarification question.\n"
        "Return JSON only with keys: question, options, reason_summary.\n"
        "Rules:\n"
        "- The question must be tied to the idea context.\n"
        "- It must target only the given decision axis.\n"
        "- options must be exactly 3 mutually exclusive actionable choices.\n"
        "- No placeholders, no generic wording.\n"
        f"Language: {language_label}\n"
        f"Idea: {_clip(idea, 240)}\n"
        f"Axis: {axis}\n"
        f"Known answers: {json.dumps(axis_answers, ensure_ascii=False)}\n"
        f"Context: {json.dumps(context, ensure_ascii=False)}\n"
    )

    raw = await generate_ollama(prompt=prompt, temperature=0.2, response_format="json")
    parsed = _parse_json_object(raw)
    question = str(parsed.get("question") or "").strip()

    options: List[Dict[str, str]] = []
    for item in (parsed.get("options") or []):
        label = ""
        if isinstance(item, str):
            label = item.strip()
        elif isinstance(item, dict):
            label = str(item.get("label") or item.get("text") or item.get("value") or "").strip()
        if not label:
            continue
        key = _norm(label)
        if key in {_norm(opt.get("label") or "") for opt in options}:
            continue
        options.append({"id": f"opt_{len(options) + 1}", "label": _clip(label, 220)})
        if len(options) >= 3:
            break

    return {
        "axis": axis,
        "question": question,
        "options": options,
        "reason_summary": str(parsed.get("reason_summary") or reason_summary).strip() or reason_summary,
    }


async def generate_axis_question(
    *,
    axis: str,
    language: str,
    context: Dict[str, Any],
    axis_answers: Dict[str, str],
) -> Dict[str, Any]:
    reason_summary = (
        "لا يمكن البدء قبل حسم هذا المحور."
        if language == "ar"
        else "Execution is blocked until this decision axis is clarified."
    )
    generation_mode = "llm"
    try:
        generated = await _llm_question(
            axis=axis,
            language=language,
            idea=str(context.get("idea") or ""),
            context=context,
            axis_answers=axis_answers,
        )
    except Exception:
        generated = _fallback_question_clean(axis, language, str(context.get("idea") or ""), reason_summary)
        generation_mode = "fallback"

    question = str(generated.get("question") or "").strip()
    options = [item for item in (generated.get("options") or []) if isinstance(item, dict)]
    if len(options) < 3:
        generated = _fallback_question_clean(axis, language, str(context.get("idea") or ""), reason_summary)
        question = str(generated.get("question") or "").strip()
        options = [item for item in (generated.get("options") or []) if isinstance(item, dict)]
        generation_mode = "fallback"

    quality_score, checks_passed = _question_quality(
        question=question,
        options=options[:3],
        axis=axis,
        anchor_source=f"{context.get('idea', '')} {context.get('category', '')} {' '.join(context.get('goals') or [])}",
    )

    if quality_score < 70:
        generated = _fallback_question_clean(axis, language, str(context.get("idea") or ""), reason_summary)
        question = str(generated.get("question") or "").strip()
        options = [item for item in (generated.get("options") or []) if isinstance(item, dict)]
        quality_score, checks_passed = _question_quality(
            question=question,
            options=options[:3],
            axis=axis,
            anchor_source=f"{context.get('idea', '')} {context.get('category', '')} {' '.join(context.get('goals') or [])}",
        )
        generation_mode = "fallback"

    options_payload = [
        {
            "id": str(option.get("id") or f"opt_{idx + 1}"),
            "label": str(option.get("label") or "").strip(),
        }
        for idx, option in enumerate(options[:3])
    ]
    normalized_reason = str(generated.get("reason_summary") or reason_summary).strip() or reason_summary
    if language == "ar" and _looks_mojibake(normalized_reason):
        normalized_reason = reason_summary

    return {
        "axis": axis,
        "question": question,
        "options": options_payload,
        "reason_summary": normalized_reason,
        "question_quality": {
            "score": quality_score,
            "checks_passed": checks_passed,
        },
        "generation_mode": generation_mode,
    }


def _summary(language: str, axis_answers: Dict[str, str], missing_axes: List[str]) -> str:
    is_ar = language == "ar"
    lines = ["ملخص التوضيح قبل التنفيذ:" if is_ar else "Preflight clarification summary:"]
    for axis in AXES:
        label = AXIS_LABELS.get(axis, {}).get(language, axis)
        answer = str(axis_answers.get(axis) or "").strip()
        if answer:
            lines.append(f"- {label}: {answer}")
    if missing_axes:
        missing_labels = [AXIS_LABELS.get(axis, {}).get(language, axis) for axis in missing_axes]
        suffix = " (افتراضات مبدئية)" if is_ar else " (default assumptions)"
        lines.append(f"- {', '.join(missing_labels)}{suffix}")
    return "\n".join(lines)


def _preferred_idea_description(language: str, context: Dict[str, Any], axis_answers: Dict[str, str]) -> str:
    is_ar = language == "ar"
    idea = str(context.get("idea") or "").strip() or ("الفكرة غير موضحة" if is_ar else "Idea is not fully specified")
    category = str(context.get("category") or "").strip() or ("غير محدد" if is_ar else "unspecified")
    audience = ", ".join([str(x).strip() for x in (context.get("target_audience") or []) if str(x).strip()])
    audience = audience or ("غير محدد" if is_ar else "unspecified")

    value = str(axis_answers.get("value_proposition") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")
    pricing = str(axis_answers.get("pricing_or_monetization") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")
    delivery = str(axis_answers.get("delivery_model") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")
    risk = str(axis_answers.get("risk_boundary") or "").strip() or ("لم يُحسم بعد" if is_ar else "not finalized yet")

    if is_ar:
        text = (
            f"الوصف المقترح للفكرة: {idea}. "
            f"الفئة: {category}. "
            f"الشريحة الأولى: {audience}. "
            f"القيمة الأساسية: {value}. "
            f"نموذج الإيراد: {pricing}. "
            f"طريقة التنفيذ: {delivery}. "
            f"حدود المخاطر: {risk}."
        )
    else:
        text = (
            f"Proposed idea description: {idea}. "
            f"Category: {category}. "
            f"First segment: {audience}. "
            f"Core value: {value}. "
            f"Monetization: {pricing}. "
            f"Delivery model: {delivery}. "
            f"Risk boundary: {risk}."
        )
    return _clip(text, 700)


def _summary(language: str, axis_answers: Dict[str, str], missing_axes: List[str]) -> str:
    return _summary_clean(language, axis_answers, missing_axes)


def _preferred_idea_description(language: str, context: Dict[str, Any], axis_answers: Dict[str, str]) -> str:
    return _preferred_idea_description_clean(language, context, axis_answers)


async def preflight_next(
    *,
    draft_context: Dict[str, Any],
    history: Optional[List[Dict[str, Any]]],
    answer: Optional[Dict[str, Any]],
    language: str,
    max_rounds: int = 3,
    threshold: float = 0.78,
) -> Dict[str, Any]:
    language = "ar" if str(language or "en").lower().startswith("ar") else "en"
    max_rounds = max(1, min(5, int(max_rounds or 3)))
    threshold = max(0.50, min(0.95, float(threshold)))

    context = _normalize_context(draft_context)
    history_rows, axis_answers = _extract_history(history or [])

    seeded_answers = context.get("preflight_axis_answers")
    if isinstance(seeded_answers, dict):
        for axis, value in seeded_answers.items():
            if axis in AXES and str(value or "").strip():
                axis_answers[axis] = str(value).strip()

    if answer:
        answer_text, target = _resolve_answer_text(answer, history_rows)
        axis = str((target or {}).get("axis") or "").strip()
        if axis in AXES and answer_text:
            axis_answers[axis] = answer_text
            if target is not None:
                target["answer"] = answer_text

    round_count = len([row for row in history_rows if str(row.get("axis") or "").strip()])
    missing_axes = _find_missing_axes(context, axis_answers)
    score = _clarity_score(axis_answers, missing_axes)
    ready = bool(score >= threshold or not missing_axes)
    capped = round_count >= max_rounds

    context["preflight_axis_answers"] = dict(axis_answers)

    if ready or capped:
        assumptions = [f"{AXIS_LABELS.get(axis, {}).get(language, axis)}: assumed" for axis in missing_axes]
        return {
            "ready": True,
            "clarity_score": score,
            "round": min(max_rounds, max(1, round_count)),
            "max_rounds": max_rounds,
            "missing_axes": missing_axes,
            "question": None,
            "normalized_context": context,
            "preflight_summary": _summary_clean(language, axis_answers, missing_axes),
            "assumptions": assumptions,
            "preferred_idea_description": _preferred_idea_description_clean(language, context, axis_answers),
            "history": history_rows,
        }

    axis = missing_axes[0]
    generated = await generate_axis_question(
        axis=axis,
        language=language,
        context=context,
        axis_answers=axis_answers,
    )
    question = str(generated.get("question") or "").strip()
    options = [item for item in (generated.get("options") or []) if isinstance(item, dict)]
    question_quality = generated.get("question_quality") if isinstance(generated.get("question_quality"), dict) else {}
    quality_score = float(question_quality.get("score") or 0.0)
    checks_passed = question_quality.get("checks_passed") if isinstance(question_quality.get("checks_passed"), list) else []

    question_id = uuid.uuid4().hex[:12]
    options_payload = []
    for idx, option in enumerate(options[:3]):
        options_payload.append(
            {
                "id": str(option.get("id") or f"opt_{idx + 1}"),
                "label": str(option.get("label") or "").strip(),
            }
        )

    question_payload = {
        "question_id": question_id,
        "axis": axis,
        "question": question,
        "options": options_payload,
        "reason_summary": str(generated.get("reason_summary") or "").strip(),
        "required": True,
        "generation_mode": str(generated.get("generation_mode") or "fallback"),
        "question_quality": {
            "score": quality_score,
            "checks_passed": checks_passed,
        },
    }

    history_rows.append(
        {
            "question_id": question_id,
            "axis": axis,
            "question": question,
            "answer": "",
            "options": options_payload,
        }
    )

    return {
        "ready": False,
        "clarity_score": score,
        "round": min(max_rounds, round_count + 1),
        "max_rounds": max_rounds,
        "missing_axes": missing_axes,
        "question": question_payload,
        "normalized_context": context,
        "history": history_rows,
    }


def preflight_finalize(
    *,
    normalized_context: Dict[str, Any],
    history: Optional[List[Dict[str, Any]]],
    language: str,
    threshold: float = 0.78,
) -> Dict[str, Any]:
    language = "ar" if str(language or "en").lower().startswith("ar") else "en"
    threshold = max(0.50, min(0.95, float(threshold)))

    context = _normalize_context(normalized_context)
    history_rows, axis_answers = _extract_history(history or [])
    seeded_answers = context.get("preflight_axis_answers")
    if isinstance(seeded_answers, dict):
        for axis, value in seeded_answers.items():
            if axis in AXES and str(value or "").strip():
                axis_answers[axis] = str(value).strip()

    missing_axes = _find_missing_axes(context, axis_answers)
    score = _clarity_score(axis_answers, missing_axes)
    assumptions = [f"{AXIS_LABELS.get(axis, {}).get(language, axis)}: assumed" for axis in missing_axes]
    context["preflight_axis_answers"] = dict(axis_answers)

    return {
        "preflight_ready": bool(score >= threshold or not missing_axes),
        "preflight_summary": _summary_clean(language, axis_answers, missing_axes),
        "preferred_idea_description": _preferred_idea_description_clean(language, context, axis_answers),
        "preflight_answers": dict(axis_answers),
        "preflight_clarity_score": score,
        "assumptions": assumptions,
        "missing_axes": missing_axes,
        "history": history_rows,
        "normalized_context": context,
    }
