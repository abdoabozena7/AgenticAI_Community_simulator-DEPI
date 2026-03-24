from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.agents.report_agent import ReportAgent  # noqa: E402
from app.models.orchestration import DialogueTurn, OrchestrationState  # noqa: E402
from app.services.event_bus import EventBus  # noqa: E402
from app.services.simulation_repository import SimulationRepository  # noqa: E402


class ReportingAndEventTests(unittest.IsolatedAsyncioTestCase):
    async def test_event_bus_persists_normalized_simulation_events(self) -> None:
        repository = SimpleNamespace(
            save_state=AsyncMock(),
            persist_research_event=AsyncMock(),
            persist_dialogue_turn=AsyncMock(),
            persist_simulation_event=AsyncMock(),
        )
        broadcaster = AsyncMock()
        bus = EventBus(broadcaster=broadcaster, repository=repository)
        state = OrchestrationState(
            simulation_id="sim-events",
            user_id=None,
            user_context={"idea": "healthy meals", "category": "food"},
        )

        await bus.publish(
            state,
            "context_classified",
            {"agent": "orchestrator", "context_type": "location_based"},
        )
        turn = DialogueTurn(
            step_uid="turn-1",
            iteration=1,
            phase="agent_deliberation",
            agent_id="agent-1",
            agent_name="Agent 1",
            reply_to_agent_id=None,
            reply_to_agent_name=None,
            message="I care about affordability.",
            stance_before="neutral",
            stance_after="reject",
            confidence=0.62,
            influence_delta=0.18,
        )
        await bus.publish_turn(state, turn)

        self.assertEqual(repository.persist_simulation_event.await_count, 2)
        first_call = repository.persist_simulation_event.await_args_list[0]
        self.assertEqual(first_call.kwargs["event_type"], "context_classified")
        second_call = repository.persist_simulation_event.await_args_list[1]
        self.assertEqual(second_call.kwargs["event_type"], "dialogue_turn")
        self.assertEqual(second_call.kwargs["step_uid"], "turn-1")
        self.assertEqual(state.schema.get("event_log_status"), "active")
        self.assertEqual(state.schema.get("event_log_count"), 2)
        broadcast_payload = broadcaster.await_args_list[-1].args[0]
        self.assertEqual(broadcast_payload["type"], "reasoning_step")
        self.assertEqual(broadcast_payload["agent_label"], "Agent 1")
        self.assertEqual(broadcast_payload["opinion"], "reject")

    async def test_report_agent_builds_structured_report_and_updates_schema(self) -> None:
        runtime = SimpleNamespace(
            llm=SimpleNamespace(
                generate_json=AsyncMock(
                    return_value={
                        "strengths": ["Strong convenience signal"],
                        "weaknesses": ["Price sensitivity is high"],
                        "success_probability": 0.67,
                        "success_score": 67,
                        "best_places": ["Giza"],
                        "key_risks": ["Weak differentiation"],
                        "top_objections": ["Why weekly subscription?"],
                        "top_positive_signals": ["WhatsApp ordering feels easy"],
                        "recommended_first_move": "Test a smaller starter package with 5 office workers.",
                        "confidence_notes": ["Research is usable but still partly estimated."],
                    }
                )
            )
        )
        agent = ReportAgent(runtime)
        state = OrchestrationState(
            simulation_id="sim-report",
            user_id=None,
            user_context={"idea": "healthy meal plan", "category": "food", "city": "Giza", "language": "ar"},
        )
        state.summary = "Simulation completed with mixed but promising signals."
        state.metrics = {"acceptance_rate": 0.64, "accepted": 8, "rejected": 3, "neutral": 2, "iteration": 3, "total_agents": 13}
        state.schema["research_estimated"] = True

        report = await agent.build_report(state)

        self.assertEqual(report["success_score"], 67)
        self.assertIn("Strong convenience signal", report["strengths"])
        self.assertEqual(state.schema.get("report_status"), "ready")
        self.assertEqual(state.schema.get("final_report"), report)

    async def test_repository_can_export_ndjson_event_log(self) -> None:
        repository = SimulationRepository()
        repository.fetch_event_log = AsyncMock(
            return_value=[
                {"event_seq": 1, "event_type": "phase_started", "payload": {"phase": "internet_research"}},
                {"event_seq": 2, "event_type": "search_completed", "payload": {"provider": "duckduckgo"}},
            ]
        )

        exported = await repository.export_event_log("sim-export", format="ndjson")

        lines = [line for line in exported.splitlines() if line.strip()]
        self.assertEqual(len(lines), 2)
        self.assertIn('"event_type": "phase_started"', lines[0])
        self.assertIn('"event_type": "search_completed"', lines[1])


if __name__ == "__main__":
    unittest.main()
