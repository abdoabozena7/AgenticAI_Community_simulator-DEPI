from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.agents.clarification_agent import ClarificationAgent  # noqa: E402
from app.agents.persona_agent import PersonaAgent  # noqa: E402
from app.agents.search_agent import SearchAgent  # noqa: E402
from app.agents.simulation_agent import SimulationAgent  # noqa: E402
from app.models.orchestration import (  # noqa: E402
    ChangeImpact,
    EvidenceItem,
    OrchestrationState,
    PersonaProfile,
    SimulationPhase,
)
from app.orchestrator import SimulationOrchestrator  # noqa: E402


def _repository() -> SimpleNamespace:
    return SimpleNamespace(
        upsert_persona_library_record=AsyncMock(return_value=None),
        fetch_persona_library_record=AsyncMock(
            return_value={
                "id": 11,
                "set_key": "set-11",
                "place_key": "giza-haram",
                "place_label": "Giza, Haram",
                "audience_filters": ["professionals"],
                "created_at": None,
                "updated_at": None,
            }
        ),
        fetch_persona_library_record_by_set_key=AsyncMock(return_value=None),
        persist_personas=AsyncMock(return_value=None),
        sync_persona_states=AsyncMock(return_value=None),
        persist_metrics=AsyncMock(return_value=None),
        save_state=AsyncMock(return_value=None),
        create_run=AsyncMock(return_value=None),
        finalize_run=AsyncMock(return_value=None),
    )


def _runtime() -> SimpleNamespace:
    return SimpleNamespace(
        dataset=SimpleNamespace(rules_by_pair={}),
        llm=SimpleNamespace(generate_json=AsyncMock(return_value={})),
        event_bus=SimpleNamespace(publish=AsyncMock(return_value=None), publish_turn=AsyncMock(return_value=None)),
        repository=_repository(),
    )


def _state() -> OrchestrationState:
    return OrchestrationState(
        simulation_id="sim-flow",
        user_id=None,
        user_context={
            "idea": "اشتراك أسبوعي لوجبات صحية سريعة لموظفين الشركات",
            "category": "consumer apps",
            "country": "Egypt",
            "city": "Giza",
            "location": "Haram, Faisal",
            "targetAudience": ["professionals"],
            "minimumPersonaThreshold": 15,
            "language": "ar",
            "agentCount": 30,
        },
    )


def _search_result() -> dict:
    return {
        "provider": "stub-search",
        "quality": {"usable_sources": 4, "domains": 4, "extraction_success_rate": 0.9},
        "results": [
            {
                "title": "Healthy office lunch demand",
                "url": "https://example.com/1",
                "domain": "example.com",
                "snippet": "الموظفون بيدوروا على أكل أسرع وأنضف وسعره واضح.",
            },
            {
                "title": "Competitor pricing",
                "url": "https://example.org/2",
                "domain": "example.org",
                "snippet": "الاشتراكات المرنة سعرها أوضح من الباكدجات الثقيلة.",
            },
        ],
        "structured": {
            "summary": "فيه طلب واضح على وجبات منظمة للموظفين في الجيزة، لكن السعر والتميّز أهم نقطتين.",
            "market_presence": "established but fragmented",
            "competition_level": "high",
            "price_range": "متوسط إلى مرتفع",
            "user_sentiment": {
                "positive": ["الناس بتحب الطلب السريع والواضح", "واتساب كبداية مقبول"],
                "negative": ["السعر حساس", "الناس بتقارن بالعروض الأرخص"],
                "neutral": ["الاشتراك الأسبوعي محتاج شرح أوضح"],
            },
            "signals": [
                "احتياج لوجبات سريعة منظمة للموظفين",
                "حساسية واضحة للسعر في الهرم وفيصل",
                "واتساب مناسب كبداية خفيفة",
                "التميّز مهم بسبب كثرة البدائل",
                "الباكدجات المرنة أسهل في القبول من الاشتراك الثقيل",
                "الموظفون يقدّرون التوصيل المنتظم",
            ],
            "user_types": ["office workers", "busy employees", "health-conscious workers"],
            "complaints": ["السعر العالي", "عدم وضوح فرق القيمة", "الرسوم الإضافية"],
            "behaviors": ["مقارنة الأسعار", "الطلب من واتساب", "اختيار الباقة المرنة"],
            "competition_reactions": ["التحول لبديل أرخص", "الطلب من المطاعم العادية عند غياب الفرق"],
            "behavior_patterns": ["مقارنة الأسعار", "الاشتراك التجريبي أولًا", "الاعتماد على القناة الأسهل"],
            "gaps_in_market": ["عرض اشتراك بسيط للموظفين", "تسعير أوضح", "تمييز عن المطاعم العادية"],
            "demand_level": "medium",
            "regulatory_risk": "medium",
            "price_sensitivity": "high",
            "notable_locations": ["Haram", "Faisal"],
            "gaps": ["needs a clearer value promise"],
            "visible_insights": ["المنافسة عالية لكن فيه طلب لو العرض كان أوضح"],
            "expandable_reasoning": ["الإشارات متوافقة عبر السعر، السرعة، والبدائل المتاحة."],
            "confidence_score": 0.82,
            "sources": [
                {"title": "Healthy office lunch demand", "url": "https://example.com/1", "domain": "example.com"},
                {"title": "Competitor pricing", "url": "https://example.org/2", "domain": "example.org"},
            ],
        },
    }


