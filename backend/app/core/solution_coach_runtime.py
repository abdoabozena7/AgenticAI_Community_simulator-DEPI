from __future__ import annotations

import re
import uuid
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple


COACH_PAUSE_STATUS_REASON = "paused_coach_intervention"
STRATEGIC_BLOCKER_TAGS = {
    "competitive_parity",
    "unclear_value",
    "unclear_target",
    "market_demand",
    "feasibility_scalability",
    "evidence_gap",
}
COACH_ACTIONS = {
    "apply_suggestion",
    "request_more_ideas",
    "continue_without_change",
    "custom_fix",
}
COMPETITIVE_PARITY_KEYWORDS = [
    "same as competitors",
    "same as existing",
    "no differentiation",
    "not differentiated",
    "why buy from you",
    "why choose you",
    "not unique",
    "commodity",
    "generic offer",
    "مفيش حاجة بتميز",
    "مفيش تميز",
    "ليه اشتري منك",
    "ليه أشتري منك",
    "ليه مش من المطعم",
    "زي الموجود",
    "زي المنافسين",
    "بدون تميز",
    "بدون تمييز",
    "ميزة فريدة",
]
_BLOCKER_DECISION_AXES = {
    "competitive_parity": "differentiation",
    "unclear_value": "value_proposition",
    "unclear_target": "target_segment",
    "market_demand": "demand_validation",
    "feasibility_scalability": "delivery_scope",
    "evidence_gap": "evidence_priority",
}
_RERUN_STAGE_BY_KIND = {
    "target_segment": "schema_intake",
    "core_offer": "schema_intake",
    "value_proposition": "schema_intake",
    "pricing_hypothesis": "schema_intake",
    "positioning": "idea_research",
    "differentiation": "idea_research",
    "validation_plan": "idea_research",
    "competition_response": "idea_research",
    "place": "location_research",
    "location_scope": "location_research",
    "persona_framing": "persona_synthesis",
}


def normalize_language(value: Any) -> str:
    return "ar" if str(value or "en").strip().lower().startswith("ar") else "en"


def _copy(language: str, ar: str, en: str) -> str:
    return ar if normalize_language(language) == "ar" else en


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _compact_text(value: Any, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:limit].strip()


def classify_blocker_tag(reason_tag: Any, message: Any = "") -> Optional[str]:
    compact_reason = str(reason_tag or "").strip().lower()
    if compact_reason in STRATEGIC_BLOCKER_TAGS:
        return compact_reason

    message_text = _normalize_text(message)
    if not message_text:
        return None
    if any(keyword in message_text for keyword in COMPETITIVE_PARITY_KEYWORDS):
        return "competitive_parity"
    if (
        ("منافس" in message_text or "بديل" in message_text or "مطعم" in message_text)
        and any(keyword in message_text for keyword in ["تميز", "تمييز", "ميزة", "فريد", "يشتري", "يختار"])
    ):
        return "competitive_parity"
    if any(keyword in message_text for keyword in ["القيمة غير واضحة", "الفائدة غير واضحة", "value proposition", "unclear value"]):
        return "unclear_value"
    if any(keyword in message_text for keyword in ["الجمهور غير واضح", "الشريحة غير واضحة", "target audience", "which customer"]):
        return "unclear_target"
    if any(keyword in message_text for keyword in ["الطلب ضعيف", "حجم السوق", "market demand", "willingness to pay"]):
        return "market_demand"
    if any(keyword in message_text for keyword in ["تشغيلي", "التوسع", "تكاليف التشغيل", "operational", "scale", "sla"]):
        return "feasibility_scalability"
    if any(keyword in message_text for keyword in ["دليل", "إثبات", "proof", "evidence", "بيانات فعلية"]):
        return "evidence_gap"
    return None


def decision_axis_for_blocker(blocker_tag: str) -> str:
    return _BLOCKER_DECISION_AXES.get(str(blocker_tag or "").strip().lower(), "evidence_priority")


def rerun_stage_for_kind(kind: Any) -> str:
    return _RERUN_STAGE_BY_KIND.get(str(kind or "").strip().lower(), "idea_research")


