from __future__ import annotations

import asyncio
import time
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.agents.persona_agent import PersonaAgent  # noqa: E402
from app.core import db as db_core  # noqa: E402
from app.core import persona_lab as persona_lab_core  # noqa: E402
from app.models.orchestration import (  # noqa: E402
    EvidenceItem,
    IdeaContextType,
    OrchestrationState,
    PersonaProfile,
    PersonaSourceMode,
    ResearchReport,
    context_location_label,
    normalize_context,
    resolve_persona_source_mode,
)
from app.services.evidence_ladder import build_research_evidence_ladder  # noqa: E402


def _agent() -> PersonaAgent:
    return PersonaAgent(SimpleNamespace(dataset=None, llm=None, event_bus=None, repository=None))


def _state() -> OrchestrationState:
    return OrchestrationState(
        simulation_id="sim-test",
        user_id=None,
        user_context={
            "idea": "Local grocery delivery for busy families",
            "category": "consumer apps",
            "location": "Cairo",
            "targetAudience": ["parents"],
            "agentCount": 24,
            "minimumPersonaThreshold": 15,
            "language": "en",
        },
    )


def _research_report() -> ResearchReport:
    evidence = [
        EvidenceItem(
            query="q",
            title=f"title-{index}",
            url=f"https://example.com/{index}",
            domain="example.com",
            snippet=f"snippet-{index}",
            content="",
            relevance_score=0.8,
            http_status=200,
        )
        for index in range(6)
    ]
    return ResearchReport(
        evidence=evidence,
        findings=["parents compare prices", "delivery fees trigger complaints"],
        summary="Parents compare prices, complain about fees, and watch competitors closely.",
        structured_schema={
            "signals": ["delivery fees trigger complaints", "parents compare prices before purchase"],
            "user_types": ["working parents", "household buyers", "budget-conscious families"],
            "complaints": ["delivery fees", "slow support", "missing items", "price spikes"],
            "behaviors": ["comparison shopping", "repeat ordering", "promo chasing", "group recommendations"],
            "competition_reactions": ["switch to cheaper rivals", "delay purchase until discounts"],
            "price_sensitivity": "high",
        },
    )


def _signal_plan() -> dict:
    return {
        "evidence_signals": ["delivery fees trigger complaints", "parents compare prices before purchase"],
        "user_types": ["working parents", "household buyers", "budget-conscious families"],
        "complaints": ["delivery fees", "slow support", "missing items", "price spikes"],
        "behaviors": ["comparison shopping", "repeat ordering", "promo chasing", "group recommendations"],
        "competition_reactions": ["switch to cheaper rivals", "delay purchase until discounts"],
        "audience_clusters": [
            {
                "cluster": "Working Parents",
                "roles": ["school administrator", "household manager", "parent"],
                "motivations": ["family convenience", "value for money", "reliability"],
                "concerns": ["delivery fees", "missing items", "slow support"],
                "speaking_styles": ["clear", "practical", "protective and practical"],
                "age_bands": ["30-44", "35-49", "40-54"],
                "life_stages": ["raising children", "family balancing", "caregiver"],
                "source_kind": "hybrid",
                "signal_refs": ["sig-fees", "sig-compare"],
                "segment_id": "working-parents",
                "archetype_name": "Working Professionals",
                "price_sensitivity_bucket": "high",
                "decision_style": "price-first",
                "purchase_triggers": ["family convenience", "clear value"],
                "rejection_triggers": ["delivery fees", "missing items"],
            },
            {
                "cluster": "Household Buyers",
                "roles": ["subscriber", "local shopper", "household buyer"],
                "motivations": ["convenience", "habit fit", "trust"],
                "concerns": ["price spikes", "quality inconsistency", "hidden fees"],
                "speaking_styles": ["simple and comparative", "value-focused", "experience-led"],
                "age_bands": ["25-34", "30-44", "35-49"],
                "life_stages": ["habit builder", "household buyer", "family balancing"],
                "source_kind": "research_signal",
                "signal_refs": ["sig-price", "sig-demand"],
                "segment_id": "household-buyers",
                "archetype_name": "Consumers",
                "price_sensitivity_bucket": "medium",
                "decision_style": "comparison-led",
                "purchase_triggers": ["convenience", "trust"],
                "rejection_triggers": ["price spikes", "quality inconsistency"],
            },
            {
                "cluster": "Promo Chasers",
                "roles": ["consumer", "subscriber", "local shopper"],
                "motivations": ["discounts", "low friction", "clear value"],
                "concerns": ["delivery fees", "unclear value", "price spikes"],
                "speaking_styles": ["direct", "fast and casual", "concise and practical"],
                "age_bands": ["22-29", "25-34", "30-44"],
                "life_stages": ["early career", "household buyer", "habit builder"],
                "source_kind": "research_signal",
                "signal_refs": ["sig-promo", "sig-fees"],
                "segment_id": "promo-chasers",
                "archetype_name": "Gen Z",
                "price_sensitivity_bucket": "high",
                "decision_style": "discount-first",
                "purchase_triggers": ["discounts", "low friction"],
                "rejection_triggers": ["delivery fees", "unclear value"],
            },
        ],
        "dynamic_segments": [],
        "market_grounding": {
            "competition_level": "high",
            "price_sensitivity": "high",
            "local_objections": ["delivery fees", "price spikes"],
        },
        "signal_catalog": [
            {"id": "sig-fees", "type": "complaints", "text": "delivery fees", "source_kind": "research_signal", "source_ref": "https://example.com/1"},
            {"id": "sig-compare", "type": "behaviors", "text": "comparison shopping", "source_kind": "research_signal", "source_ref": "https://example.com/2"},
            {"id": "sig-price", "type": "complaints", "text": "price spikes", "source_kind": "research_signal", "source_ref": "https://example.com/3"},
            {"id": "sig-demand", "type": "user_types", "text": "household buyers", "source_kind": "research_signal", "source_ref": "https://example.com/4"},
            {"id": "sig-promo", "type": "behaviors", "text": "promo chasing", "source_kind": "research_signal", "source_ref": "https://example.com/5"},
        ],
    }