def _page(title: str, content: str, status: int = 200) -> dict:
    return {"ok": True, "title": title, "content": content, "http_status": status}


def _signal_plan() -> dict:
    return {
        "evidence_signals": [f"signal-{index}" for index in range(1, 31)],
        "user_types": ["office workers", "busy employees", "health-conscious workers"],
        "complaints": ["السعر العالي", "عدم وضوح فرق القيمة", "الرسوم الإضافية"],
        "behaviors": ["مقارنة الأسعار", "الطلب من واتساب", "اختيار الباقة المرنة"],
        "competition_reactions": ["التحول لبديل أرخص", "الطلب من المطاعم العادية"],
        "social_sentiment": {
            "overall": "mixed",
            "price_sensitivity": "high",
            "trust": "medium",
            "notable_themes": ["السعر", "الوضوح", "المرونة"],
        },
        "signal_catalog": [
            {
                "id": f"sig-{index}",
                "type": "signals",
                "text": f"signal-{index}",
                "source_kind": "research_signal",
                "source_ref": f"https://example.com/{index}",
            }
            for index in range(1, 31)
        ],
        "audience_clusters": [
            {
                "cluster": "Office Workers",
                "roles": ["account manager", "operations lead", "analyst", "sales coordinator"],
                "motivations": ["time savings", "predictable food", "easy ordering"],
                "concerns": ["السعر العالي", "عدم وضوح الفرق", "الالتزام الأسبوعي"],
                "speaking_styles": ["concise", "direct", "practical"],
                "age_bands": ["24-30", "28-35", "30-40"],
                "life_stages": ["early career", "mid career", "working adult"],
                "source_kind": "research_signal",
                "signal_refs": ["sig-1", "sig-2", "sig-3"],
            },
            {
                "cluster": "Busy Employees",
                "roles": ["project manager", "HR specialist", "customer support", "team leader"],
                "motivations": ["convenience", "routine", "reliable delivery"],
                "concerns": ["التكلفة", "ملل الباقة", "التنظيم"],
                "speaking_styles": ["simple", "value-focused", "structured"],
                "age_bands": ["25-34", "30-39", "35-44"],
                "life_stages": ["career building", "mid career", "parenting"],
                "source_kind": "research_signal",
                "signal_refs": ["sig-4", "sig-5", "sig-6"],
            },
            {
                "cluster": "Health Conscious Workers",
                "roles": ["consultant", "designer", "developer", "operations analyst"],
                "motivations": ["healthier routine", "clarity", "consistency"],
                "concerns": ["السعر", "الطعم", "ضعف التميّز"],
                "speaking_styles": ["calm", "curious", "direct"],
                "age_bands": ["24-32", "29-37", "31-42"],
                "life_stages": ["early career", "mid career", "habit builder"],
                "source_kind": "research_signal",
                "signal_refs": ["sig-7", "sig-8", "sig-9"],
            },
        ],
    }