def _first_audience(user_context: Dict[str, Any], language: str) -> str:
    raw = user_context.get("targetAudience")
    if not isinstance(raw, list):
        raw = user_context.get("target_audience")
    values = [str(item or "").strip() for item in (raw if isinstance(raw, list) else []) if str(item or "").strip()]
    return values[0] if values else _copy(language, "شريحة أولى محددة", "a focused first segment")


def _place_label(user_context: Dict[str, Any], language: str) -> str:
    city = str(user_context.get("city") or "").strip()
    country = str(user_context.get("country") or "").strip()
    parts = [part for part in [city, country] if part]
    return ", ".join(parts) if parts else _copy(language, "منطقة الإطلاق الأولى", "the first launch area")


def _idea_label(user_context: Dict[str, Any], language: str) -> str:
    idea = _compact_text(user_context.get("idea"), 160)
    return idea or _copy(language, "هذه الفكرة", "this idea")


def _append_idea_focus(base_idea: str, addition: str) -> str:
    compact_base = _compact_text(base_idea, 220)
    compact_addition = _compact_text(addition, 160)
    if not compact_base:
        return compact_addition
    if not compact_addition or compact_addition.lower() in compact_base.lower():
        return compact_base
    separator = " - " if compact_base.endswith((".", "!", "?")) else ". "
    return f"{compact_base}{separator}{compact_addition}"


def build_blocker_summary(blocker_tag: str, idea: str, language: str) -> str:
    compact_idea = _compact_text(idea, 90) or _idea_label({"idea": idea}, language)
    summaries = {
        "competitive_parity": _copy(language, f"الوكلاء شايفين أن {compact_idea} قريب جدًا من البدائل الموجودة، ولسه ما فيش سبب قوي يخلي العميل يختاره أولًا.", f"Agents see {compact_idea} as too close to existing alternatives, with no strong first reason to choose it."),
        "unclear_value": _copy(language, f"الوعد الأساسي في {compact_idea} ما زال ضبابيًا، لذلك النقاش متعطل حول أول فائدة تستحق الشراء.", f"The core promise in {compact_idea} is still fuzzy, so agents cannot lock onto the first benefit worth paying for."),
        "unclear_target": _copy(language, f"{compact_idea} ما زالت بلا شريحة أولى محددة بما يكفي، لذلك الاعتراضات تتكرر حول من سيحتاجها أولًا.", f"{compact_idea} still lacks a sharp first segment, so objections keep circling around who needs it first."),
        "market_demand": _copy(language, f"الوكلاء غير مقتنعين بأن الطلب على {compact_idea} مثبت بما يكفي مقارنة بالمنافسة وتكلفة الدخول.", f"Agents doubt that demand for {compact_idea} is proven strongly enough relative to competition and go-to-market cost."),
        "feasibility_scalability": _copy(language, f"شكل التنفيذ الحالي لـ {compact_idea} أثقل من قدرة النسخة الأولى، لذلك المخاطر التشغيلية تعطل القبول.", f"The current execution model for {compact_idea} looks heavier than a v1 can support, so operational risk is blocking acceptance."),
        "evidence_gap": _copy(language, f"ما زالت هناك فجوة واضحة في الأدلة حول {compact_idea}، لذلك الوكلاء عالقون في غياب الإثبات بدل الحسم.", f"There is still a visible proof gap around {compact_idea}, so agents stay stuck on missing evidence instead of committing."),
    }
    return summaries.get(blocker_tag, summaries["evidence_gap"])


def _base_patch(user_context: Dict[str, Any]) -> Dict[str, Any]:
    patch: Dict[str, Any] = {}
    for key in ("idea", "category", "city", "country"):
        value = _compact_text(user_context.get(key), 220 if key == "idea" else 80)
        if value:
            patch[key] = value
    audience = user_context.get("targetAudience")
    if not isinstance(audience, list):
        audience = user_context.get("target_audience")
    if isinstance(audience, list):
        cleaned = [str(item or "").strip() for item in audience if str(item or "").strip()]
        if cleaned:
            patch["targetAudience"] = cleaned[:3]
    return patch


