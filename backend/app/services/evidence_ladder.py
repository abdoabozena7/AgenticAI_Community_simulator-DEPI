from __future__ import annotations

import hashlib
from typing import Any, Dict, List, Optional, Sequence


DIRECT_EVIDENCE = "direct_evidence"
DERIVED_SIGNAL = "derived_signal"
MODEL_ESTIMATE = "model_estimate"
VALID_EVIDENCE_TYPES = {DIRECT_EVIDENCE, DERIVED_SIGNAL, MODEL_ESTIMATE}

_DEFAULT_TYPE_CONFIDENCE = {
    DIRECT_EVIDENCE: 0.85,
    DERIVED_SIGNAL: 0.62,
    MODEL_ESTIMATE: 0.35,
}
_ORIGIN_MODIFIER = {
    "proxy_search": -0.05,
    "proxy_structured": -0.08,
}
_POSITIVE_MARKERS = (
    "strong",
    "growth",
    "popular",
    "fast",
    "easy",
    "trust",
    "reliable",
    "demand",
)
_NEGATIVE_MARKERS = (
    "weak",
    "slow",
    "risk",
    "complaint",
    "skeptical",
    "expensive",
    "friction",
    "objection",
)


_WHY_IT_MATTERS_BY_FIELD = {
    "signals": "Helps ground what people notice, want, or react to.",
    "user_types": "Helps identify who is most likely to participate or care.",
    "complaints": "Helps explain likely objections or rejection pressure.",
    "behaviors": "Helps ground realistic user actions and habits.",
    "competition_reactions": "Helps show how the market reacts when alternatives exist.",
    "visible_insights": "Helps summarize the strongest actionable takeaway quickly.",
    "expandable_reasoning": "Helps explain the reasoning behind the current research view.",
    "competition_level": "Helps frame how crowded the market is.",
    "demand_level": "Helps frame expected demand strength.",
    "price_sensitivity": "Helps frame how strongly price can change decisions.",
    "regulatory_risk": "Helps frame likely compliance or policy friction.",
}


def normalize_evidence_type(value: Any, fallback: str = DERIVED_SIGNAL) -> str:
    text = str(value or "").strip().lower()
    return text if text in VALID_EVIDENCE_TYPES else fallback


def _normalize_confidence(value: Any) -> Optional[float]:
    try:
        confidence = float(value)
    except (TypeError, ValueError):
        return None
    return round(max(0.0, min(1.0, confidence)), 3)


def _normalize_timestamp(value: Any) -> Optional[int]:
    try:
        timestamp = int(value)
    except (TypeError, ValueError):
        return None
    return timestamp if timestamp > 0 else None


def _normalize_source(source: Any) -> Any:
    if isinstance(source, dict):
        cleaned = {
            key: value
            for key, value in {
                "query": str(source.get("query") or "").strip() or None,
                "title": str(source.get("title") or "").strip() or None,
                "url": str(source.get("url") or "").strip() or None,
                "domain": str(source.get("domain") or "").strip() or None,
                "kind": str(source.get("kind") or "").strip() or None,
                "field": str(source.get("field") or "").strip() or None,
            }.items()
            if value is not None
        }
        return cleaned or None
    text = str(source or "").strip()
    return text or None


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _stable_id(*parts: Any) -> str:
    basis = "||".join(str(part or "").strip().lower() for part in parts if str(part or "").strip())
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()
    return f"ev-{digest[:16]}"


def _source_kind(item: Dict[str, Any]) -> str:
    source = item.get("source")
    if isinstance(source, dict):
        return str(source.get("kind") or "").strip().lower()
    return str(source or "").strip().lower()


def _source_domain(item: Dict[str, Any]) -> str:
    source = item.get("source")
    if isinstance(source, dict):
        for key in ("domain", "url", "title", "query", "kind"):
            value = str(source.get(key) or "").strip().lower()
            if value:
                return value
    return str(source or "").strip().lower()


def _source_field(item: Dict[str, Any]) -> str:
    source = item.get("source")
    if isinstance(source, dict):
        return str(source.get("field") or source.get("kind") or "").strip().lower() or "signals"
    return str(item.get("evidence_type") or "").strip().lower() or "signals"