def _persona(index: int, *, source_kind: str = "research_signal", opinion: str = "neutral") -> PersonaProfile:
    clusters = [
        ("Office Workers", "account manager", "24-30", "early career", "concise"),
        ("Busy Employees", "project manager", "30-39", "mid career", "structured"),
        ("Health Conscious Workers", "designer", "29-37", "habit builder", "curious"),
    ]
    cluster, role, age_band, life_stage, speaking_style = clusters[index % len(clusters)]
    return PersonaProfile(
        persona_id=f"persona-{index}",
        name=f"Persona {index}",
        source_mode="research_signal" if index % 2 == 0 else "hybrid",
        target_audience_cluster=cluster,
        location_context="Giza, Haram, Faisal",
        age_band=age_band,
        life_stage=life_stage,
        profession_role=role,
        attitude_baseline="reacts through documented signals",
        skepticism_level=0.35 + ((index % 4) * 0.1),
        conformity_level=0.22 + ((index % 3) * 0.15),
        stubbornness_level=0.18 + ((index % 5) * 0.11),
        innovation_openness=0.3 + ((index % 4) * 0.13),
        financial_sensitivity=0.45 + ((index % 4) * 0.1),
        speaking_style=speaking_style,
        tags=["research-grounded", "giza", "office"],
        source_attribution={
            "kind": source_kind,
            "signal_refs": [f"sig-{(index % 9) + 1}"],
            "source_ref": [f"https://example.com/{(index % 9) + 1}"],
            "evidence_signals": [f"signal-{(index % 30) + 1}"],
        },
        evidence_signals=[f"signal-{(index % 30) + 1}"],
        category_id="consumer",
        template_id="template",
        archetype_name=cluster,
        summary="Research-grounded persona",
        motivations=["time savings", "clarity"],
        concerns=["السعر العالي", "عدم وضوح الفرق"],
        location="Giza",
        opinion=opinion,
        confidence=0.5,
        influence_weight=1.0,
        traits={"cluster_id": f"cluster-{index % 3}", "question_drive": 0.4},
        biases=[],
        opinion_score=0.0,
    )


