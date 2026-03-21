from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.agents.search_agent import SearchAgent  # noqa: E402
from app.models.orchestration import OrchestrationState, SimulationPhase  # noqa: E402
from app.orchestrator import SimulationOrchestrator  # noqa: E402


def _runtime(llm: object | None = None, event_bus: object | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        dataset=None,
        llm=llm or SimpleNamespace(generate_json=AsyncMock(return_value={})),
        event_bus=event_bus or SimpleNamespace(publish=AsyncMock()),
        repository=None,
    )


def _state() -> OrchestrationState:
    return OrchestrationState(
        simulation_id="sim-research",
        user_id=None,
        user_context={
            "idea": "توصيل بقالة سريع",
            "category": "consumer apps",
            "city": "الهرم",
            "language": "ar",
            "targetAudience": ["families"],
        },
    )


def _low_signal_result() -> dict:
    return {
        "provider": "stub",
        "quality": {"usable_sources": 1, "domains": 1, "extraction_success_rate": 0.2},
        "results": [
            {
                "title": "Example result",
                "url": "https://example.com/1",
                "domain": "example.com",
                "snippet": "خدمة توصيل موجودة لكن التفاصيل محدودة.",
            }
        ],
        "structured": {
            "summary": "المعطيات محدودة.",
            "market_presence": "common",
            "competition_level": "high",
            "price_range": "",
            "user_sentiment": {"positive": [], "negative": ["الناس بتشتكي من الرسوم"], "neutral": []},
            "signals": ["البيانات قليلة"],
            "user_types": ["أسر"],
            "complaints": ["الرسوم"],
            "behaviors": ["مقارنة الأسعار"],
            "competition_reactions": [],
            "behavior_patterns": ["مقارنة الأسعار"],
            "gaps_in_market": [],
            "demand_level": "medium",
            "regulatory_risk": "medium",
            "price_sensitivity": "high",
            "notable_locations": ["الهرم"],
            "gaps": ["محتاجين إشارات مباشرة أكتر"],
            "visible_insights": ["المنافسة عالية في المنطقة"],
            "expandable_reasoning": ["المعطيات الحالية جاية من مصدر واحد فقط."],
            "confidence_score": 0.22,
            "sources": [{"title": "Example result", "url": "https://example.com/1", "domain": "example.com"}],
        },
    }


class ResearchIntelligenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_agent_auto_estimates_when_data_is_thin_by_default(self) -> None:
        agent = SearchAgent(_runtime())
        state = _state()
        with patch("app.agents.search_agent.search_web", AsyncMock(return_value=_low_signal_result())), patch(
            "app.agents.search_agent.fetch_page",
            AsyncMock(return_value={"ok": True, "title": "Example", "content": "limited content", "http_status": 200}),
        ):
            await agent.run(state)
        self.assertFalse(state.pending_input)
        self.assertIsNone(state.pending_input_kind)
        self.assertTrue(state.search_completed)
        self.assertEqual(state.schema.get("research_estimation_mode"), "ai_estimation")
        self.assertIn("used_ai_estimation_due_to_weak_search", state.schema.get("research_warnings") or [])
        self.assertIn("research_visible_insights", state.schema)

    async def test_search_agent_uses_ai_estimation_when_user_requested_it(self) -> None:
        llm = SimpleNamespace(
            generate_json=AsyncMock(
                return_value={
                    "summary": "الناس في الهرم بتدور على بديل أوضح سعرًا وأسهل في الطلب.",
                    "market_presence": "common",
                    "price_range": "متوسط إلى مرتفع",
                    "user_sentiment": {
                        "positive": ["فيه اهتمام بسرعة التوصيل"],
                        "negative": ["الناس بتضايق من الرسوم"],
                        "neutral": ["فيه ناس لسه بتقارن"],
                    },
                    "signals": ["فيه حساسية واضحة للسعر"],
                    "user_types": ["أسر", "شباب شغالين"],
                    "complaints": ["الرسوم", "عدم وضوح السعر النهائي"],
                    "behaviors": ["مقارنة الأسعار", "انتظار الخصومات"],
                    "competition_reactions": ["الناس بتروح للأرخص"],
                    "behavior_patterns": ["مقارنة الأسعار", "طلب متكرر وقت العروض"],
                    "gaps_in_market": ["عروض أوضح ورسوم أبسط"],
                    "competition_level": "high",
                    "demand_level": "medium",
                    "regulatory_risk": "medium",
                    "price_sensitivity": "high",
                    "notable_locations": ["الهرم"],
                    "gaps": ["لسه محتاجين إشارات مباشرة أكتر"],
                    "visible_insights": ["الناس حساسة للسعر في الهرم"],
                    "expandable_reasoning": ["النتائج المباشرة قليلة، فتم استخدام تقدير منطقي مبني على السياق المحلي."],
                    "confidence_score": 0.5,
                    "sources": [],
                }
            )
        )
        agent = SearchAgent(_runtime(llm=llm))
        state = _state()
        state.user_context["researchEstimationMode"] = "ai_estimation"
        with patch("app.agents.search_agent.search_web", AsyncMock(return_value=_low_signal_result())), patch(
            "app.agents.search_agent.fetch_page",
            AsyncMock(return_value={"ok": True, "title": "Example", "content": "limited content", "http_status": 200}),
        ):
            await agent.run(state)
        self.assertFalse(state.pending_input)
        self.assertTrue(state.search_completed)
        self.assertEqual(state.research.structured_schema.get("estimation_mode"), "ai_estimation")
        self.assertIn("user_sentiment", state.research.structured_schema)
        self.assertIn("behavior_patterns", state.research.structured_schema)

    async def test_search_agent_pauses_only_when_retry_mode_disables_ai_estimation(self) -> None:
        agent = SearchAgent(_runtime())
        state = _state()
        state.user_context["researchEstimationMode"] = "retry"
        with patch("app.agents.search_agent.search_web", AsyncMock(return_value=_low_signal_result())), patch(
            "app.agents.search_agent.fetch_page",
            AsyncMock(return_value={"ok": True, "title": "Example", "content": "limited content", "http_status": 200}),
        ):
            await agent.run(state)
        self.assertTrue(state.pending_input)
        self.assertEqual(state.pending_input_kind, "research_review")
        self.assertEqual(state.status_reason, "paused_research_review")
        self.assertFalse(state.search_completed)

    async def test_orchestrator_routes_research_review_answer_to_ai_estimation(self) -> None:
        orchestrator = SimulationOrchestrator.__new__(SimulationOrchestrator)
        state = _state()
        state.pending_input = True
        state.pending_input_kind = "research_review"
        state.pending_resume_phase = SimulationPhase.INTERNET_RESEARCH.value
        orchestrator.get_state = AsyncMock(return_value=state)
        orchestrator.repository = SimpleNamespace(save_state=AsyncMock())
        scheduled: list[tuple[str, SimulationPhase, bool]] = []
        orchestrator._schedule = lambda simulation_id, phase, force=False: scheduled.append((simulation_id, phase, force))
        result = await orchestrator.answer_clarifications(state.simulation_id, [{"answer": "use AI estimation"}])
        self.assertIs(result, state)
        self.assertEqual(state.user_context.get("researchEstimationMode"), "ai_estimation")
        self.assertEqual(state.current_phase, SimulationPhase.INTERNET_RESEARCH)
        self.assertFalse(state.pending_input)
        self.assertTrue(scheduled and scheduled[0][2] is True)


if __name__ == "__main__":
    unittest.main()