def _item_score(item: Dict[str, Any]) -> float:
    evidence_type = normalize_evidence_type(item.get("evidence_type"))
    default_score = _DEFAULT_TYPE_CONFIDENCE.get(evidence_type, 0.5)
    source_modifier = _ORIGIN_MODIFIER.get(_source_kind(item), 0.0)
    explicit_confidence = item.get("confidence")
    explicit_score = float(explicit_confidence) if isinstance(explicit_confidence, (int, float)) else default_score
    return round(
        _clamp((0.6 * explicit_score) + (0.4 * default_score) + source_modifier, 0.05, 0.95),
        3,
    )


def _item_polarity(text: str) -> int:
    lowered = str(text or "").strip().lower()
    if not lowered:
        return 0
    positive = any(marker in lowered for marker in _POSITIVE_MARKERS)
    negative = any(marker in lowered for marker in _NEGATIVE_MARKERS)
    if positive and not negative:
        return 1
    if negative and not positive:
        return -1
    return 0


def _contradiction_count(items: Sequence[Dict[str, Any]]) -> int:
    buckets: Dict[str, Dict[int, set[str]]] = {}
    for item in items or []:
        if not isinstance(item, dict):
            continue
        evidence_type = normalize_evidence_type(item.get("evidence_type"))
        if evidence_type not in {DIRECT_EVIDENCE, DERIVED_SIGNAL}:
            continue
        polarity = _item_polarity(str(item.get("text") or ""))
        if polarity == 0:
            continue
        bucket = _source_field(item)
        source_marker = _source_domain(item) or str(item.get("id") or "").strip().lower()
        if not bucket or not source_marker:
            continue
        bucket_entry = buckets.setdefault(bucket, {1: set(), -1: set()})
        bucket_entry[polarity].add(source_marker)
    contradictions = 0
    for values in buckets.values():
        positive_sources = values.get(1) or set()
        negative_sources = values.get(-1) or set()
        if positive_sources and negative_sources and positive_sources != negative_sources:
            contradictions += 1
    return min(3, contradictions)


def _default_why_it_matters(*, field_name: Optional[str], evidence_type: str) -> str:
    if field_name and field_name in _WHY_IT_MATTERS_BY_FIELD:
        return _WHY_IT_MATTERS_BY_FIELD[field_name]
    if evidence_type == DIRECT_EVIDENCE:
        return "Provides source-backed grounding for downstream reasoning."
    if evidence_type == MODEL_ESTIMATE:
        return "Provides a bounded estimate when direct evidence is thin."
    return "Provides a reusable signal for downstream personas and reasoning."