def _persona(index: int) -> PersonaProfile:
    cluster = ["Working Parents", "Household Buyers", "Promo Chasers"][index % 3]
    signal = ["delivery fees", "comparison shopping", "price spikes"][index % 3]
    return PersonaProfile(
        persona_id=f"persona-{index}",
        name=f"Persona {index}",
        source_mode="research_signal" if index % 2 == 0 else "hybrid",
        target_audience_cluster=cluster,
        segment_id=["working-parents", "household-buyers", "promo-chasers"][index % 3],
        location_context="Cairo",
        age_band=["30-44", "35-49", "25-34"][index % 3],
        life_stage=["family balancing", "raising children", "habit builder"][index % 3],
        profession_role=["parent", "household manager", "subscriber"][index % 3],
        attitude_baseline="reacts through documented signals",
        skepticism_level=0.4,
        conformity_level=0.35,
        stubbornness_level=0.3,
        innovation_openness=0.5,
        financial_sensitivity=0.72,
        speaking_style=["clear", "value-focused", "direct"][index % 3],
        tags=["research-grounded", "family", "price-aware"],
        source_attribution={
            "kind": "research_signal",
            "signal_refs": ["sig-fees"],
            "source_ref": ["https://example.com/1"],
            "evidence_signals": [signal],
        },
        evidence_signals=[signal],
        category_id="consumer",
        template_id="template-1",
        archetype_name=cluster,
        summary="Research-grounded persona summary",
        motivations=["family convenience", "value for money"],
        concerns=["delivery fees", "price spikes"],
        location="Cairo",
        price_sensitivity_bucket="high" if index % 2 == 0 else "medium",
        decision_style=["price-first", "comparison-led", "discount-first"][index % 3],
        purchase_trigger=["family convenience", "trust", "discounts"][index % 3],
        rejection_trigger=["delivery fees", "quality inconsistency", "price spikes"][index % 3],
        opinion="neutral",
        confidence=0.5,
        influence_weight=1.0,
        traits={"cluster_id": f"cluster-{index % 3}", "skepticism": 0.4},
        biases=["loss aversion"],
        opinion_score=0.0,
    )


