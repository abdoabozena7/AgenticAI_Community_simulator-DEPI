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
    "same as the market",
    "same as existing",
    "no differentiation",
    "not differentiated",
    "why buy from you",
    "why choose you",
    "why not buy from",
    "what makes it different",
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
    "مش مميز",
    "نفس الموجود",
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


def _normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip().lower())


def _compact_text(value: Any, limit: int = 220) -> str:
    text = re.sub(r"\s+", " ", str(value or "").strip())
    return text[:limit].strip()


def is_coach_eligible_reason_tag(reason_tag: Any, message: Any = "") -> bool:
    tag = classify_blocker_tag(reason_tag, message)
    return bool(tag and tag in STRATEGIC_BLOCKER_TAGS)


def classify_blocker_tag(reason_tag: Any, message: Any = "") -> Optional[str]:
    compact_reason = str(reason_tag or "").strip().lower()
    if compact_reason in STRATEGIC_BLOCKER_TAGS:
        return compact_reason
    message_text = _normalize_text(message)
    if not message_text:
        return compact_reason if compact_reason in STRATEGIC_BLOCKER_TAGS else None
    if any(keyword in message_text for keyword in COMPETITIVE_PARITY_KEYWORDS):
        return "competitive_parity"
    strategic_keyword_map = {
        "unclear_value": [
            "unclear value",
            "value proposition",
            "benefit is unclear",
            "problem fit",
            "القيمة غير واضحة",
            "الفائدة غير واضحة",
        ],
        "unclear_target": [
            "target audience",
            "unclear target",
            "which customer",
            "segment is unclear",
            "الجمهور غير واضح",
            "الشريحة غير واضحة",
        ],
        "market_demand": [
            "market demand",
            "lack of demand",
            "price sensitive",
            "pricing issue",
            "too many competitors",
            "الطلب ضعيف",
            "السوق مش واضح",
            "منافسة عالية",
            "تسعير",
        ],
        "feasibility_scalability": [
            "not feasible",
            "hard to scale",
            "operationally heavy",
            "complex to run",
            "difficult to execute",
            "صعب التنفيذ",
            "صعب التوسع",
            "تشغيل معقد",
        ],
        "evidence_gap": [
            "need evidence",
            "missing proof",
            "insufficient data",
            "no evidence",
            "أدلة غير كافية",
            "نحتاج دليل",
            "لا يوجد إثبات",
        ],
    }
    for tag, keywords in strategic_keyword_map.items():
        if any(keyword in message_text for keyword in keywords):
            return tag
    return compact_reason if compact_reason in STRATEGIC_BLOCKER_TAGS else None


def decision_axis_for_blocker(blocker_tag: str) -> str:
    return _BLOCKER_DECISION_AXES.get(str(blocker_tag or "").strip().lower(), "evidence_priority")


def rerun_stage_for_kind(kind: Any) -> str:
    compact = str(kind or "").strip().lower()
    return _RERUN_STAGE_BY_KIND.get(compact, "idea_research")


def build_blocker_summary(blocker_tag: str, idea: str, language: str) -> str:
    compact_idea = _compact_text(idea, 90) or ("this idea" if language == "en" else "هذه الفكرة")
    summaries = {
        "competitive_parity": {
            "ar": f"الوكلاء شايفين أن {compact_idea} قريب جدًا من البدائل الموجودة، والتمييز الحالي غير كافٍ لإقناع أول عميل.",
            "en": f"Agents see {compact_idea} as too close to existing alternatives, with no strong reason to choose it first.",
        },
        "unclear_value": {
            "ar": f"الوعد الأساسي في {compact_idea} ما زال ضبابيًا، لذلك النقاش يتعطل حول الفائدة الأولى التي تستحق الشراء.",
            "en": f"The core promise in {compact_idea} is still fuzzy, so agents cannot lock onto the first benefit worth paying for.",
        },
        "unclear_target": {
            "ar": f"الفكرة {compact_idea} لا تملك شريحة أولى محددة بما يكفي، لذلك الاعتراضات تتكرر حول من سيحتاجها أولًا.",
            "en": f"{compact_idea} still lacks a sharp first segment, so objections keep circling around who needs it first.",
        },
        "market_demand": {
            "ar": f"الوكلاء يشكون أن الطلب على {compact_idea} غير مثبت بشكل كافٍ مقارنة بتكلفة الدخول والمنافسة.",
            "en": f"Agents doubt that demand for {compact_idea} is proven strongly enough relative to competition and go-to-market cost.",
        },
        "feasibility_scalability": {
            "ar": f"التنفيذ الحالي لـ {compact_idea} يبدو أثقل من قدرة النسخة الأولى، لذلك المخاطر التشغيلية تعطل القبول.",
            "en": f"The current execution model for {compact_idea} looks heavier than a v1 can support, so operational risk is blocking acceptance.",
        },
        "evidence_gap": {
            "ar": f"ما زال هناك نقص واضح في الأدلة حول {compact_idea}، لذلك الوكلاء يتوقفون عند غياب الإثبات بدل الحسم.",
            "en": f"There is still a visible proof gap around {compact_idea}, so agents stay stuck on missing evidence instead of committing.",
        },
    }
    return (summaries.get(blocker_tag) or summaries["evidence_gap"]).get(language) or summaries["evidence_gap"]["en"]


def _first_audience(user_context: Dict[str, Any], language: str) -> str:
    raw = user_context.get("targetAudience")
    if not isinstance(raw, list):
        raw = user_context.get("target_audience")
    options = [str(item or "").strip() for item in (raw if isinstance(raw, list) else []) if str(item or "").strip()]
    if options:
        return options[0]
    return "SMBs" if language == "en" else "شريحة محددة"


def _place_label(user_context: Dict[str, Any], language: str) -> str:
    city = str(user_context.get("city") or "").strip()
    country = str(user_context.get("country") or "").strip()
    parts = [part for part in [city, country] if part]
    if parts:
        return ", ".join(parts)
    return "the first launch area" if language == "en" else "منطقة الإطلاق الأولى"


