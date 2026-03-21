from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from ..core.page_fetch import fetch_page
from ..core.web_search import search_web
from ..models.orchestration import (
    ClarificationQuestion,
    EvidenceItem,
    IdeaContextType,
    OrchestrationState,
    ResearchQuery,
    ResearchReport,
    SimulationPhase,
    SimulationStatus,
    classify_idea_context,
    context_location_label,
)
from .base import BaseAgent


class SearchAgent(BaseAgent):
    name = "search_agent"

    def _merge_quality_snapshot(self, current: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
        merged = dict(current or {})
        snapshot = dict(incoming or {})
        merged["usable_sources"] = max(int(merged.get("usable_sources") or 0), int(snapshot.get("usable_sources") or 0))
        merged["domains"] = max(int(merged.get("domains") or 0), int(snapshot.get("domains") or 0))
        current_rate = float(merged.get("extraction_success_rate") or 0.0)
        next_rate = float(snapshot.get("extraction_success_rate") or 0.0)
        merged["extraction_success_rate"] = round(max(current_rate, next_rate), 3)
        return merged

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        context = state.user_context
        context_type = state.idea_context_type or classify_idea_context(context).value
        query_plan = self._build_query_plan(context=context, context_type=context_type)
        report = ResearchReport(query_plan=query_plan)
        structured_accumulator = self._empty_structured_schema(context=context, context_type=context_type)
        state.set_pipeline_step(
            "building_search_queries",
            "running",
            detail=f"Building mandatory query plan for {context_type}.",
        )
        state.schema["search_query_plan"] = [item.to_dict() for item in query_plan]
        state.set_pipeline_step(
            "building_search_queries",
            "completed",
            detail=f"Built {len(query_plan)} search queries.",
        )
        state.set_pipeline_step(
            "searching_sources",
            "running",
            detail="Searching required sources before persona generation.",
        )

        candidate_pages: List[Dict[str, Any]] = []
        seen_candidate_urls: set[str] = set()
        pages_read = 0

        for index, planned_query in enumerate(query_plan, start=1):
            cycle_id = f"search-{index}"
            await self.runtime.event_bus.publish(
                state,
                "research_started",
                {
                    "agent": self.name,
                    "cycle_id": cycle_id,
                    "query": planned_query.query,
                    "reason": planned_query.reason,
                    "action": "research_started",
                    "status": "running",
                    "progress_pct": min(60, 8 + index * 6),
                },
                persist_research=True,
            )
            await self.runtime.event_bus.publish(
                state,
                "query_planned",
                {
                    "agent": self.name,
                    "cycle_id": cycle_id,
                    "query": planned_query.query,
                    "reason": planned_query.reason,
                    "action": "query_planned",
                    "status": "ok",
                    "progress_pct": min(60, 12 + index * 6),
                },
                persist_research=True,
            )
            result = await search_web(
                query=planned_query.query,
                max_results=5,
                language=context.get("language") or "en",
                strict_web_only=not self._allow_ai_estimation(state),
            )
            top_results = result.get("results") if isinstance(result.get("results"), list) else []
            await self.runtime.event_bus.publish(
                state,
                "search_results_found",
                {
                    "agent": self.name,
                    "cycle_id": cycle_id,
                    "query": planned_query.query,
                    "action": "search_results_found",
                    "status": "ok",
                    "progress_pct": min(78, 20 + index * 8),
                    "meta": {
                        "provider": result.get("provider"),
                        "quality": result.get("quality") or {},
                        "count": len(top_results),
                    },
                    "snippet": str((result.get("structured") or {}).get("summary") or "")[:400],
                },
                persist_research=True,
            )
            report.quality = self._merge_quality_snapshot(report.quality, dict(result.get("quality") or {}))
            structured = result.get("structured") or {}
            if isinstance(structured, dict):
                structured_accumulator = self._merge_structured_schema(structured_accumulator, structured)

            for item in top_results[:3]:
                url = str(item.get("url") or "").strip()
                if not url or url in seen_candidate_urls:
                    continue
                seen_candidate_urls.add(url)
                candidate_pages.append(
                    {
                        "cycle_id": cycle_id,
                        "query": planned_query.query,
                        "reason": planned_query.reason,
                        "provider": result.get("provider"),
                        "item": item,
                    }
                )

        state.set_pipeline_step(
            "searching_sources",
            "completed",
            detail=f"Searched {len(query_plan)} mandatory queries.",
        )
        if candidate_pages:
            state.set_pipeline_step(
                "reading_pages",
                "running",
                detail="Reading pages from search results.",
            )

        for candidate in candidate_pages:
            item = candidate["item"]
            url = str(item.get("url") or "").strip()
            await self.runtime.event_bus.publish(
                state,
                "page_opening",
                {
                    "agent": self.name,
                    "cycle_id": candidate["cycle_id"],
                    "query": candidate["query"],
                    "url": url,
                    "domain": str(item.get("domain") or "").strip(),
                    "title": str(item.get("title") or "").strip(),
                    "action": "page_opening",
                    "status": "running",
                    "progress_pct": 74,
                },
                persist_research=True,
            )
            page = await fetch_page(url)
            pages_read += 1
            evidence = EvidenceItem(
                query=candidate["query"],
                title=str(item.get("title") or page.get("title") or "").strip(),
                url=url,
                domain=str(item.get("domain") or "").strip(),
                snippet=str(item.get("snippet") or "").strip(),
                content=str(page.get("content") or "").strip(),
                relevance_score=self._relevance_score(
                    query=candidate["query"],
                    title=str(item.get("title") or ""),
                    snippet=str(item.get("snippet") or ""),
                    content=str(page.get("content") or ""),
                ),
                http_status=page.get("http_status"),
            )
            if page.get("ok") and (evidence.content or evidence.snippet):
                report.evidence.append(evidence)
            await self.runtime.event_bus.publish(
                state,
                "page_scraped",
                {
                    "agent": self.name,
                    "cycle_id": candidate["cycle_id"],
                    "query": candidate["query"],
                    "url": url,
                    "domain": evidence.domain,
                    "title": evidence.title,
                    "snippet": (evidence.content or evidence.snippet)[:420],
                    "http_status": evidence.http_status,
                    "content_chars": len(evidence.content or evidence.snippet),
                    "relevance_score": evidence.relevance_score,
                    "action": "page_scraped",
                    "status": "ok" if page.get("ok") else "failed",
                    "error": page.get("error"),
                    "progress_pct": min(92, 78 + pages_read * 2),
                    "meta": {"provider": candidate["provider"], "query_reason": candidate["reason"]},
                },
                persist_research=True,
            )

        report.evidence = sorted(report.evidence, key=lambda item: item.relevance_score, reverse=True)[:10]
        structured_accumulator = self._merge_evidence_into_structured(structured_accumulator, report.evidence)
        if not isinstance(structured_accumulator.get("user_sentiment"), dict):
            structured_accumulator["user_sentiment"] = {"positive": [], "negative": [], "neutral": []}
        structured_accumulator["quality"] = dict(report.quality or {})
        report.structured_schema = structured_accumulator
        if not report.summary:
            report.summary = str(structured_accumulator.get("summary") or "").strip() or self._fallback_summary(report)
        if not report.findings:
            report.findings = self._structured_findings(structured_accumulator) or self._fallback_findings(report)
        if not report.gaps:
            report.gaps = [str(item) for item in structured_accumulator.get("gaps") or [] if str(item).strip()] or self._fallback_gaps(state)

        initial_research_insufficient = self._research_is_insufficient(report)
        estimation_mode = None
        if self._allow_ai_estimation(state) and initial_research_insufficient:
            estimated = await self._estimate_human_signals(state, report)
            structured_accumulator = self._merge_structured_schema(structured_accumulator, estimated)
            structured_accumulator["estimation_mode"] = "ai_estimation"
            structured_accumulator["confidence_score"] = min(
                0.64,
                max(
                    float(structured_accumulator.get("confidence_score") or 0.0),
                    float(estimated.get("confidence_score") or 0.0),
                ),
            )
            report.structured_schema = structured_accumulator
            report.summary = str(structured_accumulator.get("summary") or "").strip() or report.summary
            report.findings = self._structured_findings(structured_accumulator) or report.findings
            report.gaps = [str(item) for item in structured_accumulator.get("gaps") or [] if str(item).strip()] or report.gaps
            estimation_mode = "ai_estimation"

        research_insufficient = self._research_is_insufficient(report)
        fatal_search_failure = self._fatal_search_failure(report)
        research_contract_ready = self._research_contract_satisfied(report)
        research_warnings: List[str] = []
        research_blockers: List[str] = []
        if estimation_mode == "ai_estimation":
            research_warnings.append("used_ai_estimation_due_to_weak_search")
        if initial_research_insufficient:
            research_warnings.append("research_insufficient_for_personas")
        if fatal_search_failure:
            research_blockers.append("fatal_search_failure")

        estimation_allowed = self._allow_ai_estimation(state)
        state.research = report
        state.search_completed = bool(
            research_contract_ready
            and not fatal_search_failure
            and not (research_insufficient and not estimation_allowed)
        )
        state.schema.update(
            {
                "idea": context.get("idea"),
                "category": context.get("category"),
                "location": context_location_label(context),
                "context_type": context_type,
                "research_summary": report.summary,
                "research_findings": list(report.findings),
                "research_gaps": list(report.gaps),
                "research_visible_insights": list(report.structured_schema.get("visible_insights") or []),
                "research_expandable_reasoning": list(report.structured_schema.get("expandable_reasoning") or []),
                "research_confidence_score": float(report.structured_schema.get("confidence_score") or 0.0),
                "research_output_ready": state.search_completed,
                "research_insufficiency_reason": "research_insufficient_for_personas" if initial_research_insufficient else None,
                "research_estimation_mode": estimation_mode,
                "research_warnings": research_warnings,
                "research_blockers": research_blockers,
                "fatal_search_failure": fatal_search_failure,
            }
        )
        state.set_pipeline_step(
            "reading_pages",
            "completed",
            detail=(
                f"Read {pages_read} pages from search results."
                if candidate_pages
                else "No readable pages were found in the mandatory search results."
            ),
        )
        await self.runtime.event_bus.publish(
            state,
            "search_completed",
            {
                "agent": self.name,
                "action": "search_completed",
                "status": "failed" if fatal_search_failure else ("warning" if estimation_mode == "ai_estimation" else "ok"),
                "progress_pct": 100,
                "meta": {
                    "query_count": len(query_plan),
                    "evidence_count": len(report.evidence),
                    "estimation_mode": estimation_mode,
                    "research_warnings": research_warnings,
                },
                "snippet": report.summary[:320],
            },
            persist_research=True,
        )
        if fatal_search_failure or (research_insufficient and not estimation_allowed):
            await self._pause_for_research_review(state, report)
        return state

    def _build_query_plan(self, *, context: Dict[str, Any], context_type: str) -> List[ResearchQuery]:
        idea = str(context.get("idea") or "").strip()
        category = str(context.get("category") or "").strip()
        location = context_location_label(context)
        audience = ", ".join(context.get("targetAudience") or [])
        query_specs: List[Tuple[str, str]] = []

        if context_type == IdeaContextType.LOCATION_BASED.value:
            query_specs = [
                ("idea topic and place", "Search the idea with the exact city or region."),
                ("local competition", "Identify local competitors and substitutes."),
                ("local people sentiment", "Find sentiment from local users or residents."),
                ("local social media community pages", "Find place-specific communities or discussion pages when possible."),
            ]
        elif context_type == IdeaContextType.HYBRID.value:
            query_specs = [
                ("idea topic and target audience", "Search the core idea and who it serves."),
                ("market sentiment and user opinions", "Gather online sentiment and firsthand comments."),
                ("local competition and regional demand", "Check regional competitors and demand in the specified place."),
                ("local social media community pages", "Find city or region communities when possible."),
            ]
        else:
            query_specs = [
                ("idea topic and target audience", "Search the core idea and its main audience."),
                ("market sentiment", "Measure market sentiment around the concept."),
                ("user opinions", "Collect direct user opinions and complaints."),
                ("online communities social comments", "Find public community and social discussion when possible."),
            ]

        plan: List[ResearchQuery] = []
        for suffix, reason in query_specs:
            query = " ".join(part for part in [idea, category, audience, location, suffix] if part).strip()
            if query:
                plan.append(ResearchQuery(query=query, reason=reason))
        return plan

    def _relevance_score(self, *, query: str, title: str, snippet: str, content: str) -> float:
        terms = [term for term in re.split(r"[^a-zA-Z0-9\u0600-\u06FF]+", query.lower()) if len(term) > 2]
        haystack = f"{title} {snippet} {content}".lower()
        matched = len({term for term in terms if term in haystack})
        base = matched / max(1, len(set(terms)))
        return round(min(1.0, 0.25 + base), 3)

    def _fallback_summary(self, report: ResearchReport) -> str:
        snippets: List[str] = []
        for item in report.evidence[:3]:
            fragment = item.content or item.snippet or item.title
            fragment = " ".join(fragment.split())[:180]
            if fragment:
                snippets.append(fragment)
        return " | ".join(snippets) or "Search completed with limited direct evidence."

    def _fallback_findings(self, report: ResearchReport) -> List[str]:
        findings: List[str] = []
        for item in report.evidence[:4]:
            fragment = item.snippet or item.title
            fragment = " ".join(fragment.split())[:140]
            if fragment and fragment not in findings:
                findings.append(fragment)
        return findings[:4]

    def _fallback_gaps(self, state: OrchestrationState) -> List[str]:
        gaps: List[str] = []
        if not state.user_context.get("valueProposition"):
            gaps.append("Value proposition is not explicit yet.")
        if not state.user_context.get("monetization"):
            gaps.append("Monetization path is still unspecified.")
        if not state.user_context.get("riskBoundary"):
            gaps.append("Risk boundary needs an explicit decision.")
        return gaps[:3]

    def _empty_structured_schema(self, *, context: Dict[str, Any], context_type: str) -> Dict[str, Any]:
        return {
            "idea": context.get("idea"),
            "category": context.get("category"),
            "location": context_location_label(context),
            "context_type": context_type,
            "summary": "",
            "market_presence": "",
            "price_range": "",
            "signals": [],
            "user_types": [],
            "complaints": [],
            "behaviors": [],
            "competition_reactions": [],
            "user_sentiment": {"positive": [], "negative": [], "neutral": []},
            "behavior_patterns": [],
            "gaps_in_market": [],
            "competition_level": "",
            "demand_level": "",
            "regulatory_risk": "",
            "price_sensitivity": "",
            "notable_locations": [],
            "gaps": [],
            "visible_insights": [],
            "expandable_reasoning": [],
            "confidence_score": 0.0,
            "sources": [],
            "evidence_count": 0,
            "quality": {},
        }

    def _merge_structured_schema(self, current: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
        merged = dict(current or {})
        for key in (
            "signals",
            "user_types",
            "complaints",
            "behaviors",
            "competition_reactions",
            "behavior_patterns",
            "gaps_in_market",
            "notable_locations",
            "gaps",
            "visible_insights",
            "expandable_reasoning",
        ):
            existing = [str(item).strip() for item in merged.get(key) or [] if str(item).strip()]
            additions = [str(item).strip() for item in incoming.get(key) or [] if str(item).strip()]
            merged[key] = list(dict.fromkeys(existing + additions))[:18]
        sentiment = merged.get("user_sentiment") if isinstance(merged.get("user_sentiment"), dict) else {}
        incoming_sentiment = incoming.get("user_sentiment") if isinstance(incoming.get("user_sentiment"), dict) else {}
        merged["user_sentiment"] = {
            label: list(
                dict.fromkeys(
                    [str(item).strip() for item in sentiment.get(label) or [] if str(item).strip()]
                    + [str(item).strip() for item in incoming_sentiment.get(label) or [] if str(item).strip()]
                )
            )[:12]
            for label in ("positive", "negative", "neutral")
        }
        for key in ("summary", "market_presence", "price_range", "competition_level", "demand_level", "regulatory_risk", "price_sensitivity"):
            if not str(merged.get(key) or "").strip():
                merged[key] = incoming.get(key)
            elif key == "summary" and str(incoming.get(key) or "").strip():
                merged[key] = str(merged.get(key) or "").strip() or str(incoming.get(key) or "").strip()
        try:
            merged["confidence_score"] = max(float(merged.get("confidence_score") or 0.0), float(incoming.get("confidence_score") or 0.0))
        except (TypeError, ValueError):
            merged["confidence_score"] = float(merged.get("confidence_score") or 0.0)
        if isinstance(incoming.get("quality"), dict):
            quality = dict(merged.get("quality") or {})
            quality.update(dict(incoming.get("quality") or {}))
            merged["quality"] = quality
        incoming_sources = incoming.get("sources") if isinstance(incoming.get("sources"), list) else []
        existing_sources = merged.get("sources") if isinstance(merged.get("sources"), list) else []
        keyed_sources = []
        seen_urls: set[str] = set()
        for source in existing_sources + incoming_sources:
            if not isinstance(source, dict):
                continue
            url = str(source.get("url") or "").strip()
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            keyed_sources.append(
                {
                    "title": str(source.get("title") or "").strip(),
                    "url": url,
                    "domain": str(source.get("domain") or "").strip(),
                }
            )
        merged["sources"] = keyed_sources[:12]
        return merged

    def _merge_evidence_into_structured(self, structured: Dict[str, Any], evidence: List[EvidenceItem]) -> Dict[str, Any]:
        merged = dict(structured or {})
        merged["evidence_count"] = len(evidence or [])
        if not str(merged.get("summary") or "").strip():
            merged["summary"] = self._fallback_summary(
                ResearchReport(
                    summary="",
                    evidence=list(evidence or []),
                )
            )
        existing_sources = merged.get("sources") if isinstance(merged.get("sources"), list) else []
        seen_urls = {str(item.get("url") or "").strip() for item in existing_sources if isinstance(item, dict)}
        for item in evidence[:8]:
            if not item.url or item.url in seen_urls:
                continue
            seen_urls.add(item.url)
            existing_sources.append(
                {
                    "title": item.title,
                    "url": item.url,
                    "domain": item.domain,
                }
            )
        merged["sources"] = existing_sources[:12]
        return merged

    def _structured_findings(self, structured: Dict[str, Any]) -> List[str]:
        findings: List[str] = []
        for key in ("visible_insights", "signals", "user_types", "complaints", "behaviors", "behavior_patterns", "competition_reactions", "gaps_in_market"):
            values = structured.get(key) if isinstance(structured.get(key), list) else []
            for value in values:
                text = str(value).strip()
                if text and text not in findings:
                    findings.append(text)
        sentiment = structured.get("user_sentiment") if isinstance(structured.get("user_sentiment"), dict) else {}
        for key in ("positive", "negative", "neutral"):
            for value in sentiment.get(key) or []:
                text = str(value).strip()
                if text and text not in findings:
                    findings.append(text)
        return findings[:12]

    def _allow_ai_estimation(self, state: OrchestrationState) -> bool:
        value = str(
            state.user_context.get("researchEstimationMode")
            or state.schema.get("research_estimation_mode")
            or ""
        ).strip().lower()
        if not value:
            return True
        if value in {"retry", "retry_search", "strict_web_only", "web_only", "manual_only"}:
            return False
        return value in {"ai", "ai_estimation", "use_ai_estimation", "estimated", "auto", "auto_ai"}

    def _research_contract_satisfied(self, report: ResearchReport) -> bool:
        structured = report.structured_schema if isinstance(report.structured_schema, dict) else {}
        if not str(structured.get("summary") or "").strip():
            return False
        required_scalars = ("competition_level", "demand_level", "price_sensitivity")
        if any(not str(structured.get(key) or "").strip() for key in required_scalars):
            return False
        sentiment = structured.get("user_sentiment") if isinstance(structured.get("user_sentiment"), dict) else {}
        sentiment_count = sum(
            len([str(item).strip() for item in sentiment.get(key, []) if str(item).strip()])
            for key in ("positive", "negative", "neutral")
        )
        signal_count = sum(
            len([str(item).strip() for item in structured.get(key) or [] if str(item).strip()])
            for key in ("signals", "complaints", "behaviors", "behavior_patterns", "gaps_in_market")
        )
        return sentiment_count >= 1 and signal_count >= 3

    def _fatal_search_failure(self, report: ResearchReport) -> bool:
        structured = report.structured_schema if isinstance(report.structured_schema, dict) else {}
        summary = str(structured.get("summary") or report.summary or "").strip()
        sentiment = structured.get("user_sentiment") if isinstance(structured.get("user_sentiment"), dict) else {}
        sentiment_count = sum(
            len([str(item).strip() for item in sentiment.get(key, []) if str(item).strip()])
            for key in ("positive", "negative", "neutral")
        )
        signal_count = sum(
            len([str(item).strip() for item in structured.get(key) or [] if str(item).strip()])
            for key in ("signals", "complaints", "behaviors", "behavior_patterns", "gaps_in_market")
        )
        return not report.evidence and not summary and sentiment_count == 0 and signal_count == 0

    def _research_is_insufficient(self, report: ResearchReport) -> bool:
        structured = report.structured_schema if isinstance(report.structured_schema, dict) else {}
        quality = report.quality if isinstance(report.quality, dict) else {}
        usable = int(quality.get("usable_sources") or 0)
        domains = int(quality.get("domains") or 0)
        confidence = float(structured.get("confidence_score") or 0.0)
        estimation_mode = str(structured.get("estimation_mode") or "").strip().lower()
        signal_count = sum(
            len([str(item).strip() for item in structured.get(key) or [] if str(item).strip()])
            for key in ("signals", "complaints", "behaviors", "behavior_patterns", "gaps_in_market")
        )
        sentiment_count = sum(
            len([str(item).strip() for item in (structured.get("user_sentiment") or {}).get(key, []) if str(item).strip()])
            for key in ("positive", "negative", "neutral")
        )
        if estimation_mode == "ai_estimation":
            return confidence < 0.38 or (signal_count + sentiment_count) < 6
        return usable < 2 or domains < 2 or confidence < 0.45 or (signal_count + sentiment_count) < 5

    async def _estimate_human_signals(self, state: OrchestrationState, report: ResearchReport) -> Dict[str, Any]:
        structured = report.structured_schema if isinstance(report.structured_schema, dict) else {}
        fallback = {
            "summary": str(structured.get("summary") or "").strip(),
            "market_presence": str(structured.get("market_presence") or "").strip() or "emerging",
            "price_range": str(structured.get("price_range") or "").strip(),
            "user_sentiment": dict(structured.get("user_sentiment") or {"positive": [], "negative": [], "neutral": []}),
            "signals": list(structured.get("signals") or []),
            "user_types": list(structured.get("user_types") or []),
            "complaints": list(structured.get("complaints") or []),
            "behaviors": list(structured.get("behaviors") or []),
            "competition_reactions": list(structured.get("competition_reactions") or []),
            "behavior_patterns": list(structured.get("behavior_patterns") or structured.get("behaviors") or []),
            "gaps_in_market": list(structured.get("gaps_in_market") or structured.get("gaps") or []),
            "competition_level": str(structured.get("competition_level") or "medium"),
            "demand_level": str(structured.get("demand_level") or "medium"),
            "regulatory_risk": str(structured.get("regulatory_risk") or "medium"),
            "price_sensitivity": str(structured.get("price_sensitivity") or "medium"),
            "notable_locations": list(structured.get("notable_locations") or []),
            "gaps": list(structured.get("gaps") or []),
            "visible_insights": list(structured.get("visible_insights") or []),
            "expandable_reasoning": list(structured.get("expandable_reasoning") or []),
            "confidence_score": max(0.35, float(structured.get("confidence_score") or 0.0)),
            "sources": list(structured.get("sources") or []),
        }
        payload = await self.runtime.llm.generate_json(
            prompt=(
                f"Idea: {state.user_context.get('idea')}\n"
                f"Category: {state.user_context.get('category')}\n"
                f"Location: {context_location_label(state.user_context)}\n"
                f"Audience: {', '.join(state.user_context.get('targetAudience') or [])}\n"
                f"Current summary: {report.summary}\n"
                f"Current findings: {' | '.join(report.findings[:8])}\n"
                f"Current structured schema: {structured}\n"
                "Fill only the missing human-signal fields cautiously. "
                "Return grounded JSON with the same schema and short Arabic signals. "
                "No fake numbers, no fake reviews, no certainty beyond the available context."
            ),
            system=(
                "You are a research intelligence engine. "
                "Infer realistic human signals from the idea, place, category, and weak search evidence. "
                "Keep outputs concrete, short, and persona-usable."
            ),
            temperature=0.2,
            fallback_json=fallback,
        )
        payload["market_presence"] = str(payload.get("market_presence") or fallback["market_presence"] or "emerging").strip()
        payload["competition_level"] = str(payload.get("competition_level") or fallback["competition_level"] or "medium").strip() or "medium"
        payload["demand_level"] = str(payload.get("demand_level") or fallback["demand_level"] or "medium").strip() or "medium"
        payload["price_sensitivity"] = str(payload.get("price_sensitivity") or fallback["price_sensitivity"] or "medium").strip() or "medium"
        payload["summary"] = str(payload.get("summary") or fallback["summary"] or "فيه اهتمام مبدئي لكن الإشارات المباشرة قليلة، فتم استكمال الصورة بتقدير منطقي من السياق.").strip()
        for key, default_values in {
            "signals": ["فيه اهتمام مبدئي لكن القرار حساس للسعر."],
            "complaints": ["الناس محتاجة عرض أوضح قبل الالتزام."],
            "behaviors": ["الناس بتقارن قبل ما تشتري."],
            "behavior_patterns": ["التجربة الصغيرة أسهل من الالتزام الكبير."],
            "gaps_in_market": ["فيه فرصة لعرض أوضح وأسهل في التجربة."],
            "gaps": ["ما زلنا نحتاج إشارات مباشرة أكثر من السوق."],
            "visible_insights": ["المعطيات الحية قليلة، فتم استكمالها بتقدير منخفض الثقة."],
            "expandable_reasoning": ["تم الاعتماد على الفكرة والسوق المحلي والإشارات الضعيفة المتاحة لبناء صورة أولية قابلة للاستخدام downstream."],
        }.items():
            values = payload.get(key)
            cleaned = [str(item).strip() for item in values] if isinstance(values, list) else []
            payload[key] = cleaned or list(default_values)
        sentiment = payload.get("user_sentiment") if isinstance(payload.get("user_sentiment"), dict) else {}
        payload["user_sentiment"] = {
            "positive": [str(item).strip() for item in sentiment.get("positive", []) if str(item).strip()] or ["فيه فضول مبدئي لو العرض كان واضح."],
            "negative": [str(item).strip() for item in sentiment.get("negative", []) if str(item).strip()] or ["السعر أو الالتزام الكبير ممكن يبطّأ القرار."],
            "neutral": [str(item).strip() for item in sentiment.get("neutral", []) if str(item).strip()] or ["الناس غالبًا هتحتاج تجربة بسيطة الأول."],
        }
        payload["confidence_score"] = min(0.64, max(float(payload.get("confidence_score") or 0.0), 0.42))
        return payload

    async def _pause_for_research_review(self, state: OrchestrationState, report: ResearchReport) -> None:
        state.pending_input = True
        state.pending_input_kind = "research_review"
        state.pending_resume_phase = SimulationPhase.INTERNET_RESEARCH.value
        state.status = SimulationStatus.PAUSED.value
        state.status_reason = "paused_research_review"
        state.error = "ملقيتش بيانات كفاية عن المنطقة دي"
        state.clarification_questions = [
            ClarificationQuestion(
                question_id="research_review",
                field_name="research_review",
                prompt="ملقيتش بيانات كفاية عن المنطقة دي. تحب نعيد البحث ولا نستخدم AI estimation؟",
                reason=" | ".join((report.structured_schema or {}).get("visible_insights") or report.gaps or ["limited_research_signal"])[:280],
                required=True,
                options=["retry", "use_ai_estimation"],
            )
        ]
        if getattr(self.runtime, "event_bus", None) is not None:
            await self.runtime.event_bus.publish(
                state,
                "research_insufficient",
                {
                    "agent": self.name,
                    "message": "ملقيتش بيانات كفاية عن المنطقة دي",
                    "visible_insights": list((report.structured_schema or {}).get("visible_insights") or []),
                    "confidence_score": float((report.structured_schema or {}).get("confidence_score") or 0.0),
                },
            )
