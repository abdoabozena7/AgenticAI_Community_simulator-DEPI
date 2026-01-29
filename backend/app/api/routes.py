"""
REST API routes for the social simulation backend.

This module defines endpoints to start a simulation and retrieve final
metrics. The simulation runs asynchronously in the background and
emits events over WebSocket as it progresses. State is cached in
memory so clients can poll the REST API for the latest snapshot when
WebSocket connectivity is unavailable.
"""

from __future__ import annotations

import asyncio
from datetime import datetime
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, status

from ..core.dataset_loader import Dataset
from ..simulation.engine import SimulationEngine
from ..core.ollama_client import generate_ollama
from ..core.context_store import save_context
from ..api.websocket import manager
from pathlib import Path
import hashlib


router = APIRouter(prefix="/simulation")

# Global dictionaries to track simulation tasks, results, and live state
_simulation_tasks: Dict[str, asyncio.Task] = {}
_simulation_results: Dict[str, Dict[str, Any]] = {}
_simulation_state: Dict[str, Dict[str, Any]] = {}

# Reference to the loaded dataset (set in main module at startup)
dataset: Optional[Dataset] = None


def _init_state(simulation_id: str) -> None:
    """Initialise the in-memory state container for a new simulation."""
    _simulation_state[simulation_id] = {
        "agents": [],
        "reasoning": [],
        "metrics": None,
        "summary": None,
        "summary_ready": False,
        "summary_at": None,
    }


def _store_event(simulation_id: str, event_type: str, data: Dict[str, Any]) -> None:
    """Update the cached state for the given simulation.

    Depending on the event type, the relevant portion of the state is
    updated. For reasoning steps, only the most recent 200 entries are
    retained to bound memory usage.
    """
    state = _simulation_state.setdefault(
        simulation_id,
        {"agents": [], "reasoning": [], "metrics": None, "summary": None, "summary_ready": False, "summary_at": None},
    )
    if event_type == "agents":
        state["agents"] = data.get("agents", [])
    elif event_type == "metrics":
        state["metrics"] = data
    elif event_type == "reasoning_step":
        reasoning = state["reasoning"]
        reasoning.append(data)
        # Trim to last 200 events
        if len(reasoning) > 200:
            state["reasoning"] = reasoning[-200:]


def _analyze_rejectors(reasoning: list[Dict[str, Any]], language: str) -> str:
    reject_msgs = [step.get("message", "") for step in reasoning if step.get("opinion") == "reject"]
    if not reject_msgs:
        return ""
    text_blob = " ".join(reject_msgs).lower()

    themes = {
        "competition": ["competition", "crowded", "saturated", "many similar", "?????", "??????", "????", "????", "?????? ????"],
        "trust": ["trust", "privacy", "data", "security", "?????", "??????", "??????", "????"],
        "regulation": ["regulation", "compliance", "legal", "liability", "?????", "??????", "?????", "???????"],
        "economics": ["cost", "price", "roi", "margin", "??????", "???", "?????", "????", "???"],
        "feasibility": ["feasible", "implementation", "maintenance", "scale", "?????", "?????", "?????", "????"],
        "adoption": ["adoption", "behavior", "usage", "????", "????", "????", "???????"],
    }

    hits = []
    for key, keywords in themes.items():
        if any(k in text_blob for k in keywords):
            hits.append(key)

    if not hits:
        hits = ["trust", "feasibility"]

    if language == "ar":
        advice_map = {
            "competition": "???? ????? ?? ???????? ?????? ???? ????? ????? ?? ?????? ??/????? ??? ????????.",
            "trust": "???? ????? ??? ????? ????? ????????? ?????? ????????? ??????? ????????? ?????.",
            "regulation": "???? ??? ?????? ????? ?????? ??????? ?????? ??????? ?????????.",
            "economics": "???? ????? ????? ???????? ???????? ????? ?? ??????? ?????? ???????.",
            "feasibility": "???? ??? ????? ?????? ?????? ????? ?? ????? ???????.",
            "adoption": "???? ??? ????? ????? ?????????? ??? ????? ????? ?????? ?????.",
        }
        tips = " ".join(advice_map[k] for k in hits[:2])
        return f"????? ?????? ?????????: {tips}"

    advice_map_en = {
        "competition": "Address competition by highlighting a unique differentiator or targeting a less crowded location.",
        "trust": "Build trust with clear privacy, data protection, and safety guarantees.",
        "regulation": "Provide a concrete compliance plan to reduce regulatory risk.",
        "economics": "Clarify ROI and pricing so the value clearly outweighs cost.",
        "feasibility": "Show a realistic execution and maintenance plan with phased rollout.",
        "adoption": "Explain how you will drive adoption with simple UX and clear incentives.",
    }
    tips = " ".join(advice_map_en[k] for k in hits[:2])
    return f"Advice to persuade rejecters: {tips}"