class PipelineStabilizationTests(unittest.IsolatedAsyncioTestCase):
    async def test_scenario_a_location_flow_reaches_reasoning_with_auto_source_resolution(self) -> None:
        runtime = _runtime()
        search_agent = SearchAgent(runtime)
        persona_agent = PersonaAgent(runtime)
        simulation_agent = SimulationAgent(runtime)
        state = _state()
        state.idea_context_type = "location_based"

        with patch("app.agents.search_agent.search_web", AsyncMock(return_value=_search_result())), patch(
            "app.agents.search_agent.fetch_page",
            AsyncMock(side_effect=[
                _page("Healthy office lunch demand", "الموظفون في الجيزة يقارنون السعر والسرعة."),
                _page("Competitor pricing", "الاشتراك المرن أوضح قبولًا من الباقة الثقيلة."),
            ] * 4),
        ):
            await search_agent.run(state)

        self.assertTrue(state.search_completed)
        self.assertTrue(state.research and state.research.structured_schema.get("confidence_score", 0) >= 0.45)

        personas = [_persona(index) for index in range(30)]
        with patch.object(persona_agent, "_build_signal_plan", AsyncMock(return_value=_signal_plan())), patch.object(
            persona_agent,
            "_generate_personas",
            AsyncMock(
                return_value=(
                    personas,
                    {
                        "message": "Generated 30 personas from structured research.",
                        "quality_score": 0.86,
                        "confidence_score": 0.79,
                        "duplicate_rejection_count": 0,
                        "batch_size": 10,
                        "batch_count": 3,
                        "source_summary": "Signals were strong enough to build research-grounded personas.",
                        "evidence_signals": [f"signal-{index}" for index in range(1, 13)],
                        "user_types": ["office workers", "busy employees", "health-conscious workers"],
                        "complaints": ["السعر العالي", "عدم وضوح الفرق"],
                        "behaviors": ["مقارنة الأسعار", "الطلب من واتساب"],
                        "competition_reactions": ["التحول لبديل أرخص"],
                        "quality_meta": {"coverage": "high"},
                    },
                )
            ),
        ):
            await persona_agent.run(state)
        await persona_agent.persist(state)

        self.assertEqual(state.persona_source_mode, "generate_new_from_search")
        self.assertTrue(state.persona_source_auto_selected)
        self.assertTrue(state.persona_generation_completed)
        self.assertTrue(state.persona_persistence_completed)
        self.assertEqual(state.validate_pipeline_ready_for_simulation(), [])

        await simulation_agent.initialize_simulation(state)
        await simulation_agent.run_deliberation(state)

        self.assertGreater(len(state.argument_bank), 0)
        self.assertGreater(len(state.dialogue_turns), 0)
        self.assertGreaterEqual(int(state.deliberation_state.get("iteration") or 0), 3)

    async def test_scenario_b_weak_search_still_produces_structured_low_confidence_state(self) -> None:
        runtime = _runtime()
        search_agent = SearchAgent(runtime)
        state = _state()
        state.idea_context_type = "location_based"

        weak_result = {
            "provider": "stub-search",
            "quality": {"usable_sources": 1, "domains": 1, "extraction_success_rate": 0.25},
            "results": [
                {
                    "title": "Thin result",
                    "url": "https://weak.example.com/1",
                    "domain": "weak.example.com",
                    "snippet": "نتيجة ضعيفة ومحدودة.",
                }
            ],
            "structured": {
                "summary": "فيه إشارة مبدئية بس البيانات لسه ضعيفة.",
                "market_presence": "unclear",
                "competition_level": "medium",
                "price_range": "",
                "user_sentiment": {"positive": ["فيه فضول مبدئي"], "negative": ["المشهد مش واضح"], "neutral": []},
                "signals": ["فيه فضول مبدئي"],
                "complaints": ["المعلومة قليلة"],
                "behaviors": ["الناس بتسأل قبل ما تلتزم"],
                "behavior_patterns": ["تجربة صغيرة الأول"],
                "gaps_in_market": [],
                "gaps": ["research signal is still thin"],
                "visible_insights": ["الإشارات الحالية غير كافية لبناء قرار قوي."],
                "confidence_score": 0.22,
                "sources": [{"title": "Thin result", "url": "https://weak.example.com/1", "domain": "weak.example.com"}],
            },
        }

        with patch("app.agents.search_agent.search_web", AsyncMock(return_value=weak_result)), patch(
            "app.agents.search_agent.fetch_page",
            AsyncMock(return_value=_page("Thin result", "محتوى محدود جدًا")),
        ):
            await search_agent.run(state)

        self.assertTrue(state.search_completed)
        self.assertIsNotNone(state.research)
        assert state.research is not None
        self.assertLess(float(state.research.structured_schema.get("confidence_score") or 0.0), 0.65)
        self.assertEqual(state.schema.get("research_estimation_mode"), "ai_estimation")
        self.assertIn("used_ai_estimation_due_to_weak_search", state.schema.get("research_warnings") or [])
        self.assertFalse(state.pending_input)

        public = state.to_public_state()
        self.assertTrue(public["pipeline"]["ready_for_simulation"] is False or isinstance(public["pipeline"]["warnings"], list))
        self.assertEqual(
            public["pipeline"]["blockers"],
            ["persona_generation_not_finished", "persona_count_zero"],
        )
        self.assertIn("research_insufficient_for_personas", public["pipeline"]["warnings"])
        self.assertEqual(public["schema"].get("research_estimation_mode"), "ai_estimation")

    async def test_scenario_c_clarification_is_asked_once_then_not_repeated(self) -> None:
        state = _state()
        state.search_completed = True
        state.persona_generation_completed = True
        state.persona_persistence_completed = True
        state.personas = [_persona(index) for index in range(18)]
        state.research = SimpleNamespace(gaps=["monetization path is still unclear"], structured_schema={})
        state.persona_generation_debug = {
            "validation": {
                "fatal_errors": [],
                "simulation_blockers": [],
                "warnings": [],
                "actual_count": 18,
            }
        }
        state.refresh_persona_source_resolution()

        clarification_agent = ClarificationAgent(_runtime())
        await clarification_agent.run(state)

        self.assertTrue(state.pending_input)
        self.assertEqual(len(state.clarification_questions), 1)
        question_id = state.clarification_questions[0].question_id

        orchestrator = SimulationOrchestrator.__new__(SimulationOrchestrator)
        orchestrator.get_state = AsyncMock(return_value=state)
        orchestrator.repository = SimpleNamespace(save_state=AsyncMock())
        orchestrator._schedule = lambda *_args, **_kwargs: None
        await orchestrator.answer_clarifications(state.simulation_id, [{"question_id": question_id, "answer": "اشتراك مرن على حسب عدد الوجبات"}])

        await clarification_agent.run(state)
        self.assertFalse(state.pending_input)
        self.assertEqual(state.clarification_questions, [])
        self.assertEqual(state.user_context.get("monetization"), "اشتراك مرن على حسب عدد الوجبات")

    async def test_scenario_d_location_change_invalidates_only_downstream_and_can_reach_reasoning_again(self) -> None:
        runtime = _runtime()
        simulation_agent = SimulationAgent(runtime)
        state = _state()
        state.idea_context_type = "location_based"
        state.search_completed = True
        state.persona_generation_completed = True
        state.persona_persistence_completed = True
        state.personas = [_persona(index) for index in range(20)]
        state.persona_generation_debug = {
            "validation": {"fatal_errors": [], "simulation_blockers": [], "warnings": [], "actual_count": 20}
        }
        state.refresh_persona_source_resolution()
        state.current_phase = SimulationPhase.AGENT_DELIBERATION

        orchestrator = SimulationOrchestrator.__new__(SimulationOrchestrator)
        orchestrator.get_state = AsyncMock(return_value=state)
        orchestrator.repository = SimpleNamespace(save_state=AsyncMock())
        orchestrator.event_bus = SimpleNamespace(publish=AsyncMock())
        scheduled: list[tuple[str, SimulationPhase, bool]] = []
        orchestrator._schedule = lambda simulation_id, phase, force=False: scheduled.append((simulation_id, phase, force))

        result = await orchestrator.apply_context_update(
            state.simulation_id,
            {"city": "Cairo", "location": "Maadi"},
        )
        assert result is not None
        updated_state, impact, rollback_phase = result
        self.assertEqual(impact, ChangeImpact.MAJOR)
        self.assertEqual(rollback_phase, SimulationPhase.CONTEXT_CLASSIFICATION)
        self.assertFalse(updated_state.search_completed)
        self.assertFalse(updated_state.persona_generation_completed)
        self.assertFalse(updated_state.persona_persistence_completed)
        self.assertEqual(updated_state.user_context.get("city"), "Cairo")
        self.assertTrue(scheduled and scheduled[0][1] == SimulationPhase.CONTEXT_CLASSIFICATION)

        updated_state.search_completed = True
        updated_state.persona_generation_completed = True
        updated_state.persona_persistence_completed = True
        updated_state.personas = [_persona(index, opinion="neutral") for index in range(20)]
        updated_state.persona_generation_debug = {
            "validation": {"fatal_errors": [], "simulation_blockers": [], "warnings": [], "actual_count": 20}
        }
        updated_state.refresh_persona_source_resolution()
        await simulation_agent.initialize_simulation(updated_state)
        await simulation_agent.run_deliberation(updated_state)
        self.assertGreater(len(updated_state.dialogue_turns), 0)

    def test_scenario_e_warning_only_persona_validation_still_allows_simulation(self) -> None:
        state = _state()
        state.search_completed = True
        state.persona_generation_completed = True
        state.persona_persistence_completed = True
        state.personas = [_persona(index) for index in range(18)]
        state.persona_generation_debug = {
            "validation": {
                "fatal_errors": [],
                "simulation_blockers": [],
                "warnings": ["insufficient_data_for_full_diversity"],
                "actual_count": 18,
            }
        }
        state.refresh_persona_source_resolution()
        blockers = state.validate_pipeline_ready_for_simulation()
        self.assertEqual(blockers, [])
        self.assertTrue(state.simulation_ready)
        self.assertIn("insufficient_data_for_full_diversity", (state.schema.get("pipeline_status") or {}).get("warnings", []))

    def test_pipeline_public_state_surfaces_exact_blocker_details(self) -> None:
        state = _state()
        state.search_completed = True
        state.persona_generation_completed = True
        state.persona_persistence_completed = True
        state.persona_generation_debug = {
            "validation": {
                "fatal_errors": [],
                "simulation_blockers": ["persona_count_below_simulation_minimum"],
                "warnings": [],
                "actual_count": 10,
            }
        }
        public = state.to_public_state()
        self.assertEqual(public["pipeline"]["blockers"], ["persona_count_below_simulation_minimum"])
        self.assertEqual(public["pipeline"]["blocked_phase"], "persona_generation")
        self.assertTrue(public["pipeline"]["blocker_details"])
        self.assertIn("minimum", public["pipeline"]["blocker_details"][0]["message"].lower())


if __name__ == "__main__":
    unittest.main()