def _idea_label(user_context: Dict[str, Any], language: str) -> str:
    idea = _compact_text(user_context.get("idea"), 160)
    return idea or ("this idea" if language == "en" else "هذه الفكرة")


def _append_idea_focus(base_idea: str, addition: str) -> str:
    compact_base = _compact_text(base_idea, 220)
    compact_addition = _compact_text(addition, 160)
    if not compact_base:
        return compact_addition
    if not compact_addition:
        return compact_base
    if compact_addition.lower() in compact_base.lower():
        return compact_base
    separator = " - " if compact_base.endswith((".", "!", "?")) else ". "
    return f"{compact_base}{separator}{compact_addition}"


def extract_research_evidence(user_context: Dict[str, Any], limit: int = 3) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []

    def push(label: str, quote: str, *, source_url: Optional[str] = None, source_domain: Optional[str] = None) -> None:
        compact_quote = _compact_text(quote, 220)
        if not compact_quote:
            return
        evidence.append(
            {
                "id": f"research:{len(evidence) + 1}",
                "source": "research",
                "label": _compact_text(label, 80) or "Research signal",
                "quote": compact_quote,
                "source_url": _compact_text(source_url, 240) or None,
                "source_domain": _compact_text(source_domain, 80) or None,
            }
        )

    research_summary = _compact_text(user_context.get("research_summary"), 260)
    if research_summary:
        push("Research summary", research_summary)

    structured = user_context.get("research_structured") if isinstance(user_context.get("research_structured"), dict) else {}
    evidence_cards = structured.get("evidence_cards") if isinstance(structured.get("evidence_cards"), list) else []
    for item in evidence_cards:
        push("Evidence card", item)
        if len(evidence) >= limit:
            return evidence[:limit]

    signals = structured.get("signals") if isinstance(structured.get("signals"), list) else []
    for item in signals:
        push("Market signal", item)
        if len(evidence) >= limit:
            return evidence[:limit]

    gaps = structured.get("gaps") if isinstance(structured.get("gaps"), list) else []
    for item in gaps:
        push("Known gap", item)
        if len(evidence) >= limit:
            return evidence[:limit]

    sources = user_context.get("research_sources")
    if not isinstance(sources, list):
        sources = structured.get("sources") if isinstance(structured.get("sources"), list) else []
    for item in sources:
        if not isinstance(item, dict):
            continue
        title = _compact_text(item.get("title"), 80) or _compact_text(item.get("domain"), 60) or "Source"
        quote = _compact_text(item.get("snippet"), 220) or _compact_text(item.get("title"), 220)
        push(title, quote, source_url=item.get("url"), source_domain=item.get("domain"))
        if len(evidence) >= limit:
            return evidence[:limit]

    return evidence[:limit]


def build_agent_citations(reasoning_items: Sequence[Dict[str, Any]], blocker_tag: str, limit: int = 3) -> List[Dict[str, Any]]:
    citations: List[Dict[str, Any]] = []
    seen_messages: Set[str] = set()
    for item in list(reasoning_items)[-10:]:
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
        message_id = f"r-{step_uid}" if step_uid else (f"r-{event_seq}" if event_seq is not None else f"r-{uuid.uuid4().hex[:8]}")
        citations.append(
            {
                "id": f"agent:{len(citations) + 1}",
                "source": "agent",
                "message_id": message_id,
                "step_uid": step_uid,
                "event_seq": int(event_seq) if isinstance(event_seq, int) else None,
                "agent_id": agent_id,
                "agent_label": _compact_text(item.get("agent_label"), 60) or _compact_text(item.get("agent_short_id"), 10) or agent_id[:4],
                "quote": message,
                "reason_tag": candidate_tag,
            }
        )
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


def _base_patch(user_context: Dict[str, Any]) -> Dict[str, Any]:
    patch: Dict[str, Any] = {}
    idea = _compact_text(user_context.get("idea"), 220)
    category = _compact_text(user_context.get("category"), 80)
    city = _compact_text(user_context.get("city"), 80)
    country = _compact_text(user_context.get("country"), 80)
    target_audience = user_context.get("targetAudience")
    if not isinstance(target_audience, list):
        target_audience = user_context.get("target_audience")
    patch["idea"] = idea
    if category:
        patch["category"] = category
    if city:
        patch["city"] = city
    if country:
        patch["country"] = country
    if isinstance(target_audience, list):
        cleaned = [str(item or "").strip() for item in target_audience if str(item or "").strip()]
        if cleaned:
            patch["targetAudience"] = cleaned[:3]
    return patch


