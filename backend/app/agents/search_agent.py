from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from ..core.page_fetch import fetch_page
from ..core.web_search import search_web
from ..models.orchestration import (
    EvidenceItem,
    IdeaContextType,
    OrchestrationState,
    ResearchQuery,
    ResearchReport,
    classify_idea_context,
    context_location_label,
)
from .base import BaseAgent


class SearchAgent(BaseAgent):
    name = "search_agent"

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        context = state.user_context
        context_type = state.idea_context_type or classify_idea_context(context).value
        query_plan = self._build_query_plan(context=context, context_type=context_type)
        report = ResearchReport(query_plan=query_plan)
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
                strict_web_only=True,
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
            report.quality = dict(result.get("quality") or report.quality)
            structured = result.get("structured") or {}
            if isinstance(structured, dict) and not report.summary:
                report.summary = str(structured.get("summary") or "").strip()
                report.findings = [str(item) for item in structured.get("signals") or [] if str(item).strip()][:8]
                report.gaps = [str(item) for item in structured.get("gaps") or [] if str(item).strip()][:5]
                report.structured_schema = structured

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
            if evidence.title or evidence.content or evidence.snippet:
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
        if not report.summary:
            report.summary = self._fallback_summary(report)
        if not report.findings:
            report.findings = self._fallback_findings(report)
        if not report.gaps:
            report.gaps = self._fallback_gaps(state)
        report.structured_schema = {
            "idea": context.get("idea"),
            "category": context.get("category"),
            "location": context_location_label(context),
            "context_type": context_type,
            "summary": report.summary,
            "findings": report.findings,
            "gaps": report.gaps,
            "evidence_count": len(report.evidence),
            "quality": report.quality,
        }
        state.research = report
        state.search_completed = True
        state.schema.update(
            {
                "idea": context.get("idea"),
                "category": context.get("category"),
                "location": context_location_label(context),
                "context_type": context_type,
                "research_summary": report.summary,
                "research_findings": list(report.findings),
                "research_gaps": list(report.gaps),
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
                "status": "ok",
                "progress_pct": 100,
                "meta": {"query_count": len(query_plan), "evidence_count": len(report.evidence)},
                "snippet": report.summary[:320],
            },
            persist_research=True,
        )
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