class PersonaPipelineTests(unittest.IsolatedAsyncioTestCase):
    def test_coverage_target_is_based_on_dynamic_segments(self) -> None:
        agent = _agent()
        state = _state()
        state.research = _research_report()
        target = agent._coverage_target_count(state, signal_plan=_signal_plan(), requested_count=24)
        self.assertEqual(target, 15)

    def test_validation_blocks_simulation_but_not_persistence_for_low_count(self) -> None:
        agent = _agent()
        state = _state()
        state.research = _research_report()
        personas = [_persona(index) for index in range(12)]
        validation = agent._validate_personas(
            personas=personas,
            signal_plan=_signal_plan(),
            state=state,
            target_count=12,
            strict_target=False,
        )
        self.assertEqual(validation["fatal_errors"], [])
        self.assertIn("persona_count_below_simulation_minimum", validation["simulation_blockers"])
        self.assertTrue(validation["persistence_allowed"])

    def test_build_market_grounding_and_source_type_are_dynamic(self) -> None:
        agent = _agent()
        state = _state()
        state.research = _research_report()
        structured_inputs = agent._structured_persona_inputs(state)
        grounding = agent.build_market_grounding(
            state=state,
            place_label="Cairo",
            structured_inputs=structured_inputs,
            memory_context={"recurring_objections": ["hidden fees"], "stable_behaviors": ["comparison shopping"]},
            saved_persona_hints=[],
        )
        self.assertEqual(grounding["competition_level"], "medium")
        self.assertIn("delivery fees", grounding["local_objections"])
        self.assertEqual(agent._source_type_label(state), "dynamic_hybrid")

    def test_signal_fitted_blueprints_include_dynamic_fields(self) -> None:
        agent = _agent()
        state = _state()
        state.research = _research_report()
        signal_plan = _signal_plan()
        signal_plan["dynamic_segments"] = list(signal_plan["audience_clusters"])
        rows = agent._signal_fitted_blueprints(state, signal_plan, 2)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row.get("segment_id") for row in rows))
        self.assertTrue(all(row.get("decision_style") for row in rows))
        self.assertTrue(all(row.get("purchase_trigger") for row in rows))
        self.assertTrue(all(row.get("rejection_trigger") for row in rows))

    def test_signal_catalog_and_source_attribution_support_optional_evidence_ladder(self) -> None:
        agent = _agent()
        state = _state()
        state.research = _research_report()

        with self.subTest("with evidence ladder"):
            state.research.structured_schema["evidence_ladder"] = build_research_evidence_ladder(
                evidence=state.research.evidence,
                structured=state.research.structured_schema,
                timestamp_ms=1234567890,
                estimated=False,
            )
            structured_inputs = agent._structured_persona_inputs(state)
            signal_catalog = agent._signal_catalog_from_state(state)
            source_attribution = agent._build_source_attribution(
                state=state,
                signal_plan={**_signal_plan(), "signal_catalog": signal_catalog},
                cluster="Working Parents",
                evidence_signals=["delivery fees", "comparison shopping"],
                raw_kind="research_signal",
            )

            self.assertIn("evidence_ladder", structured_inputs)
            self.assertTrue(structured_inputs["evidence_ladder"])
            self.assertTrue(signal_catalog)
            self.assertTrue(any(item.get("evidence_refs") for item in signal_catalog if isinstance(item, dict)))
            self.assertTrue(any(str(item.get("why_it_matters") or "").strip() for item in signal_catalog if isinstance(item, dict)))
            self.assertEqual(source_attribution["kind"], "research_signal")
            self.assertTrue(source_attribution["signal_refs"])
            self.assertTrue(source_attribution["source_ref"])
            self.assertEqual(source_attribution["evidence_signals"], ["delivery fees", "comparison shopping"])
            self.assertTrue(source_attribution["evidence_refs"])

        with self.subTest("without evidence ladder"):
            state.research = _research_report()
            self.assertNotIn("evidence_ladder", state.research.structured_schema)
            structured_inputs = agent._structured_persona_inputs(state)
            signal_catalog = agent._signal_catalog_from_state(state)
            source_attribution = agent._build_source_attribution(
                state=state,
                signal_plan={**_signal_plan(), "signal_catalog": signal_catalog},
                cluster="Working Parents",
                evidence_signals=["delivery fees", "comparison shopping"],
                raw_kind="research_signal",
            )

            self.assertIn("evidence_ladder", structured_inputs)
            self.assertEqual(structured_inputs["evidence_ladder"], [])
            self.assertTrue(signal_catalog)
            self.assertTrue(all(not item.get("evidence_refs") for item in signal_catalog if isinstance(item, dict)))
            self.assertTrue(all(not str(item.get("why_it_matters") or "").strip() for item in signal_catalog if isinstance(item, dict)))
            self.assertEqual(source_attribution["kind"], "research_signal")
            self.assertTrue(source_attribution["signal_refs"])
            self.assertTrue(source_attribution["source_ref"])
            self.assertEqual(source_attribution["evidence_signals"], ["delivery fees", "comparison shopping"])
            self.assertEqual(source_attribution["evidence_refs"], [])

    async def test_build_dynamic_segments_returns_fallback_after_budget_expires(self) -> None:
        runtime = SimpleNamespace(
            dataset=None,
            llm=SimpleNamespace(generate_json=AsyncMock(side_effect=self._slow_llm_json)),
            event_bus=None,
            repository=None,
        )
        agent = PersonaAgent(runtime)
        state = _state()
        state.research = _research_report()
        structured_inputs = agent._structured_persona_inputs(state)
        market_grounding = agent.build_market_grounding(
            state=state,
            place_label="Cairo",
            structured_inputs=structured_inputs,
            memory_context={},
            saved_persona_hints=[],
        )

        with patch.object(PersonaAgent, "LLM_CALL_BUDGET_SECONDS", 0.01):
            started = time.perf_counter()
            payload = await agent.build_dynamic_segments(
                state=state,
                place_label="Cairo",
                structured_inputs=structured_inputs,
                market_grounding=market_grounding,
            )
            elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 0.2)
        self.assertTrue(payload["audience_clusters"])
        self.assertGreater(payload["confidence_score"], 0.0)

    async def test_build_signal_plan_returns_fallback_after_budget_expires(self) -> None:
        runtime = SimpleNamespace(
            dataset=None,
            llm=SimpleNamespace(generate_json=AsyncMock(side_effect=self._slow_llm_json)),
            event_bus=None,
            repository=None,
        )
        agent = PersonaAgent(runtime)
        state = _state()
        state.research = _research_report()

        with patch.object(PersonaAgent, "LLM_CALL_BUDGET_SECONDS", 0.01):
            started = time.perf_counter()
            payload = await agent._build_signal_plan(
                state=state,
                place_label="Cairo",
                memory_context={},
                saved_persona_hints=[],
            )
            elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 0.2)
        self.assertTrue(payload["audience_clusters"])
        self.assertEqual(payload["audience_clusters"], payload["dynamic_segments"])
        self.assertTrue(payload["evidence_signals"])

    async def test_run_auto_completes_persona_shortfall_before_blocking_simulation(self) -> None:
        runtime = SimpleNamespace(
            dataset=None,
            llm=SimpleNamespace(generate_json=AsyncMock(return_value={})),
            event_bus=SimpleNamespace(publish=AsyncMock(return_value=None)),
            repository=None,
        )
        agent = PersonaAgent(runtime)
        state = _state()
        state.research = _research_report()
        state.search_completed = True
        state.persona_source_mode = PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value
        state.persona_source_auto_selected = True

        sparse_personas = []
        for index in range(6):
            persona = _persona(index)
            persona.target_audience_cluster = "Working Parents"
            persona.segment_id = "working-parents"
            sparse_personas.append(persona)

        sparse_signal_plan = _signal_plan()
        sparse_signal_plan["audience_clusters"] = [dict(_signal_plan()["audience_clusters"][0])]
        sparse_signal_plan["dynamic_segments"] = [dict(_signal_plan()["audience_clusters"][0])]

        with patch.object(agent, "_build_signal_plan", AsyncMock(return_value=sparse_signal_plan)), patch.object(
            agent,
            "_generate_personas",
            AsyncMock(
                return_value=(
                    sparse_personas,
                    {
                        "message": "Initial persona pass produced only a sparse set.",
                        "quality_score": 0.41,
                        "confidence_score": 0.44,
                        "duplicate_rejection_count": 0,
                        "batch_size": 10,
                        "batch_count": 1,
                        "source_summary": "Sparse research output.",
                        "evidence_signals": list(sparse_signal_plan["evidence_signals"]),
                        "user_types": list(sparse_signal_plan["user_types"]),
                        "complaints": list(sparse_signal_plan["complaints"]),
                        "behaviors": list(sparse_signal_plan["behaviors"]),
                        "competition_reactions": list(sparse_signal_plan["competition_reactions"]),
                        "quality_meta": {"coverage": "low"},
                    },
                )
            ),
        ):
            await agent.run(state)

        validation = dict((state.persona_generation_debug or {}).get("validation") or {})
        auto_completion = dict((state.persona_generation_debug or {}).get("auto_completion") or {})
        self.assertTrue(auto_completion.get("attempted"))
        self.assertGreaterEqual(len(state.personas), state.schema.get("minimum_persona_threshold", 15))
        self.assertEqual(validation.get("simulation_blockers"), [])
        self.assertGreaterEqual(len({persona.segment_id for persona in state.personas if persona.segment_id}), 3)

    def test_pipeline_blockers_use_validation_snapshot(self) -> None:
        state = _state()
        state.search_completed = True
        state.persona_generation_completed = True
        state.persona_persistence_completed = True
        state.persona_generation_debug = {
            "validation": {
                "actual_count": 12,
                "simulation_blockers": ["persona_count_below_simulation_minimum", "diversity_score_below_threshold"],
            }
        }
        blockers = state.pipeline_blockers()
        self.assertIn("persona_count_below_simulation_minimum", blockers)
        self.assertIn("diversity_score_below_threshold", blockers)

    async def test_persona_lab_filters_reusable_assets(self) -> None:
        rows = [
            {"set_key": "a", "source_type": "audience", "reusable": True},
            {"set_key": "b", "source_type": "place", "reusable": True},
            {"set_key": "c", "source_type": "audience", "reusable": False},
        ]
        with patch.object(persona_lab_core.db_core, "list_persona_library_records", AsyncMock(return_value=rows)):
            items = await persona_lab_core.list_persona_sets(
                user_id=1,
                source_type="audience",
                reusable_only=True,
                limit=20,
            )
        self.assertEqual([item["set_key"] for item in items], ["a"])

    async def test_hydrated_persona_set_exposes_dataset_metadata(self) -> None:
        row = {
            "id": 10,
            "set_key": "set-10",
            "creator_user_id": 7,
            "place_key": "cairo",
            "place_label": "Cairo",
            "audience_key": "parents",
            "audience_filters_json": '["parents"]',
            "scope": "shared",
            "shared_asset": 1,
            "source_mode": "generate_new_from_search",
            "context_type": "hybrid",
            "source_summary": "signals",
            "evidence_summary_json": "{}",
            "generation_config_json": "{}",
            "quality_score": 0.81,
            "confidence_score": 0.77,
            "quality_meta_json": "{}",
            "validation_meta_json": "{}",
            "reusable_dataset_ref": "fingerprint",
            "persona_count": 18,
            "payload_json": '{"meta":{"source_type":"hybrid","place_name":"Cairo","audience_type":"parents","reusable":true}}',
            "created_at": None,
            "updated_at": None,
        }
        with patch.object(db_core, "execute", AsyncMock(return_value=[])):
            hydrated = await db_core._hydrate_persona_set_row(row)
        self.assertEqual(hydrated["source_type"], "hybrid")
        self.assertEqual(hydrated["place_name"], "Cairo")
        self.assertEqual(hydrated["audience_type"], "parents")
        self.assertTrue(hydrated["reusable"])

    def test_normalize_context_treats_place_name_as_location_present(self) -> None:
        context = normalize_context(
            {
                "idea": "Neighborhood cafe",
                "place_name": "الهرم",
                "category": "consumer apps",
            }
        )
        self.assertEqual(context["place_name"], "الهرم")
        self.assertEqual(context["location"], "الهرم")
        self.assertEqual(context_location_label(context), "الهرم")
        mode, auto_selected = resolve_persona_source_mode(context, context_type=IdeaContextType.GENERAL_NON_LOCATION)
        self.assertEqual(mode, PersonaSourceMode.GENERATE_NEW_FROM_SEARCH.value)
        self.assertTrue(auto_selected)
    async def _slow_llm_json(self, *args: object, **kwargs: object) -> dict:
        await asyncio.sleep(0.05)
        return {"audience_clusters": [], "confidence_score": 0.0}


if __name__ == "__main__":
    unittest.main()
