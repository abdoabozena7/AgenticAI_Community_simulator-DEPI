from __future__ import annotations

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
            },
        ],
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
        opinion="neutral",
        confidence=0.5,
        influence_weight=1.0,
        traits={"cluster_id": f"cluster-{index % 3}", "skepticism": 0.4},
        biases=["loss aversion"],
        opinion_score=0.0,
    )


class PersonaPipelineTests(unittest.IsolatedAsyncioTestCase):
    def test_target_count_requires_30_when_research_is_sufficient(self) -> None:
        agent = _agent()
        state = _state()
        state.research = _research_report()
        self.assertTrue(agent._has_enough_data(state))
        self.assertGreaterEqual(agent._target_persona_count(state), 30)

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


if __name__ == "__main__":
    unittest.main()
