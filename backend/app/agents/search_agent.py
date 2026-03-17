from __future__ import annotations

import re
from typing import Any, Dict, List

from ..core.page_fetch import fetch_page
from ..core.web_search import search_web
from ..models.orchestration import EvidenceItem, OrchestrationState, ResearchQuery, ResearchReport, context_location_label
from .base import BaseAgent


class SearchAgent(BaseAgent):
    name = "search_agent"

    async def run(self, state: OrchestrationState) -> OrchestrationState:
        context = state.user_context
        query_plan = self._build_query_plan(context)
        report = ResearchReport(query_plan=query_plan)
        seen_urls: set[str] = set()

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
                report.findings = [str(item) for item in structured.get("signals") or [] if str(item).strip()][:6]
                report.gaps = [str(item) for item in structured.get("gaps") or [] if str(item).strip()][:4]
                report.structured_schema = structured

            for item in top_results[:3]:
                url = str(item.get("url") or "").strip()
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                page = await fetch_page(url)
                evidence = EvidenceItem(
                    query=planned_query.query,
                    title=str(item.get("title") or page.get("title") or "").strip(),
                    url=url,
                    domain=str(item.get("domain") or "").strip(),
                    snippet=str(item.get("snippet") or "").strip(),
                    content=str(page.get("content") or "").strip(),
                    relevance_score=self._relevance_score(
                        query=planned_query.query,
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
                        "cycle_id": cycle_id,
                        "query": planned_query.query,
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
                        "meta": {"provider": result.get("provider"), "query_reason": planned_query.reason},
                    },
                    persist_research=True,
                )

        report.evidence = sorted(report.evidence, key=lambda item: item.relevance_score, reverse=True)[:8]
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
            "summary": report.summary,
            "findings": report.findings,
            "gaps": report.gaps,
            "evidence_count": len(report.evidence),
            "quality": report.quality,
        }
        state.research = report
        state.schema.update(
            {
                "idea": context.get("idea"),
                "category": context.get("category"),
                "location": context_location_label(context),
                "research_summary": report.summary,
                "research_findings": list(report.findings),
                "research_gaps": list(report.gaps),
            }
        )
        return state

    def _build_query_plan(self, context: Dict[str, Any]) -> List[ResearchQuery]:
        idea = str(context.get("idea") or "").strip()
        category = str(context.get("category") or "").strip()
        location = context_location_label(context)
        audience = ", ".join(context.get("targetAudience") or [])
        goals = ", ".join(context.get("goals") or [])
        seeds = [
            (
                "market demand and operating evidence",
                "Establish whether real demand, pricing, and execution constraints are visible online.",
            ),
            (
                "competition and alternatives",
                "Find adjacent solutions and public comparisons before personas are generated.",
            ),
            (
                "regulation, safety, and trust concerns",
                "Surface risks early so clarification questions can target real gaps instead of generic prompts.",
            ),
        ]
        plan: List[ResearchQuery] = []
        for suffix, reason in seeds:
            query = " ".join(part for part in [idea, category, location, audience, goals, suffix] if part).strip()
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
        return " | ".join(snippets)

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