async def _build_summary(user_context: Dict[str, Any], metrics: Dict[str, Any], reasoning: list[Dict[str, Any]]) -> str:
    idea = user_context.get("idea", "")
    research_summary = user_context.get("research_summary", "")
    language = str(user_context.get("language") or "ar").lower()
    accepted = metrics.get("accepted", 0)
    rejected = metrics.get("rejected", 0)
    neutral = metrics.get("neutral", 0)
    acceptance_rate = metrics.get("acceptance_rate", 0.0)
    polarization = metrics.get("polarization", 0.0)
    per_category = metrics.get("per_category", {})
    sample_reasoning = " | ".join([step.get("message", "") for step in reasoning[-6:]])

    rejecter_advice = _analyze_rejectors(reasoning, language)

    response_language = "Arabic" if language == "ar" else "English"
    prompt = (
        "You are summarising a multi-agent market simulation. "
        "Write 8-12 short sentences in a friendly, human tone. "
        "Explicitly list 2-3 pros and 2-3 cons. "
        "Add a brief viability judgment (realistic vs risky) and 1-2 alternatives or pivots. "
        "Mention acceptance rate, polarization, and key concerns. "
        "Give a realistic recommendation (improve, validate, or proceed). "
        "End with a short, targeted advice to persuade the rejecting segment. "
        f"Idea: {idea}\n"
        f"Research context: {research_summary}\n"
        f"Metrics: accepted={accepted}, rejected={rejected}, neutral={neutral}, "
        f"acceptance_rate={acceptance_rate:.2f}, polarization={polarization:.2f}\n"
        f"Category acceptance counts: {per_category}\n"
        f"Sample reasoning: {sample_reasoning}\n"
        f"Rejecter advice seed: {rejecter_advice}\n"
        f"Respond in {response_language}.\n"
    )
    try:
        summary = await generate_ollama(prompt=prompt, temperature=0.3)
        return f"{summary}\n\n{rejecter_advice}" if rejecter_advice else summary
    except Exception:
        if language == "ar":
            if acceptance_rate >= 0.6:
                base = (
                    "الانطباع العام إيجابي. أبرز الإيجابيات: وضوح القيمة، قابلية التنفيذ، وإمكانية توسع السوق. "
                    "أما السلبيات: مخاطر الامتثال، ثقة المستخدمين، وبعض الشكوك حول الجدوى التشغيلية. "
                    "يوصى بتجربة نموذج صغير مع مؤشرات أداء واضحة قبل التوسع."
)
                return f"{base}\n{rejecter_advice}" if rejecter_advice else base
            if acceptance_rate >= 0.35:
                base = (
                    "الآراء متباينة. الإيجابيات تشمل فائدة محتملة ونقطة تميز واضحة، لكن السلبيات تدور حول المخاطر "
                    "والثقة والجدوى المالية. من الأفضل تقليص النطاق، وتأكيد الدليل العملي، وتجربة سوق محدود أولاً."
)
                return f"{base}\n{rejecter_advice}" if rejecter_advice else base
            base = (
                "معظم الوكلاء متحفظون حالياً. الإيجابيات قليلة مقارنة بالسلبيات التي تشمل مخاطر الامتثال والثقة "
                "وضعف الدليل العملي. يُنصح بتعديل الفكرة وبناء مصداقية أقوى قبل الاستثمار."
)
            return f"{base}\n{rejecter_advice}" if rejecter_advice else base
        if acceptance_rate >= 0.6:
            base = (
                "Overall feedback is positive. Pros: clear value, feasible execution, and promising market pull. "
                "Cons: compliance risk, trust concerns, and operational uncertainty. "
                "Recommendation: validate with a small pilot and tighten safeguards before scaling."
)
            return f"{base}\n{rejecter_advice}" if rejecter_advice else base
        if acceptance_rate >= 0.35:
            base = (
                "Feedback is mixed. Pros include potential adoption and differentiation. "
                "Cons include risk, trust, and unclear economics. "
                "Recommendation: refine scope, add safeguards, and test with a narrow segment."
)
            return f"{base}\n{rejecter_advice}" if rejecter_advice else base
        base = (
            "Most agents are skeptical right now. Pros are limited, while cons include risk, feasibility, and trust. "
            "Recommendation: simplify the promise and build credibility before further investment."
)
        return f"{base}\n{rejecter_advice}" if rejecter_advice else base