def make_evidence_item(
    *,
    text: Any,
    evidence_type: Any,
    source: Any = None,
    confidence: Any = None,
    timestamp_ms: Any = None,
    freshness: Any = None,
    why_it_matters: Any = None,
    field_name: Optional[str] = None,
    item_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    clean_text = str(text or "").strip()
    if not clean_text:
        return None
    clean_type = normalize_evidence_type(evidence_type)
    clean_source = _normalize_source(source)
    clean_timestamp = _normalize_timestamp(timestamp_ms)
    clean_freshness = str(freshness or "").strip() or None
    clean_why = str(why_it_matters or "").strip() or _default_why_it_matters(
        field_name=field_name,
        evidence_type=clean_type,
    )
    item = {
        "id": item_id or _stable_id(clean_type, clean_text, clean_source or field_name or clean_why),
        "text": clean_text,
        "evidence_type": clean_type,
        "source": clean_source,
        "confidence": _normalize_confidence(confidence),
        "timestamp_ms": clean_timestamp,
        "freshness": clean_freshness,
        "why_it_matters": clean_why,
    }
    return item


def merge_evidence_ladder(*collections: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for collection in collections:
        for item in collection or []:
            if not isinstance(item, dict):
                continue
            normalized = make_evidence_item(
                text=item.get("text"),
                evidence_type=item.get("evidence_type"),
                source=item.get("source"),
                confidence=item.get("confidence"),
                timestamp_ms=item.get("timestamp_ms"),
                freshness=item.get("freshness"),
                why_it_matters=item.get("why_it_matters"),
                item_id=str(item.get("id") or "").strip() or None,
            )
            if not normalized:
                continue
            dedupe_key = _stable_id(
                normalized.get("evidence_type"),
                normalized.get("text"),
                normalized.get("source"),
            )
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            merged.append(normalized)
    return merged


def ensure_evidence_ladder(structured: Dict[str, Any]) -> List[Dict[str, Any]]:
    if not isinstance(structured, dict):
        return []
    current = structured.get("evidence_ladder") if isinstance(structured.get("evidence_ladder"), list) else []
    normalized = merge_evidence_ladder(current)
    structured["evidence_ladder"] = normalized
    return normalized


def build_research_evidence_ladder(
    *,
    evidence: Sequence[Any],
    structured: Dict[str, Any],
    timestamp_ms: Optional[int] = None,
    estimated: bool = False,
) -> List[Dict[str, Any]]:
    ladder: List[Dict[str, Any]] = []
    structured = structured if isinstance(structured, dict) else {}
    source_rows = structured.get("sources") if isinstance(structured.get("sources"), list) else []
    confidence = structured.get("confidence_score")

    for item in evidence or []:
        direct_item = make_evidence_item(
            text=getattr(item, "snippet", "") or getattr(item, "title", ""),
            evidence_type=DIRECT_EVIDENCE,
            source={
                "query": getattr(item, "query", ""),
                "title": getattr(item, "title", ""),
                "url": getattr(item, "url", ""),
                "domain": getattr(item, "domain", ""),
            },
            confidence=getattr(item, "relevance_score", None),
            timestamp_ms=timestamp_ms,
            field_name="signals",
            why_it_matters="Provides source-backed grounding for market and audience claims.",
        )
        if direct_item:
            ladder.append(direct_item)

    for row in source_rows:
        if not isinstance(row, dict):
            continue
        direct_item = make_evidence_item(
            text=row.get("title") or row.get("url"),
            evidence_type=DIRECT_EVIDENCE,
            source=row,
            confidence=confidence,
            timestamp_ms=timestamp_ms,
            field_name="signals",
            why_it_matters="Keeps the originating source attached to downstream signals.",
        )
        if direct_item:
            ladder.append(direct_item)

    derived_fields = ("signals", "user_types", "complaints", "behaviors", "competition_reactions")
    for field_name in derived_fields:
        values = structured.get(field_name) if isinstance(structured.get(field_name), list) else []
        for value in values:
            item = make_evidence_item(
                text=value,
                evidence_type=DERIVED_SIGNAL,
                source={"kind": "research_structured", "field": field_name},
                confidence=confidence,
                timestamp_ms=timestamp_ms,
                field_name=field_name,
            )
            if item:
                ladder.append(item)

    estimate_fields = ["visible_insights", "expandable_reasoning"] if estimated else []
    for field_name in estimate_fields:
        values = structured.get(field_name) if isinstance(structured.get(field_name), list) else []
        for value in values:
            item = make_evidence_item(
                text=value,
                evidence_type=MODEL_ESTIMATE,
                source="ai_estimation",
                confidence=confidence,
                timestamp_ms=timestamp_ms,
                field_name=field_name,
            )
            if item:
                ladder.append(item)

    if estimated:
        for field_name in ("competition_level", "demand_level", "price_sensitivity", "regulatory_risk"):
            value = str(structured.get(field_name) or "").strip()
            if not value:
                continue
            item = make_evidence_item(
                text=f"{field_name.replace('_', ' ')}: {value}",
                evidence_type=MODEL_ESTIMATE,
                source="ai_estimation",
                confidence=confidence,
                timestamp_ms=timestamp_ms,
                field_name=field_name,
            )
            if item:
                ladder.append(item)

    return merge_evidence_ladder(ensure_evidence_ladder(structured), ladder)


def build_proxy_evidence_ladder(
    *,
    evidence: Sequence[Any],
    structured: Dict[str, Any],
    timestamp_ms: Optional[int] = None,
) -> List[Dict[str, Any]]:
    ladder: List[Dict[str, Any]] = []
    structured = structured if isinstance(structured, dict) else {}
    confidence = structured.get("confidence_score")

    for item in evidence or []:
        direct_item = make_evidence_item(
            text=getattr(item, "snippet", "") or getattr(item, "title", ""),
            evidence_type=DIRECT_EVIDENCE,
            source={
                "kind": "proxy_search",
                "query": getattr(item, "query", ""),
                "title": getattr(item, "title", ""),
                "url": getattr(item, "url", ""),
                "domain": getattr(item, "domain", ""),
            },
            confidence=getattr(item, "relevance_score", None),
            timestamp_ms=timestamp_ms,
            field_name="signals",
            why_it_matters="Provides adjacent-market evidence when direct search is sparse.",
        )
        if direct_item:
            ladder.append(direct_item)

    for field_name in ("signals", "user_types", "complaints", "behaviors", "competition_reactions"):
        values = structured.get(field_name) if isinstance(structured.get(field_name), list) else []
        for value in values:
            item = make_evidence_item(
                text=value,
                evidence_type=DERIVED_SIGNAL,
                source={"kind": "proxy_structured", "field": field_name},
                confidence=confidence,
                timestamp_ms=timestamp_ms,
                field_name=field_name,
                why_it_matters="Extends the research view with analogous market and objection patterns.",
            )
            if item:
                ladder.append(item)

    return merge_evidence_ladder(ensure_evidence_ladder(structured), ladder)


def find_evidence_by_text(items: Sequence[Dict[str, Any]], text: Any) -> List[Dict[str, Any]]:
    target = str(text or "").strip().lower()
    if not target:
        return []
    return [
        item
        for item in (items or [])
        if isinstance(item, dict) and str(item.get("text") or "").strip().lower() == target
    ]


def summarize_evidence_confidence(items: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    ladder = [item for item in (items or []) if isinstance(item, dict)]
    total_count = len(ladder)
    direct_count = sum(1 for item in ladder if normalize_evidence_type(item.get("evidence_type")) == DIRECT_EVIDENCE)
    derived_count = sum(1 for item in ladder if normalize_evidence_type(item.get("evidence_type")) == DERIVED_SIGNAL)
    estimate_count = sum(1 for item in ladder if normalize_evidence_type(item.get("evidence_type")) == MODEL_ESTIMATE)
    proxy_count = sum(1 for item in ladder if _source_kind(item) in {"proxy_search", "proxy_structured"})
    domains = {
        domain
        for domain in (_source_domain(item) for item in ladder)
        if domain and not domain.startswith("ai_estimation")
    }
    domain_count = len(domains)
    contradiction_count = _contradiction_count(ladder)
    item_scores = sorted((_item_score(item) for item in ladder), reverse=True)
    top_mean = (sum(item_scores[:12]) / min(len(item_scores), 12)) if item_scores else 0.0
    support_score = min(1.0, (direct_count + (0.7 * derived_count) + (0.25 * estimate_count)) / 8.0)
    domain_score = min(1.0, domain_count / 4.0)
    direct_bonus = min(1.0, direct_count / 3.0)
    proxy_ratio = (proxy_count / total_count) if total_count else 0.0
    contradiction_penalty = min(0.18, 0.06 * contradiction_count)
    score = round(
        _clamp(
            (0.45 * top_mean)
            + (0.25 * support_score)
            + (0.15 * domain_score)
            + (0.10 * direct_bonus)
            - (0.08 * proxy_ratio)
            - contradiction_penalty,
            0.0,
            0.95,
        ),
        3,
    )
    return {
        "score": score,
        "direct_count": direct_count,
        "derived_count": derived_count,
        "estimate_count": estimate_count,
        "proxy_ratio": round(proxy_ratio, 3),
        "proxy_count": proxy_count,
        "domain_diversity": round(domain_score, 3),
        "domain_count": domain_count,
        "contradiction_count": contradiction_count,
        "direct_ratio": round((direct_count / total_count) if total_count else 0.0, 3),
        "derived_ratio": round((derived_count / total_count) if total_count else 0.0, 3),
        "estimate_ratio": round((estimate_count / total_count) if total_count else 0.0, 3),
    }