def _build_suggestion_catalog(user_context: Dict[str, Any], blocker_tag: str, language: str) -> List[Dict[str, Any]]:
    idea = _idea_label(user_context, language)
    segment = _first_audience(user_context, language)
    place = _place_label(user_context, language)
    base_patch = _base_patch(user_context)

    def patch(idea_focus: str, *, target_audience: Optional[List[str]] = None, extra: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        next_patch = dict(base_patch)
        next_patch["idea"] = _append_idea_focus(str(base_patch.get("idea") or idea), idea_focus)
        if target_audience:
            next_patch["targetAudience"] = target_audience
        if extra:
            next_patch.update(extra)
        return next_patch

    if language == "ar":
        labels = {
            "competitive_parity": [
                ("target_segment", "حدد أول شريحة بوضوح", "ابدأ مع مشتري أول محدد بدل جمهور واسع.", "هذا يخفف مقارنة الفكرة بكل السوق.", "سيصغر السوق الأول لكنه يصبح أوضح.", patch(f"ابدأ أولًا مع {segment} في {place} بوعد واضح قابل للقياس.", target_audience=[segment]), 240),
                ("differentiation", "أضف سبب شراء محدد", "اربط الفكرة بنتيجة عملية لا يقدمها البديل بنفس الوضوح.", "الاعتراض الحالي هو غياب التمييز الحقيقي.", "الرسالة ستصبح أضيق لكنها أقوى.", patch("اجعل التمييز الرئيسي نتيجة عملية واحدة لا يقدمها البديل بنفس الوضوح."), 360),
                ("core_offer", "حوّلها لعرض واحد", "اجعل النسخة الأولى عرضًا واحدًا سهل الفهم والشراء.", "العرض الواحد يقلل التشويش ويقوي القرار.", "ستؤجل مزايا ثانوية لما بعد الإثبات.", patch("احصر النسخة الأولى في عرض رئيسي واحد يمكن شرحه في جملة واحدة."), 300),
                ("pricing_hypothesis", "اختبر منطق سعر أو باقة", "اربط العرض الأول بنتيجة واضحة أو Pilot مدفوع.", "التسعير هنا جزء من سبب التبديل.", "قد تحتاج Pilot أصغر للاختبار.", patch("اختبر باقة أولى أو Pilot مدفوعًا مرتبطًا بنتيجة واضحة."), 420),
                ("validation_plan", "أثبت التمييز في Pilot", "انقل النقاش من الرأي إلى إثبات ميداني محدود.", "هذا يعالج اعتراض التشابه مباشرة.", "سيؤخر التوسع قليلًا.", patch("ابدأ Pilot محدود يختبر لماذا سيختارك العميل بدل البديل الحالي."), 540),
                ("competition_response", "جاوب على المنافس مباشرة", "سمِّ البديل الحالي واشرح لماذا سيبدل العميل.", "الوكلاء يفكرون من منظور المنافس الآن.", "ستحتاج رسالة أوضح ضد البديل.", patch("وضّح البديل الحالي الذي تريد انتزاعه ولماذا ستفوز عليه في حالة استخدام محددة."), 420),
            ],
            "unclear_value": [
                ("value_proposition", "اقفل وعد القيمة الأول", "اختر فائدة واحدة فقط يجب إثباتها أولًا.", "الفائدة الأولى تقود القرار بشكل أوضح.", "الخطاب التسويقي سيضيق في البداية.", patch("حدّد الفائدة الأولى التي يجب أن يشعر بها العميل خلال أول استخدام."), 240),
                ("target_segment", "اربط القيمة بالشريحة الصحيحة", "اختر من يعاني المشكلة أكثر من غيره.", "القيمة تصبح أوضح مع شريحة تشعر بالألم يوميًا.", "قد تؤجل شرائح ثانوية.", patch(f"ركّز أولًا على {segment} لأن الفائدة لهم أوضح.", target_audience=[segment]), 300),
                ("validation_plan", "أثبت القيمة في سيناريو واحد", "اختر حالة استخدام واحدة لقياس الفرق فعليًا.", "القيمة العامة تتحسن عندما تصبح قابلة للقياس.", "لن تغطي كل الاستخدامات من البداية.", patch("عرّف حالة استخدام واحدة تقيس الفرق بين قبل وبعد استخدام الحل."), 360),
                ("positioning", "أضف سببًا زمنيًا للتبني", "اشرح لماذا سيشتري العميل الآن لا لاحقًا.", "التوقيت يوضح لماذا القيمة مهمة فعلًا.", "ستحتاج صياغة أكثر صراحة للمشكلة.", patch("أضف سببًا زمنيًا أو تشغيليًا يجعل تبني الحل منطقيًا الآن."), 300),
                ("core_offer", "حوّل القيمة إلى عرض", "اجعل الوعد قابلاً للشراء لا مجرد فكرة عامة.", "العرض الواضح يقلل الغموض بين الفكرة والمنتج.", "ستلغي مزايا ثانوية من النسخة الأولى.", patch("صغ النسخة الأولى كعرض واضح ومحدود بدل مجموعة وعود واسعة."), 300),
                ("competition_response", "قارِن القيمة بما يحدث اليوم", "لا تكتفِ بوصف الفائدة؛ قارنها بالبديل الحالي.", "بدون مقارنة سيبقى التبديل غير مقنع.", "يلزم تحديد البديل بشكل أوضح.", patch("وضّح ما الذي يفعله العميل اليوم ولماذا النتيجة معك أفضل أو أسرع."), 420),
            ],
            "unclear_target": [
                ("target_segment", "اختر مشتريًا أولًا", "افصل بين من سيدفع أولًا ومن سيستخدم لاحقًا.", "خلط الأدوار يضعف جودة التقييم.", "قد تستبعد حالات استخدام مبكرة.", patch(f"ابدأ أولًا مع {segment} كمشتري أول واضح.", target_audience=[segment]), 240),
                ("positioning", "اربط الشريحة بموقف شراء", "اختر اللحظة التي تجعل هذه الشريحة مستعدة للتصرف.", "الشريحة تتضح أكثر عند ربطها بدافع شراء متكرر.", "سيتحول الخطاب إلى حالة أضيق.", patch("عرّف موقف الشراء أو المشكلة اليومية التي تجعل الشريحة تتصرف الآن."), 300),
                ("persona_framing", "أعد بناء الشخصيات", "ابنِ الشخصيات على الشريحة الأولى فقط.", "هذا يجعل الاعتراضات أدق وأقرب للواقع.", "تنوع الشخصيات سينخفض مؤقتًا.", patch("ابنِ الشخصيات حول الشريحة الأولى فقط بدل جمهور واسع."), 240),
                ("validation_plan", "اختبر الشريحة قبل التوسع", "اعمل Pilot صغيرًا مع الشريحة الأولى قبل تعميم الفكرة.", "هذا يحسم سؤال: لمن هذه الفكرة؟", "التوسع العام سيتأخر قليلًا.", patch("اختبر الشريحة الأولى في Pilot محدود قبل توسيع النطاق."), 420),
                ("core_offer", "غيّر العرض ليناسب الشريحة", "ليس كل عرض مناسبًا لكل شريحة بنفس الدرجة.", "العرض الموجه يرفع احتمال القبول.", "قد تحتاج تأجيل مزايا أخرى.", patch("صمّم العرض الأساسي حول ألم الشريحة الأولى بدل استخدام عام."), 300),
                ("differentiation", "اجعل التمييز خاصًا بهذه الشريحة", "التمييز المقنع غالبًا يكون صحيحًا لشريحة بعينها أولًا.", "هذا يقلل الاعتراضات العامة ويشدد المقارنة.", "سيضيق السوق الأول.", patch("اجعل ميزة التمييز مرتبطة مباشرة بما يهم الشريحة الأولى."), 360),
            ],
            "market_demand": [
                ("validation_plan", "حوّل فرضية الطلب إلى اختبار", "صمّم Pilot صغيرًا يقيس الاستعداد للتجربة أو الدفع.", "هذا يعالج اعتراض الطلب بأدلة لا بانطباعات.", "ستجمع الإثبات من سوق أضيق أولًا.", patch("ابدأ اختبار طلب محدود يقيس الاستعداد للتجربة أو الدفع بوضوح."), 480),
                ("target_segment", "ابدأ بمن يشعر بالألم أعلى", "الطلب يظهر أسرع عندما نختار من يعاني المشكلة بشكل متكرر.", "السوق الواسع قد يبدو ضعيفًا بينما الشريحة الأولى جاهزة.", "السوق الأول سيصبح أصغر.", patch(f"ابدأ أولًا مع {segment} حيث الألم أقرب والقرار أسرع.", target_audience=[segment]), 300),
                ("pricing_hypothesis", "عدّل فرضية السعر", "اختبر عرضًا أوليًا أو Pilot مدفوعًا بدل افتراض الاستعداد للدفع.", "حساسية السعر جزء من الاعتراض الحالي.", "قد تحتاج تقليل النطاق في البداية.", patch("اختبر عرضًا أوليًا أو Pilot مدفوعًا يثبت استعداد السوق للدفع."), 420),
                ("competition_response", "أظهر لماذا سيغيّر السوق عادته", "اذكر البديل الحالي وما الذي يدفع المستخدم لتركه.", "إذا لم يوجد محفز للتغيير سيضعف الطلب.", "ستحتاج رسالة أوضح ضد البدائل.", patch("اشرح البديل الحالي ولماذا سيتركه العميل لصالحك الآن."), 360),
                ("positioning", "موضع الفكرة حول ألم أشد", "اربط الفكرة بمشكلة مكلفة أو متكررة بدل وعد عام.", "الطلب يرتفع عندما يرى العميل تكلفة عدم الفعل.", "الخطاب التسويقي سيتغير.", patch("اربط الفكرة بمشكلة ذات تكلفة أو تكرار أعلى في السوق الأول."), 300),
                ("core_offer", "بسّط العرض الأول", "الطلب قد يضعف لأن العرض ثقيل أو غير واضح.", "العرض الأبسط يقلل الاحتكاك ويرفع احتمال التجربة.", "ستؤجل مزايا إضافية.", patch("بسّط العرض الأول ليصبح أسهل في التجربة والشراء."), 300),
            ],
            "feasibility_scalability": [
                ("core_offer", "قلّص النسخة الأولى", "ركّز على أقل نطاق يثبت الفكرة دون تعقيد زائد.", "هذا يعالج اعتراض التنفيذ الثقيل مباشرة.", "ستؤجل بعض المزايا.", patch("اجعل النسخة الأولى محدودة جدًا في النطاق والتشغيل."), 300),
                ("positioning", "بع ما تستطيع تشغيله الآن", "لا تعد بصورة نهائية لا تستطيع الوفاء بها في v1.", "الفجوة بين الوعد والتنفيذ تضخم الاعتراضات.", "الرسالة ستصبح أكثر تحفظًا.", patch("اجعل الوعد التسويقي مساويًا لقدرة التنفيذ الحالية لا الصورة النهائية."), 240),
                ("target_segment", "اختر شريحة أسهل تشغيلًا", "لا تبدأ بالشريحة الأعلى تعقيدًا تنظيميًا أو تشغيليًا.", "تقليل التعقيد في الشريحة الأولى يرفع فرص النجاح.", "قد لا تكون هذه الشريحة هي الأكبر.", patch(f"ابدأ مع {segment} أو شريحة أبسط تشغيلًا في {place}.", target_audience=[segment]), 360),
                ("validation_plan", "اختبر العمليات قبل التوسع", "حوّل الخطر التشغيلي إلى قائمة افتراضات تختبرها في Pilot صغير.", "الوكلاء يحتاجون دليلًا على قابلية التشغيل الفعلي.", "سيتطلب هذا تعريف افتراضات أوضح.", patch("اختبر الفرضيات التشغيلية الحرجة في Pilot صغير قبل التوسع."), 480),
                ("pricing_hypothesis", "اربط السعر بتكلفة التشغيل", "لا تسعّر وكأن الكفاءة النهائية تحققت بالفعل.", "حماية الهامش مبكرًا تقلل اعتراض الاستمرار.", "قد يكون السعر الأول أقل جاذبية.", patch("عدّل فرضية السعر لتناسب تكلفة تشغيل النسخة الأولى فعليًا."), 360),
                ("competition_response", "اكتفِ بحالة استخدام يمكن الفوز بها", "لا تحتاج للفوز بكل الحالات في v1.", "الوعد الأضيق قد يكون أكثر قابلية للتنفيذ والدفاع.", "سيضيق نطاق الحالة الأولى.", patch("حدّد حالة الاستخدام الوحيدة التي يمكن الفوز فيها دون حمل تشغيلي ثقيل."), 360),
            ],
            "evidence_gap": [
                ("validation_plan", "حدّد أول دليل ناقص", "اختر نوع الإثبات الأهم بدل جمع كل شيء مرة واحدة.", "المشكلة الحالية في نوع الدليل المطلوب للحسم.", "سيؤجل بعض الأسئلة الثانوية.", patch("حدّد أول دليل نحتاجه قبل إعادة توسيع النقاش."), 360),
                ("target_segment", "اجمع الدليل من شريحة أصغر", "جمع الدليل أسهل عندما تبدأ بشريحة أولى يمكن الوصول إليها.", "الشريحة الأوضح تجعل الإثبات أسرع وأقل تكلفة.", "سوق الإثبات الأول سيكون أصغر.", patch(f"اجمع الدليل أولًا من {segment} بدل سوق واسع.", target_audience=[segment]), 300),
                ("competition_response", "اجمع دليلًا ضد البديل الحالي", "اسأل: ما الذي يثبت أن البديل الحالي أضعف فعلًا؟", "هذا يوجّه البحث لأهم اعتراض مطروح.", "قد يغيّر هذا أسئلة البحث.", patch("اجمع دليلًا مباشرًا يوضح لماذا البديل الحالي أضعف في الحالة المستهدفة."), 420),
                ("pricing_hypothesis", "اجمع إثبات استعداد الدفع", "بدون دليل على الدفع سيبقى القبول هشًا.", "استعداد الدفع من أقوى أدلة الجدوى العملية.", "سيتطلب اختبار عرض أولي.", patch("اختبر استعداد الدفع بعرض أولي أو باقة Pilot."), 420),
                ("positioning", "ضيّق الفرضية لتسهيل الإثبات", "كلما كانت الفكرة أضيق كان إثباتها أسهل.", "الفرضية الواسعة تنتج فجوات أدلة متعددة.", "سيتم تضييق الفكرة مؤقتًا.", patch("ضيّق الفرضية الأساسية لتسهيل الإثبات في الجولة القادمة."), 300),
                ("differentiation", "اربط الدليل بنقطة تمييز واحدة", "اسأل عن الدليل الذي إذا ثبت سيجعل قرار الشراء منطقيًا.", "هذا يربط الإثبات مباشرة بالتمييز.", "سيركز البحث على نقطة حاسمة واحدة.", patch("حدّد نقطة تمييز واحدة واطلب الدليل الذي يثبتها بوضوح."), 360),
            ],
        }
    else:
        labels = {
            "competitive_parity": [
                ("target_segment", "Lock a sharper first segment", "Start with one first buyer, not a broad market.", "This reduces vague comparison against the whole market.", "Your first market gets smaller, but easier to win.", patch(f"Start first with {segment} in {place}, with one measurable promise.", target_audience=[segment]), 240),
                ("differentiation", "Add a concrete reason to choose you", "Tie the offer to one outcome the incumbent does not promise as clearly.", "The live objection is lack of differentiation.", "The initial message becomes narrower.", patch("Make the main difference one operational outcome the current alternative does not promise as clearly."), 360),
                ("core_offer", "Turn the idea into one offer", "Shape v1 as one easy-to-buy offer.", "A single offer reduces drift and confusion.", "Secondary features move later.", patch("Limit v1 to one signature offer that fits in a single sentence."), 300),
                ("pricing_hypothesis", "Test a price or package logic", "Use a starter package or paid pilot instead of assuming willingness to pay.", "Price is part of the switching story.", "You may need a smaller pilot.", patch("Test a starter package or paid pilot tied to a visible first outcome."), 420),
                ("validation_plan", "Prove the edge in a pilot", "Move the debate from opinion to field proof.", "This addresses parity directly.", "Expansion slows slightly while learning improves.", patch("Run a narrow pilot that tests why customers would choose this over the current alternative."), 540),
                ("competition_response", "Answer the competitor directly", "Name the current alternative and why a customer would switch.", "Agents are framing the objection from a competitor lens.", "The narrative becomes more explicit against incumbents.", patch("Name the current alternative and the use case where you should win against it."), 420),
            ],
            "unclear_value": [
                ("value_proposition", "Lock the first value promise", "Pick one benefit that must be proven first.", "One primary benefit sharpens the decision.", "The launch message becomes narrower.", patch("Define the first benefit the customer should feel during the earliest use."), 240),
                ("target_segment", "Tie the value to the right segment", "Choose the segment that feels the pain most often.", "Value gets clearer when attached to repeated pain.", "Secondary segments may need to wait.", patch(f"Focus first on {segment} because the value is more immediate there.", target_audience=[segment]), 300),
                ("validation_plan", "Prove value in one scenario", "Use one measurable before/after use case.", "A measurable scenario makes the value concrete.", "You will not cover every use case in v1.", patch("Define one use case that makes the before/after value measurable."), 360),
                ("positioning", "Explain why now", "Add a trigger that makes adoption urgent now.", "Agents need a reason the value is timely, not optional.", "The problem statement becomes more explicit.", patch("Add a timing or trigger that makes adoption rational now, not someday."), 300),
                ("core_offer", "Turn the promise into an offer", "Make the value easy to buy, not just easy to describe.", "A concrete offer reduces confusion.", "Some extra features will need to wait.", patch("Shape v1 as one concrete offer instead of a wide list of benefits."), 300),
                ("competition_response", "Compare the value to current behavior", "Describe what it beats today, not only what it is.", "Without comparison, switching remains weak.", "You must define the current alternative more clearly.", patch("Explain what the user does today and why your outcome is stronger or faster."), 420),
            ],
            "unclear_target": [
                ("target_segment", "Pick a first buyer", "Separate who pays first from who benefits later.", "Mixing buyer and user roles weakens the simulation.", "Some broad use cases may need to wait.", patch(f"Start first with {segment} as the clearest initial buyer.", target_audience=[segment]), 240),
                ("positioning", "Anchor the segment in a buying moment", "Pick the moment when this segment is most ready to act.", "A segment becomes clearer when tied to a recurring trigger.", "The narrative narrows around a tighter use case.", patch("Define the buying moment or repeated pain that makes this segment act now."), 300),
                ("persona_framing", "Rebuild personas around one segment", "Let personas reflect real people from the first segment only.", "This removes noise and sharpens objections.", "Persona diversity drops for the first run.", patch("Build personas around the first segment only instead of a wide audience."), 240),
                ("validation_plan", "Test the segment before expanding", "Run a small pilot with the first segment.", "This answers who the idea is really for.", "Broader reach waits until later.", patch("Run a focused pilot with the first segment before expanding scope."), 420),
                ("core_offer", "Adjust the offer for that segment", "Not every offer fits every segment equally well.", "A targeted offer increases first-segment acceptance.", "Some features may need to wait.", patch("Shape the core offer around the first segment's pain instead of general use."), 300),
                ("differentiation", "Make the edge segment-specific", "The most believable edge is often true for one segment first.", "This reduces generic objections.", "The first market becomes smaller.", patch("Tie the main edge directly to what matters most for the first segment."), 360),
            ],
            "market_demand": [
                ("validation_plan", "Turn the demand claim into a test", "Design a small experiment that measures interest or willingness to pay.", "This addresses the demand objection with evidence.", "You will gather proof from a narrower market first.", patch("Run a small demand test that measures real interest or willingness to pay."), 480),
                ("target_segment", "Start where the pain is strongest", "Demand shows up faster in segments with repeated pain.", "A broad market can look weak while a tighter one is ready.", "The first addressable market becomes smaller.", patch(f"Start first with {segment}, where the pain and urgency should be higher.", target_audience=[segment]), 300),
                ("pricing_hypothesis", "Rewrite the pricing hypothesis", "Use a starter offer or paid pilot instead of assuming demand strength.", "Price sensitivity is part of the current objection.", "The v1 scope may need to shrink.", patch("Test a starter offer or paid pilot that proves willingness to pay."), 420),
                ("competition_response", "Show why the market would switch", "Name the incumbent alternative and the switching trigger.", "Without a switching trigger, demand stays soft.", "The narrative becomes more explicit about incumbents.", patch("Explain the current alternative and why a customer would switch now."), 360),
                ("positioning", "Reposition around a more urgent pain", "Tie the idea to a repeated or costly pain.", "Demand strengthens when inaction has a visible cost.", "The first-wave message changes noticeably.", patch("Tie the idea to a more urgent, repeated, or costly pain in the first market."), 300),
                ("core_offer", "Simplify the offer to reduce trial friction", "Demand can look weak when the first offer is too heavy.", "A simpler offer raises the chance of first trial.", "Secondary features may need to wait.", patch("Simplify the first offer so it becomes easier to try and easier to buy."), 300),
            ],
            "feasibility_scalability": [
                ("core_offer", "Shrink the first version", "Focus on the smallest version that proves the idea.", "This directly addresses the heavy execution objection.", "Some use cases move later.", patch("Make the first version intentionally narrow and operationally light."), 300),
                ("positioning", "Sell what v1 can truly deliver", "Do not promise the end-state if v1 needs a lighter delivery model.", "The gap between promise and delivery amplifies feasibility objections.", "The message becomes more conservative.", patch("Align the promise with what the first version can truly deliver."), 240),
                ("target_segment", "Choose an easier first segment", "Do not start with the most operationally complex segment.", "A simpler segment improves the odds of a clean launch.", "The first segment may not be the largest market.", patch(f"Start with {segment} or another easier-to-serve segment in {place}.", target_audience=[segment]), 360),
                ("validation_plan", "Test operations before scaling", "Turn execution risk into a small pilot checklist.", "Agents need proof that the first version can actually run.", "Operational assumptions must become explicit.", patch("Test the riskiest operational assumptions in a small pilot before scaling."), 480),
                ("pricing_hypothesis", "Match pricing to real delivery cost", "Do not price as if v1 already has end-state efficiency.", "Protecting the margin early reduces sustainability objections.", "The first price may look less aggressive.", patch("Adjust the pricing hypothesis to match the true cost of the first version."), 360),
                ("competition_response", "Beat the alternative with a narrower promise", "You do not need to win every use case in v1.", "A narrower promise can be both more feasible and more defensible.", "The first use case becomes tighter.", patch("Define the one use case where the offer can beat the current alternative without heavy operations."), 360),
            ],
            "evidence_gap": [
                ("validation_plan", "Pick the first missing proof", "Choose the most decision-relevant proof before collecting everything else.", "The blockage is not debate quality alone, but the missing proof.", "Secondary questions wait until after the first proof.", patch("Define the first proof needed before widening the next run."), 360),
                ("target_segment", "Collect proof from a tighter segment", "Evidence is easier to gather from a reachable first segment.", "A clearer first segment makes proof faster and cheaper.", "Early evidence will cover a smaller market.", patch(f"Collect the first proof from {segment} before broadening the market.", target_audience=[segment]), 300),
                ("competition_response", "Gather proof against the current alternative", "Ask what evidence would show the incumbent is weaker.", "This directs research toward the strongest live objection.", "Research questions may need to change.", patch("Collect direct proof that the current alternative is weaker in the target use case."), 420),
                ("pricing_hypothesis", "Collect willingness-to-pay proof", "Without payment evidence, acceptance remains fragile.", "Willingness to pay is one of the strongest operational proofs.", "You will need a starter offer or pilot package.", patch("Test willingness to pay through a starter offer or pilot package."), 420),
                ("positioning", "Simplify the claim to simplify proof", "The narrower the claim, the easier the proof.", "Wide claims create multiple proof gaps at once.", "The idea narrows temporarily.", patch("Narrow the core claim so the next run can prove it more cleanly."), 300),
                ("differentiation", "Tie the proof to one differentiator", "Choose the proof that would make switching feel rational.", "This connects evidence collection to the buying decision.", "Research will focus on one decisive angle.", patch("Pick one differentiator and collect the proof that makes it believable."), 360),
            ],
        }

    suggestions: List[Dict[str, Any]] = []
    for kind, title, one_liner, rationale, tradeoff, context_patch, eta_seconds in labels.get(blocker_tag, labels["evidence_gap"]):
        suggestions.append(
            {
                "kind": kind,
                "title": title,
                "one_liner": one_liner,
                "rationale": rationale,
                "tradeoff": tradeoff,
                "context_patch": context_patch,
                "estimated_eta_delta_seconds": eta_seconds,
            }
        )
    return suggestions


def _verify_suggestion(
    suggestion: Dict[str, Any],
    agent_citations: Sequence[Dict[str, Any]],
    research_evidence: Sequence[Dict[str, Any]],
) -> bool:
    if not isinstance(suggestion.get("context_patch"), dict) or not suggestion.get("context_patch"):
        return False
    evidence_ref_ids = suggestion.get("evidence_ref_ids")
    if not isinstance(evidence_ref_ids, list) or not evidence_ref_ids:
        return False
    ref_set = {str(item or "").strip() for item in evidence_ref_ids if str(item or "").strip()}
    if not ref_set:
        return False
    if not any(str(item.get("id") or "").strip() in ref_set for item in agent_citations):
        return False
    if not any(str(item.get("id") or "").strip() in ref_set for item in research_evidence):
        return False
    return True


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
    catalog = _build_suggestion_catalog(user_context, blocker_tag, language)
    suggestions: List[Dict[str, Any]] = []
    for raw in catalog:
        title = _compact_text(raw.get("title"), 90)
        if not title or title.lower() in exclude_titles:
            continue
        suggestion = {
            "suggestion_id": uuid.uuid4().hex[:12],
            "kind": str(raw.get("kind") or "differentiation"),
            "title": title,
            "one_liner": _compact_text(raw.get("one_liner"), 180),
            "rationale": _compact_text(raw.get("rationale"), 280),
            "tradeoff": _compact_text(raw.get("tradeoff"), 220),
            "cta_label": "اعتمد وأعد التشغيل" if language == "ar" else "Apply and rerun",
            "evidence_ref_ids": list(selected_refs),
            "context_patch": raw.get("context_patch") if isinstance(raw.get("context_patch"), dict) else {},
            "rerun_from_stage": rerun_stage_for_kind(raw.get("kind")),
            "estimated_eta_delta_seconds": int(raw.get("estimated_eta_delta_seconds") or 300),
        }
        if not _verify_suggestion(suggestion, agent_citations, research_evidence):
            continue
        suggestions.append(suggestion)
        if len(suggestions) >= max(1, int(count or 5)):
            break
    if len(suggestions) < max(1, int(count or 5)):
        for index, raw in enumerate(catalog, start=1):
            if len(suggestions) >= max(1, int(count or 5)):
                break
            base_title = _compact_text(raw.get("title"), 80)
            if not base_title:
                continue
            alt_title = (
                f"بديل {index}: {base_title}"
                if language == "ar"
                else f"Alternative {index}: {base_title}"
            )
            if alt_title.lower() in exclude_titles:
                continue
            suggestion = {
                "suggestion_id": uuid.uuid4().hex[:12],
                "kind": f"{str(raw.get('kind') or 'idea_research')}_alt_{index}",
                "title": alt_title,
                "one_liner": _compact_text(raw.get("one_liner"), 180),
                "rationale": _compact_text(raw.get("rationale"), 280),
                "tradeoff": _compact_text(raw.get("tradeoff"), 220),
                "cta_label": "اعتمد وأعد التشغيل" if language == "ar" else "Apply and rerun",
                "evidence_ref_ids": list(selected_refs),
                "context_patch": raw.get("context_patch") if isinstance(raw.get("context_patch"), dict) else {},
                "rerun_from_stage": rerun_stage_for_kind(raw.get("kind")),
                "estimated_eta_delta_seconds": int(raw.get("estimated_eta_delta_seconds") or 300),
            }
            if not _verify_suggestion(suggestion, agent_citations, research_evidence):
                continue
            suggestions.append(suggestion)
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
    window_items = [item for item in list(reasoning_window or [])[-10:] if isinstance(item, dict) and str(item.get("message") or "").strip()]
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
    top_count = tag_counts.get(top_tag, 0)
    if top_count < 2 or len(unique_agents) < 2:
        return None

    research_evidence = extract_research_evidence(user_context, limit=3)
    if not research_evidence:
        return None
    agent_citations = build_agent_citations([item for _, item in strategic_items], top_tag, limit=3)
    if not agent_citations:
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

    blocker_summary = build_blocker_summary(top_tag, _idea_label(user_context, language), language)
    guide_message = (
        "المحاكاة توقفت لأن الوكلاء converged على blocker مهم. جهزت لك 5 تعديلات grounded يمكن تطبيقها ثم إعادة التشغيل."
        if language == "ar"
        else "Simulation paused because agents converged on a material blocker. I prepared 5 grounded fixes you can apply before rerunning."
    )
    return {
        "intervention_id": uuid.uuid4().hex,
        "simulation_id": simulation_id,
        "blocker_tag": top_tag,
        "blocker_summary": blocker_summary,
        "severity": "high" if top_count >= 3 or len(unique_agents) >= 3 else "medium",
        "decision_axis": decision_axis_for_blocker(top_tag),
        "should_pause": True,
        "ui_state": "options_ready",
        "guide_message": guide_message,
        "phase_key": str(phase_key or "").strip() or None,
        "agent_citations": agent_citations,
        "research_evidence": research_evidence,
        "suggestions": suggestions,
        "patch_preview": None,
        "continue_blocked": False,
        "created_at": None,
        "history": [
            item
            for item in (previous_history or [])
            if isinstance(item, dict)
        ] + [
            {"type": "coach_detected", "label": "Observed objection"},
            {"type": "coach_options_ready", "label": "5 fixes ready"},
        ],
    }


def neutralize_custom_fix(text: str, user_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    user_context = user_context or {}
    language = normalize_language((user_context or {}).get("language"))
    raw_text = _compact_text(text, 400)
    normalized = re.sub(r"\s+", " ", raw_text)
    updates: Dict[str, Any] = {}
    notes: List[str] = []
    filtered = False

    city_match = re.search(r"(?:city\s*(?:is|=|:)\s*|المدينة\s*(?:هي|=|:)\s*)([^,;\n]+)", normalized, re.IGNORECASE)
    if city_match:
        updates["city"] = _compact_text(city_match.group(1), 80)
    country_match = re.search(r"(?:country\s*(?:is|=|:)\s*|الدولة\s*(?:هي|=|:)\s*)([^,;\n]+)", normalized, re.IGNORECASE)
    if country_match:
        updates["country"] = _compact_text(country_match.group(1), 80)
    category_match = re.search(r"(?:category\s*(?:is|=|:)\s*|الفئة\s*(?:هي|=|:)\s*)([^,;\n]+)", normalized, re.IGNORECASE)
    if category_match:
        updates["category"] = _compact_text(category_match.group(1), 80)
    audience_match = re.search(r"(?:target audience\s*(?:is|=|:)\s*|الجمهور المستهدف\s*(?:هو|=|:)\s*)([^,;\n]+)", normalized, re.IGNORECASE)
    if audience_match:
        audience_value = _compact_text(audience_match.group(1), 80)
        if audience_value:
            updates["targetAudience"] = [audience_value]
    idea_match = re.search(r"(?:idea\s*(?:is|=|:)\s*|الفكرة\s*(?:هي|=|:)\s*)(.+)", normalized, re.IGNORECASE)
    if idea_match:
        updates["idea"] = _compact_text(idea_match.group(1), 220)

    steering_patterns = [
        r"\bmake them agree\b",
        r"\bforce acceptance\b",
        r"\bignore objections\b",
        r"\bخلي الوكلاء\b",
        r"\bاجبر\b",
        r"\bخل.?يهم يوافقوا\b",
        r"\bتجاهل الاعتراض\b",
    ]
    if any(re.search(pattern, normalized, re.IGNORECASE) for pattern in steering_patterns):
        filtered = True
        notes.append(
            "تم تجاهل الجزء الذي يحاول توجيه رأي الوكلاء مباشرة." if language == "ar"
            else "Direct attempts to steer agent opinions were filtered out."
        )

    if not updates and normalized:
        base_idea = _compact_text((user_context or {}).get("idea"), 180)
        updates["idea"] = _append_idea_focus(base_idea, normalized) if base_idea else normalized
        notes.append(
            "تم تحويل النص إلى قيد وصفي على صياغة الفكرة." if language == "ar"
            else "The text was converted into a descriptive idea constraint."
        )

    if updates:
        notes.append(
            "سيتم استخدام هذا التعديل كقيود واقعية فقط وليس كتوجيه لرأي الوكلاء." if language == "ar"
            else "This change will be used as factual context only, not as opinion steering."
        )

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
        (
            str(suggestion.get("kind") or "")
            for suggestion in (intervention.get("suggestions") if isinstance(intervention.get("suggestions"), list) else [])
            if str(suggestion.get("suggestion_id") or "") == str(selected_suggestion_id or "")
        ),
        "",
    )
    rerun_from_stage = rerun_stage_for_kind(selected_kind)
    if not selected_kind:
        patch_keys = {str(key) for key in (context_patch or {}).keys()}
        if {"city", "country"} & patch_keys:
            rerun_from_stage = "location_research"
        elif {"targetAudience", "idea", "category"} & patch_keys:
            rerun_from_stage = "schema_intake"
        else:
            rerun_from_stage = "idea_research"
    language = normalize_language(intervention.get("language"))
    guide_message = (
        "سنطبق التعديل كسياق منظم ثم نعيد البناء من أقل مرحلة لازمة."
        if language == "ar"
        else "The patch will be applied as structured context, then the run will restart from the lowest required stage."
    )
    eta_delta = next(
        (
            int(suggestion.get("estimated_eta_delta_seconds") or 300)
            for suggestion in (intervention.get("suggestions") if isinstance(intervention.get("suggestions"), list) else [])
            if str(suggestion.get("suggestion_id") or "") == str(selected_suggestion_id or "")
        ),
        300,
    )
    return {
        "context_patch": context_patch,
        "rerun_from_stage": rerun_from_stage,
        "guide_message": guide_message,
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
                agent_citations=[{"id": "agent:1", "quote": "Value is still unclear."}],
                research_evidence=[{"id": "research:1", "quote": _compact_text(user_context.get("research_summary"), 220) or "Research is still inconclusive."}],
            ),
        }
    suggestions = intervention.get("suggestions") if isinstance(intervention.get("suggestions"), list) else []
    suggestion_steps = [str(item.get("title") or "").strip() for item in suggestions if str(item.get("title") or "").strip()][:4]
    revised_idea = _compact_text(
        ((suggestions[0].get("context_patch") or {}).get("idea") if suggestions else user_context.get("idea")),
        240,
    ) or _idea_label(user_context, language)
    return {
        "action": "make_acceptable",
        "title": "Make your idea more defensible" if language == "en" else "اجعل الفكرة أكثر قابلية للدفاع",
        "summary": intervention.get("blocker_summary") or "",
        "steps": suggestion_steps,
        "risks": [
            "Weak differentiation can return if the first wedge stays too broad.",
            "Proof quality stays low if the next run changes context without a focused validation step.",
        ] if language == "en" else [
            "قد يعود ضعف التمييز إذا ظلت الشريحة الأولى واسعة جدًا.",
            "ستظل جودة الإثبات منخفضة إذا تغير السياق دون خطوة تحقق مركزة.",
        ],
        "kpis": [
            "First-segment conversion rate",
            "Pilot completion rate",
            "Repeat purchase or repeat usage",
        ] if language == "en" else [
            "معدل تحويل الشريحة الأولى",
            "معدل اكتمال الـPilot",
            "معدل الشراء أو الاستخدام المتكرر",
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