@router.post("/start")
async def start_simulation(user_context: Dict[str, Any]) -> Dict[str, Any]:
    """Initialise a new simulation.

    Accepts user-provided context (structured data) and kicks off a
    background simulation. Returns a unique simulation identifier so
    clients can subscribe to WebSocket updates or poll the REST API.
    """
    global dataset
    if dataset is None:
        raise HTTPException(status_code=500, detail="Dataset not loaded")
    # Generate a unique ID for this simulation
    simulation_id = str(uuid.uuid4())
    _init_state(simulation_id)
    try:
        save_context(simulation_id, user_context)
    except Exception:
        # Persistence is best-effort; ignore failures.
        pass
    # Create a simulation engine instance
    engine = SimulationEngine(dataset=dataset)

    async def emitter(event_type: str, data: Dict[str, Any]) -> None:
        """Broadcast events and store a snapshot for polling."""
        payload = {"type": event_type, **data}
        # Broadcast to all connected WebSocket clients
        await manager.broadcast_json(payload)
        # Persist state for REST polling
        _store_event(simulation_id, event_type, data)

    # Define a coroutine that runs the simulation and stores results
    async def run_and_store() -> None:
        try:
            result = await engine.run_simulation(user_context=user_context, emitter=emitter)
            _simulation_results[simulation_id] = result
            summary = await _build_summary(
                user_context=user_context,
                metrics=result,
                reasoning=_simulation_state.get(simulation_id, {}).get("reasoning", []),
            )
            state = _simulation_state.setdefault(simulation_id, {})
            state["summary"] = summary
            state["summary_ready"] = True
            state["summary_at"] = datetime.utcnow().isoformat() + "Z"
            # Broadcast summary explicitly for clients that listen on WS.
            await manager.broadcast_json({"type": "summary", "summary": summary})
        except Exception as exc:  # noqa: BLE001
            _simulation_state.setdefault(simulation_id, {})["error"] = str(exc)
    # Launch simulation in background
    task = asyncio.create_task(run_and_store())
    _simulation_tasks[simulation_id] = task
    return {"simulation_id": simulation_id, "status": "running"}


@router.get("/result")
async def get_result(simulation_id: str) -> Dict[str, Any]:
    """Retrieve final aggregated metrics for a completed simulation.

    If the simulation is still running or unknown, returns an
    appropriate status message. The final metrics are taken from the
    result stored after the simulation coroutine completes.
    """
    # Check if we have a stored result
    if simulation_id in _simulation_results:
        return {
            "simulation_id": simulation_id,
            "status": "completed",
            "metrics": _simulation_results[simulation_id],
        }
    # If still running
    task = _simulation_tasks.get(simulation_id)
    if task is not None and not task.done():
        return {"simulation_id": simulation_id, "status": "running"}
    # Unknown simulation
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")


@router.get("/state")
async def get_state(simulation_id: str) -> Dict[str, Any]:
    """Retrieve latest simulation state for polling clients."""
    state = _simulation_state.get(simulation_id)
    if state is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
    status_value = "running"
    if simulation_id in _simulation_results:
        status_value = "completed"
    else:
        task = _simulation_tasks.get(simulation_id)
        if task is None or task.done():
            status_value = "completed"
    return {"simulation_id": simulation_id, "status": status_value, **state}


@router.get("/debug/version")
async def debug_version() -> Dict[str, Any]:
    """Return a signature of the running engine code for diagnostics."""
    engine_path = Path(__file__).resolve().parents[1] / "simulation" / "engine.py"
    try:
        content = engine_path.read_bytes()
        digest = hashlib.sha256(content).hexdigest()[:12]
        return {"engine_sha": digest, "engine_path": str(engine_path)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Failed to read engine.py: {exc}")