def extract_research_evidence(user_context: Dict[str, Any], limit: int = 3) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []

    def push(label: str, quote: str, source_url: Optional[str] = None, source_domain: Optional[str] = None) -> None:
        compact_quote = _compact_text(quote, 220)
        if not compact_quote:
            return
        evidence.append({
            "id": f"research:{len(evidence) + 1}",
            "source": "research",
            "label": _compact_text(label, 80) or "Research signal",
            "quote": compact_quote,
            "source_url": _compact_text(source_url, 240) or None,
            "source_domain": _compact_text(source_domain, 80) or None,
        })

    summary = _compact_text(user_context.get("research_summary"), 260)
    if summary:
        push("Research summary", summary)

    structured = user_context.get("research_structured") if isinstance(user_context.get("research_structured"), dict) else {}
    for card in structured.get("evidence_cards") if isinstance(structured.get("evidence_cards"), list) else []:
        push("Evidence card", str(card))
        if len(evidence) >= limit:
            return evidence[:limit]

    sources = user_context.get("research_sources")
    if not isinstance(sources, list):
        sources = structured.get("sources") if isinstance(structured.get("sources"), list) else []
    for item in sources:
        if not isinstance(item, dict):
            continue
        push(
            str(item.get("title") or item.get("domain") or "Source"),
            str(item.get("snippet") or item.get("title") or ""),
            source_url=str(item.get("url") or ""),
            source_domain=str(item.get("domain") or ""),
        )
        if len(evidence) >= limit:
            return evidence[:limit]

    return evidence[:limit]


def build_agent_citations(reasoning_items: Sequence[Dict[str, Any]], blocker_tag: str, limit: int = 3) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    seen_messages: Set[str] = set()
    for item in list(reasoning_items)[-12:]:
        if not isinstance(item, dict):
            continue
        candidate_tag = classify_blocker_tag(item.get("reason_tag"), item.get("message"))
        if candidate_tag != blocker_tag:
            continue
        agent_id = str(item.get("agent_id") or "").strip()
        message = _compact_text(item.get("message"), 240)
        if not agent_id or not message or message in seen_messages:
            continue
        seen_messages.add(message)
        step_uid = str(item.get("step_uid") or "").strip() or None
        event_seq = item.get("event_seq")
        message_id = f"r-{step_uid}" if step_uid else (f"r-{event_seq}" if isinstance(event_seq, int) else f"r-{uuid.uuid4().hex[:8]}")
        citations.append({
            "id": f"agent:{len(citations) + 1}",
            "source": "agent",
            "message_id": message_id,
            "step_uid": step_uid,
            "event_seq": int(event_seq) if isinstance(event_seq, int) else None,
            "agent_id": agent_id,
            "agent_label": _compact_text(item.get("agent_label"), 60) or _compact_text(item.get("agent_short_id"), 12) or agent_id[:4],
            "quote": message,
            "reason_tag": candidate_tag,
        })
        if len(citations) >= limit:
            break
    return citations


def _selected_evidence_ref_ids(agent_citations: Sequence[Dict[str, Any]], research_evidence: Sequence[Dict[str, Any]]) -> List[str]:
    refs: List[str] = []
    if agent_citations:
        refs.append(str(agent_citations[0].get("id") or "agent:1"))
    if research_evidence:
        refs.append(str(research_evidence[0].get("id") or "research:1"))
    return refs


def _verify_suggestion(suggestion: Dict[str, Any], agent_citations: Sequence[Dict[str, Any]], research_evidence: Sequence[Dict[str, Any]]) -> bool:
    if not isinstance(suggestion.get("context_patch"), dict) or not suggestion.get("context_patch"):
        return False
    refs = suggestion.get("evidence_ref_ids")
    if not isinstance(refs, list) or not refs:
        return False
    ref_set = {str(item or "").strip() for item in refs if str(item or "").strip()}
    if not ref_set:
        return False
    available_refs = {
        str(item.get("id") or "").strip()
        for item in list(agent_citations) + list(research_evidence)
        if isinstance(item, dict)
    }
    return bool(ref_set & available_refs)


def _suggestion_templates(user_context: Dict[str, Any], blocker_tag: str, language: str) -> List[Dict[str, Any]]:
    base_patch = _base_patch(user_context)
    segment = _first_audience(user_context, language)
    place = _place_label(user_context, language)
    idea = _idea_label(user_context, language)

    def patch(idea_focus: str, *, target_audience: Optional[List[str]] = None, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        next_patch = dict(base_patch)
        next_patch["idea"] = _append_idea_focus(str(base_patch.get("idea") or idea), idea_focus)
        if target_audience:
            next_patch["targetAudience"] = target_audience
        if extra:
            next_patch.update(extra)
        return next_patch

    common = {
        "competitive_parity": [
            ("target_segment", _copy(language, "اقفل أول شريحة بوضوح", "Lock a sharper first segment"), _copy(language, "ابدأ مع مشتري أول محدد بدل جمهور واسع.", "Start with one first buyer, not a broad market."), _copy(language, "هذا يقلل المقارنة العامة مع كل السوق.", "This reduces vague comparison against the whole market."), _copy(language, "السوق الأول سيصغر لكنه يصبح أسهل للفوز.", "Your first market gets smaller, but easier to win."), patch(_copy(language, f"ابدأ أولًا مع {segment} في {place} بوعد قابل للقياس.", f"Start first with {segment} in {place}, with one measurable promise."), target_audience=[segment]), 240),
            ("differentiation", _copy(language, "أضف سبب شراء محدد", "Add a concrete reason to choose you"), _copy(language, "اربط الفكرة بنتيجة عملية لا يقدمها البديل بنفس الوضوح.", "Tie the offer to one outcome the incumbent does not promise as clearly."), _copy(language, "الاعتراض الحالي ضد التشابه لا ضد السوق نفسه.", "The live objection is lack of differentiation."), _copy(language, "الرسالة ستصبح أضيق لكنها أقوى.", "The initial message becomes narrower."), patch(_copy(language, "اجعل الفرق الرئيسي نتيجة عملية واحدة لا يقدمها البديل بنفس الوضوح.", "Make the main difference one operational outcome the current alternative does not promise as clearly.")), 360),
            ("core_offer", _copy(language, "حوّلها إلى عرض واحد واضح", "Turn the idea into one clear offer"), _copy(language, "اجعل النسخة الأولى عرضًا واحدًا سهل الفهم والشراء.", "Shape v1 as one easy-to-buy offer."), _copy(language, "العرض الواحد يقلل التشويش.", "A single offer reduces drift and confusion."), _copy(language, "بعض المزايا الثانوية ستتأجل.", "Secondary features move later."), patch(_copy(language, "احصر النسخة الأولى في عرض رئيسي واحد يمكن شرحه في جملة واحدة.", "Limit v1 to one signature offer that fits in a single sentence.")), 300),
            ("pricing_hypothesis", _copy(language, "اختبر منطق السعر أو الباقة", "Test a price or package logic"), _copy(language, "اربط العرض الأول بنتيجة واضحة أو Pilot مدفوع.", "Use a starter package or paid pilot instead of assuming willingness to pay."), _copy(language, "السعر جزء من سبب التحول من البديل الحالي.", "Price is part of the switching story."), _copy(language, "قد تحتاج Pilot أصغر للاختبار.", "You may need a smaller pilot."), patch(_copy(language, "اختبر باقة أولى أو Pilot مدفوعًا مرتبطًا بنتيجة واضحة.", "Test a starter package or paid pilot tied to a visible first outcome.")), 420),
            ("competition_response", _copy(language, "جاوب على المنافس مباشرة", "Answer the competitor directly"), _copy(language, "سمِّ البديل الحالي واشرح لماذا سيبدل العميل.", "Name the current alternative and why a customer would switch."), _copy(language, "الوكلاء يفكرون من زاوية المنافس الآن.", "Agents are framing the objection from a competitor lens."), _copy(language, "الخطاب سيصبح أكثر صراحة ضد البديل.", "The narrative becomes more explicit against incumbents."), patch(_copy(language, "وضّح البديل الحالي الذي تريد انتزاعه ولماذا ستفوز عليه في حالة استخدام محددة.", "Name the current alternative and the use case where you should win against it.")), 420),
        ],
        "unclear_value": [
            ("value_proposition", _copy(language, "اقفل وعد القيمة الأول", "Lock the first value promise"), _copy(language, "اختر فائدة واحدة فقط يجب إثباتها أولًا.", "Pick one benefit that must be proven first."), _copy(language, "الفائدة الأولى الواضحة تجعل القرار أسهل.", "One primary benefit sharpens the decision."), _copy(language, "الرسالة التسويقية ستضيق في البداية.", "The launch message becomes narrower."), patch(_copy(language, "حدّد الفائدة الأولى التي يجب أن يشعر بها العميل خلال أول استخدام.", "Define the first benefit the customer should feel during earliest use.")), 240),
            ("target_segment", _copy(language, "اربط القيمة بالشريحة الصحيحة", "Tie value to the right segment"), _copy(language, "اختر من يشعر بالألم أكثر من غيره.", "Choose the segment that feels the pain most often."), _copy(language, "القيمة تصبح أوضح عندما ترتبط بألم متكرر.", "Value gets clearer when attached to repeated pain."), _copy(language, "قد تنتظر الشرائح الثانوية.", "Secondary segments may need to wait."), patch(_copy(language, f"ركز أولًا على {segment} لأن القيمة أوضح لهم.", f"Focus first on {segment} because the value is more immediate there."), target_audience=[segment]), 300),
            ("positioning", _copy(language, "اشرح لماذا الآن", "Explain why now"), _copy(language, "أضف سببًا زمنيًا أو تشغيليًا للتبني الآن.", "Add a trigger that makes adoption urgent now."), _copy(language, "القيمة تبدو اختيارية عندما يغيب محفز التوقيت.", "Agents need a reason the value is timely, not optional."), _copy(language, "المشكلة ستحتاج صياغة أصرح.", "The problem statement becomes more explicit."), patch(_copy(language, "أضف سببًا زمنيًا أو تشغيليًا يجعل تبني الحل منطقيًا الآن.", "Add a timing or trigger that makes adoption rational now, not someday.")), 300),
            ("validation_plan", _copy(language, "أثبت القيمة في سيناريو واحد", "Prove value in one scenario"), _copy(language, "حوّل الوعد إلى حالة استخدام قابلة للقياس.", "Use one measurable before/after use case."), _copy(language, "الحالة القابلة للقياس تجعل القيمة ملموسة.", "A measurable scenario makes the value concrete."), _copy(language, "لن تغطي كل الاستخدامات من البداية.", "You will not cover every use case in v1."), patch(_copy(language, "عرّف حالة استخدام واحدة تقيس الفرق بين قبل وبعد الاستخدام.", "Define one use case that makes the before/after value measurable.")), 360),
            ("core_offer", _copy(language, "حوّل القيمة إلى عرض", "Turn the promise into an offer"), _copy(language, "اجعل الوعد قابلًا للشراء لا مجرد فكرة عامة.", "Make the value easy to buy, not just easy to describe."), _copy(language, "العرض الواضح يقلل الغموض بين الفكرة والمنتج.", "A concrete offer reduces confusion."), _copy(language, "بعض المزايا ستنتظر.", "Some extra features will need to wait."), patch(_copy(language, "صغ النسخة الأولى كعرض واضح ومحدود بدل مجموعة وعود واسعة.", "Shape v1 as one concrete offer instead of a wide list of benefits.")), 300),
        ],
    }
    if blocker_tag in common:
        return common[blocker_tag]
    return common["unclear_value"]


def build_solution_suggestions(
    *,
    user_context: Dict[str, Any],
    blocker_tag: str,
    language: str,
    agent_citations: Sequence[Dict[str, Any]],
    research_evidence: Sequence[Dict[str, Any]],
    exclude_titles: Optional[Set[str]] = None,
    count: int = 5,
) -> List[Dict[str, Any]]:
    selected_refs = _selected_evidence_ref_ids(agent_citations, research_evidence)
    exclude_titles = {str(item or "").strip().lower() for item in (exclude_titles or set()) if str(item or "").strip()}
    suggestions: List[Dict[str, Any]] = []
    for index, raw in enumerate(_suggestion_templates(user_context, blocker_tag, language), start=1):
        title = _compact_text(raw[1], 90)
        if not title or title.lower() in exclude_titles:
            title = _copy(language, f"بديل {index}: {raw[1]}", f"Alternative {index}: {raw[1]}")
        suggestion = {
            "suggestion_id": uuid.uuid4().hex[:12],
            "kind": str(raw[0]),
            "title": _compact_text(title, 90),
            "one_liner": _compact_text(raw[2], 180),
            "rationale": _compact_text(raw[3], 280),
            "tradeoff": _compact_text(raw[4], 220),
            "cta_label": _copy(language, "اعتمد وأعد التشغيل", "Apply and rerun"),
            "evidence_ref_ids": list(selected_refs),
            "context_patch": raw[5] if isinstance(raw[5], dict) else {},
            "rerun_from_stage": rerun_stage_for_kind(raw[0]),
            "estimated_eta_delta_seconds": int(raw[6] or 300),
        }
        if _verify_suggestion(suggestion, agent_citations, research_evidence):
            suggestions.append(suggestion)
        if len(suggestions) >= max(1, int(count or 5)):
            break
    return suggestions


def build_runtime_coach_intervention(
    *,
    simulation_id: str,
    user_context: Dict[str, Any],
    reasoning_window: Sequence[Dict[str, Any]],
    phase_key: Optional[str],
    previous_history: Optional[Sequence[Dict[str, Any]]] = None,
    blocked_tags: Optional[Set[str]] = None,
    exclude_titles: Optional[Set[str]] = None,
) -> Optional[Dict[str, Any]]:
    window_items = [item for item in list(reasoning_window or [])[-12:] if isinstance(item, dict) and str(item.get("message") or "").strip()]
    if len(window_items) < 2:
        return None

    strategic_items: List[Tuple[str, Dict[str, Any]]] = []
    for item in window_items:
        blocker_tag = classify_blocker_tag(item.get("reason_tag"), item.get("message"))
        if blocker_tag not in STRATEGIC_BLOCKER_TAGS:
            continue
        strategic_items.append((blocker_tag, item))
    if len(strategic_items) < 2:
        return None

    tag_counts: Dict[str, int] = {}
    unique_agents_by_tag: Dict[str, Set[str]] = {}
    for blocker_tag, item in strategic_items:
        tag_counts[blocker_tag] = tag_counts.get(blocker_tag, 0) + 1
        unique_agents_by_tag.setdefault(blocker_tag, set()).add(str(item.get("agent_id") or ""))

    top_tag = max(tag_counts.keys(), key=lambda key: (tag_counts[key], len(unique_agents_by_tag.get(key) or set())))
    if blocked_tags and top_tag in blocked_tags:
        return None
    unique_agents = {agent_id for agent_id in unique_agents_by_tag.get(top_tag, set()) if agent_id}
    if tag_counts.get(top_tag, 0) < 2 or len(unique_agents) < 2:
        return None

    research_evidence = extract_research_evidence(user_context, limit=3)
    agent_citations = build_agent_citations([item for _, item in strategic_items], top_tag, limit=3)
    if not research_evidence or not agent_citations:
        return None

    language = normalize_language(user_context.get("language"))
    suggestions = build_solution_suggestions(
        user_context=user_context,
        blocker_tag=top_tag,
        language=language,
        agent_citations=agent_citations,
        research_evidence=research_evidence,
        exclude_titles=exclude_titles,
        count=5,
    )
    if len(suggestions) < 5:
        return None

    return {
        "intervention_id": uuid.uuid4().hex,
        "simulation_id": simulation_id,
        "blocker_tag": top_tag,
        "blocker_summary": build_blocker_summary(top_tag, _idea_label(user_context, language), language),
        "severity": "high" if tag_counts.get(top_tag, 0) >= 3 or len(unique_agents) >= 3 else "medium",
        "decision_axis": decision_axis_for_blocker(top_tag),
        "should_pause": True,
        "ui_state": "options_ready",
        "guide_message": _copy(language, "أوقفت المحاكاة لأن الوكلاء converged على اعتراض مهم. جهزت لك 5 تعديلات grounded يمكنك اعتماد أحدها ثم إعادة التشغيل.", "Simulation paused because agents converged on a material blocker. I prepared 5 grounded fixes you can apply before rerunning."),
        "phase_key": str(phase_key or "").strip() or None,
        "agent_citations": agent_citations,
        "research_evidence": research_evidence,
        "suggestions": suggestions,
        "patch_preview": None,
        "continue_blocked": False,
        "created_at": None,
        "history": [item for item in (previous_history or []) if isinstance(item, dict)] + [
            {"type": "coach_detected", "label": "Observed objection"},
            {"type": "coach_options_ready", "label": "5 fixes ready"},
        ],
    }


def neutralize_custom_fix(text: str, user_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user_context = user_context or {}
    language = normalize_language(user_context.get("language"))
    raw_text = _compact_text(text, 400)
    normalized = re.sub(r"\s+", " ", raw_text)
    updates: Dict[str, Any] = {}
    notes: List[str] = []
    filtered = False

    patterns = {
        "city": r"(?:city\s*(?:is|=|:)\s*|المدينة\s*(?:هي|=|:)\s*)([^,;\n]+)",
        "country": r"(?:country\s*(?:is|=|:)\s*|الدولة\s*(?:هي|=|:)\s*)([^,;\n]+)",
        "category": r"(?:category\s*(?:is|=|:)\s*|الفئة\s*(?:هي|=|:)\s*)([^,;\n]+)",
        "idea": r"(?:idea\s*(?:is|=|:)\s*|الفكرة\s*(?:هي|=|:)\s*)(.+)",
    }
    for field, pattern in patterns.items():
        match = re.search(pattern, normalized, re.IGNORECASE)
        if match:
            updates[field] = _compact_text(match.group(1), 220 if field == "idea" else 80)
    audience_match = re.search(r"(?:target audience\s*(?:is|=|:)\s*|الجمهور المستهدف\s*(?:هو|=|:)\s*)([^,;\n]+)", normalized, re.IGNORECASE)
    if audience_match:
        audience = _compact_text(audience_match.group(1), 80)
        if audience:
            updates["targetAudience"] = [audience]

    steering_patterns = [r"\bmake them agree\b", r"\bforce acceptance\b", r"\bignore objections\b", r"\bخليهم يوافقوا\b", r"\bتجاهل الاعتراض\b"]
    if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in steering_patterns):
        filtered = True
        notes.append(_copy(language, "تم تجاهل الجزء الذي يحاول توجيه رأي الوكلاء مباشرة.", "Direct attempts to steer agent opinions were filtered out."))

    if not updates and normalized:
        base_idea = _compact_text(user_context.get("idea"), 180)
        updates["idea"] = _append_idea_focus(base_idea, normalized) if base_idea else normalized
        notes.append(_copy(language, "تم تحويل النص إلى قيد وصفي على صياغة الفكرة.", "The text was converted into a descriptive idea constraint."))
    if updates:
        notes.append(_copy(language, "سيُستخدم هذا التعديل كسياق واقعي فقط وليس كتوجيه لرأي الوكلاء.", "This change will be used as factual context only, not as opinion steering."))

    return {
        "raw_text": raw_text,
        "neutralized_text": normalized,
        "field_updates": updates,
        "notes": notes[:4],
        "steering_filtered": filtered,
        "apply_mode": "factual_update" if updates else "needs_review",
    }


def build_patch_preview(
    *,
    intervention: Dict[str, Any],
    context_patch: Dict[str, Any],
    selected_suggestion_id: Optional[str] = None,
    neutralized_text: Optional[str] = None,
    notes: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    selected_kind = next(
        (str(suggestion.get("kind") or "") for suggestion in (intervention.get("suggestions") if isinstance(intervention.get("suggestions"), list) else []) if str(suggestion.get("suggestion_id") or "") == str(selected_suggestion_id or "")),
        "",
    )
    rerun_from_stage = rerun_stage_for_kind(selected_kind)
    if not selected_kind:
        keys = {str(key) for key in (context_patch or {}).keys()}
        if {"city", "country"} & keys:
            rerun_from_stage = "location_research"
        elif {"targetAudience", "idea", "category"} & keys:
            rerun_from_stage = "schema_intake"
        else:
            rerun_from_stage = "idea_research"

    language = normalize_language(intervention.get("language"))
    eta_delta = next(
        (int(suggestion.get("estimated_eta_delta_seconds") or 300) for suggestion in (intervention.get("suggestions") if isinstance(intervention.get("suggestions"), list) else []) if str(suggestion.get("suggestion_id") or "") == str(selected_suggestion_id or "")),
        300,
    )
    return {
        "context_patch": context_patch,
        "rerun_from_stage": rerun_from_stage,
        "guide_message": _copy(language, "سنطبق هذا التعديل كسياق منظم ثم نعيد البناء من أقل مرحلة لازمة.", "The patch will be applied as structured context, then the run will restart from the lowest required stage."),
        "selected_suggestion_id": selected_suggestion_id,
        "neutralized_text": neutralized_text,
        "notes": list(notes or [])[:4],
        "estimated_eta_delta_seconds": max(int(eta_delta or 300), 120),
    }


def build_post_action_make_acceptable(
    *,
    simulation_id: str,
    user_context: Dict[str, Any],
    reasoning: Sequence[Dict[str, Any]],
) -> Dict[str, Any]:
    language = normalize_language(user_context.get("language"))
    intervention = build_runtime_coach_intervention(
        simulation_id=simulation_id,
        user_context=user_context,
        reasoning_window=reasoning,
        phase_key="post_action",
    )
    if not intervention:
        intervention = {
            "blocker_tag": "unclear_value",
            "blocker_summary": build_blocker_summary("unclear_value", _idea_label(user_context, language), language),
            "suggestions": build_solution_suggestions(
                user_context=user_context,
                blocker_tag="unclear_value",
                language=language,
                agent_citations=[{"id": "agent:1", "quote": _copy(language, "القيمة ما زالت غير واضحة.", "Value is still unclear.")}],
                research_evidence=[{"id": "research:1", "quote": _compact_text(user_context.get("research_summary"), 220) or _copy(language, "البحث ما زال غير حاسم.", "Research is still inconclusive.")}],
            ),
        }
    suggestions = intervention.get("suggestions") if isinstance(intervention.get("suggestions"), list) else []
    revised_idea = _compact_text(((suggestions[0].get("context_patch") or {}).get("idea") if suggestions else user_context.get("idea")), 240) or _idea_label(user_context, language)
    return {
        "action": "make_acceptable",
        "title": _copy(language, "اجعل فكرتك أكثر قابلية للدفاع", "Make your idea more defensible"),
        "summary": intervention.get("blocker_summary") or "",
        "steps": [str(item.get("title") or "").strip() for item in suggestions if str(item.get("title") or "").strip()][:4],
        "risks": [
            _copy(language, "قد يعود ضعف التمييز إذا ظلت الشريحة الأولى واسعة جدًا.", "Weak differentiation can return if the first wedge stays too broad."),
            _copy(language, "ستظل جودة الإثبات منخفضة إذا تغيّر السياق دون خطوة تحقق مركزة.", "Proof quality stays low if the next run changes context without a focused validation step."),
        ],
        "kpis": [
            _copy(language, "معدل تحويل الشريحة الأولى", "First-segment conversion rate"),
            _copy(language, "معدل اكتمال الـPilot", "Pilot completion rate"),
            _copy(language, "معدل الشراء أو الاستخدام المتكرر", "Repeat purchase or repeat usage"),
        ],
        "revised_idea": revised_idea,
        "compliance_fixes": [],
        "blocking_reasons": [str(intervention.get("blocker_tag") or "unclear_value")],
        "followup_seed": {
            "idea": revised_idea,
            "parent_simulation_id": simulation_id,
            "followup_mode": "make_acceptable",
        },
        "coach_suggestions": suggestions,
    }
