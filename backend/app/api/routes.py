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
import os
from datetime import datetime
import uuid
from typing import Any, Dict, Optional, List

from fastapi import APIRouter, HTTPException, status, Header

from ..core.dataset_loader import Dataset
from ..core import auth as auth_core
from ..simulation.engine import SimulationEngine
from ..core.ollama_client import generate_ollama
from ..core.context_store import save_context
from ..core import db as db_core
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


def _auth_required() -> bool:
    return os.getenv("AUTH_REQUIRED", "false").lower() in {"1", "true", "yes"}


async def _resolve_user(authorization: Optional[str], require: bool = False) -> Optional[Dict[str, Any]]:
    if not authorization or not authorization.lower().startswith("bearer "):
        if require:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
        return None
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user:
        if require:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
        return None
    return user


async def _ensure_simulation_access(simulation_id: str, user: Dict[str, Any]) -> None:
    role = (user.get("role") or "").lower()
    if role == "admin":
        return
    owner_id = await db_core.get_simulation_owner(simulation_id)
    if owner_id is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Simulation not found")
    if int(owner_id) != int(user.get("id") or 0):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")


def _init_state(simulation_id: str, user_id: Optional[int] = None) -> None:
    """Initialise the in-memory state container for a new simulation."""
    _simulation_state[simulation_id] = {
        "user_id": user_id,
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
        {
            "user_id": None,
            "agents": [],
            "reasoning": [],
            "metrics": None,
            "summary": None,
            "summary_ready": False,
            "summary_at": None,
        },
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
        "competition": ["competition", "crowded", "saturated", "many similar", "منافسة", "ازدحام", "مشبع", "تشابه", "منتشر جدًا"],
        "trust": ["trust", "privacy", "data", "security", "ثقة", "خصوصية", "بيانات", "أمان", "امن", "مصداقية", "سرية"],
        "regulation": ["regulation", "compliance", "legal", "liability", "تنظيم", "امتثال", "قانوني", "مسؤولية", "لوائح", "تشريعات", "ترخيص"],
        "economics": ["cost", "price", "roi", "margin", "تكلفة", "سعر", "عوائد", "هامش", "تكاليف", "ربح", "ميزانية", "غالي", "رخيص"],
        "feasibility": ["feasible", "implementation", "maintenance", "scale", "جدوى", "تنفيذ", "تشغيل", "صيانة", "توسع", "تعقيد"],
        "adoption": ["adoption", "behavior", "usage", "تبني", "سلوك", "استخدام", "اعتماد", "انتشار", "تجربة", "مستخدمين"],
    }

    hits = []
    for key, keywords in themes.items():
        if any(k in text_blob for k in keywords):
            hits.append(key)

    if not hits:
        hits = ["trust", "feasibility"]

    if language == "ar":
        advice_map = {
            "competition": "قلّل أثر المنافسة بإبراز ميزة مختلفة أو استهداف منطقة أقل ازدحامًا.",
            "trust": "ارفع الثقة بوضوح سياسات الخصوصية وحماية البيانات والأمان.",
            "regulation": "قدّم خطة امتثال واضحة لتقليل المخاطر التنظيمية.",
            "economics": "وضح العائد والتسعير بحيث تتفوق القيمة على التكلفة.",
            "feasibility": "اعرض خطة تنفيذ وصيانة واقعية على مراحل.",
            "adoption": "اشرح كيف ستدفع التبنّي بواجهة بسيطة وحوافز واضحة.",
        }
        tips = " ".join(advice_map[k] for k in hits[:2])
        return f"نصيحة لإقناع المعارضين: {tips}"

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
async def start_simulation(user_context: Dict[str, Any], authorization: str = Header(None)) -> Dict[str, Any]:
    """Initialise a new simulation.

    Accepts user-provided context (structured data) and kicks off a
    background simulation. Returns a unique simulation identifier so
    clients can subscribe to WebSocket updates or poll the REST API.
    """
    global dataset
    if dataset is None:
        raise HTTPException(status_code=500, detail="Dataset not loaded")
    # Authenticate user only when required (opt-in via env).
    user_id: Optional[int] = None
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        if not auth_core.has_permission(user, "simulation:run"):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
        user_id = int(user.get("id"))

    if user_id is not None:
        # Enforce daily usage limit (uses DAILY_LIMIT env; <= 0 disables the limit).
        usage = await auth_core.get_user_daily_usage(user_id)
        try:
            daily_limit = int(os.getenv("DAILY_LIMIT", "5") or 5)
        except ValueError:
            daily_limit = 5
        credits = int((user or {}).get("credits") or 0)
        if daily_limit <= 0:
            # Credits required for every run when daily limit is disabled
            if credits <= 0:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Credits exhausted")
            await auth_core.consume_simulation_credit(user_id)
        elif usage >= daily_limit:
            # Try to consume a credit once daily limit is reached
            if credits <= 0:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Credits exhausted")
            credit_used = await auth_core.consume_simulation_credit(user_id)
            if not credit_used:
                raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Credits exhausted")
        # Increment daily usage counter
        await auth_core.increment_daily_usage(user_id)
    # Generate a unique ID for this simulation
    simulation_id = str(uuid.uuid4())
    _init_state(simulation_id, user_id=user_id)
    try:
        save_context(simulation_id, user_context)
    except Exception:
        # Persistence is best-effort; ignore failures.
        pass
    # Persist simulation with status; user_id stored in table via ALTER but function does not save user_id
    await db_core.insert_simulation(simulation_id, user_context, status="running", user_id=user_id)
    if user_id is not None:
        await auth_core.log_audit(
            user_id,
            "simulation.started",
            {"simulation_id": simulation_id, "idea": user_context.get("idea")},
        )
    # Create a simulation engine instance
    engine = SimulationEngine(dataset=dataset)
    reasoning_buffer: List[Dict[str, Any]] = []
    buffer_iteration: int | None = None
    try:
        reasoning_batch_size = int(os.getenv("REASONING_DB_BATCH_SIZE", "50") or 50)
    except ValueError:
        reasoning_batch_size = 50

    async def emitter(event_type: str, data: Dict[str, Any]) -> None:
        """Broadcast events and store a snapshot for polling."""
        nonlocal reasoning_buffer, buffer_iteration
        payload = {"type": event_type, "simulation_id": simulation_id, **data}
        # Broadcast to all connected WebSocket clients
        await manager.broadcast_json(payload)
        # Persist state for REST polling
        _store_event(simulation_id, event_type, data)
        try:
            if event_type == "agents" and data.get("iteration") == 0:
                await db_core.insert_agents(simulation_id, data.get("agents") or [])
            elif event_type == "reasoning_step":
                reasoning_buffer.append(data)
                current_iteration = data.get("iteration")
                if buffer_iteration is None:
                    buffer_iteration = current_iteration
                flush_due = False
                if current_iteration != buffer_iteration:
                    flush_due = True
                if reasoning_batch_size > 0 and len(reasoning_buffer) >= reasoning_batch_size:
                    flush_due = True
                if flush_due and reasoning_buffer:
                    await db_core.insert_reasoning_steps_bulk(simulation_id, reasoning_buffer)
                    reasoning_buffer = []
                    buffer_iteration = current_iteration
            elif event_type == "metrics":
                await db_core.insert_metrics(simulation_id, data)
        except Exception:
            # DB persistence should not break the simulation stream.
            pass

    # Define a coroutine that runs the simulation and stores results
    async def run_and_store() -> None:
        nonlocal reasoning_buffer
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
            await db_core.update_simulation(
                simulation_id=simulation_id,
                status="completed",
                summary=summary,
                ended_at=state["summary_at"],
                final_metrics=result,
            )
            if user_id is not None:
                await auth_core.log_audit(
                    user_id,
                    "simulation.completed",
                    {
                        "simulation_id": simulation_id,
                        "idea": user_context.get("idea"),
                        "acceptance_rate": result.get("acceptance_rate"),
                    },
                )
            # Broadcast summary explicitly for clients that listen on WS.
            await manager.broadcast_json({"type": "summary", "simulation_id": simulation_id, "summary": summary})
            if reasoning_buffer:
                try:
                    await db_core.insert_reasoning_steps_bulk(simulation_id, reasoning_buffer)
                except Exception:
                    pass
                reasoning_buffer = []
        except Exception as exc:  # noqa: BLE001
            _simulation_state.setdefault(simulation_id, {})["error"] = str(exc)
            try:
                await db_core.update_simulation(simulation_id=simulation_id, status="error")
            except Exception:
                pass
            if reasoning_buffer:
                try:
                    await db_core.insert_reasoning_steps_bulk(simulation_id, reasoning_buffer)
                except Exception:
                    pass
                reasoning_buffer = []
    # Launch simulation in background
    task = asyncio.create_task(run_and_store())
    _simulation_tasks[simulation_id] = task
    return {"simulation_id": simulation_id, "status": "running"}


@router.get("/result")
async def get_result(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    """Retrieve final aggregated metrics for a completed simulation.

    If the simulation is still running or unknown, returns an
    appropriate status message. The final metrics are taken from the
    result stored after the simulation coroutine completes.
    """
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)

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
async def get_state(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    """Retrieve latest simulation state for polling clients."""
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
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
    public_state = {k: v for k, v in state.items() if k != "user_id"}
    return {"simulation_id": simulation_id, "status": status_value, **public_state}


@router.get("/transcript")
async def get_transcript(simulation_id: str, authorization: str = Header(None)) -> Dict[str, Any]:
    """Return the ordered transcript grouped by phase."""
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if user:
        await _ensure_simulation_access(simulation_id, user)
    transcript = await db_core.fetch_transcript(simulation_id)
    if not transcript:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transcript not found")
    phase_labels = {
        "Information Shock": "التصادم المعرفي (Information Shock)",
        "Polarization Phase": "الاستقطاب (Polarization Phase)",
        "Clash of Values": "محاولات الإقناع والجمود (Clash of Values)",
        "Resolution Pressure": "النتيجة النهائية (Resolution Pressure)",
    }
    for group in transcript:
        label = phase_labels.get(group.get("phase"))
        if label:
            group["phase"] = label
    return {"simulation_id": simulation_id, "phases": transcript}


@router.get("/list")
async def list_simulations(
    limit: int = 25,
    offset: int = 0,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    if not auth_core.has_permission(user, "simulation:view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    is_admin = str(user.get("role") or "").lower() == "admin"
    rows = await db_core.fetch_simulations(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        limit=min(max(limit, 1), 100),
        offset=max(offset, 0),
        include_all=is_admin,
    )
    total = await db_core.count_simulations(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        include_all=is_admin,
    )
    items: List[Dict[str, Any]] = []
    for row in rows:
        context = row.get("user_context") or {}
        if isinstance(context, str):
            try:
                import json
                context = json.loads(context)
            except Exception:
                context = {}
        metrics = row.get("final_metrics") or {}
        if isinstance(metrics, str):
            try:
                import json
                metrics = json.loads(metrics)
            except Exception:
                metrics = {}
        items.append(
            {
                "simulation_id": row.get("simulation_id"),
                "status": row.get("status"),
                "idea": context.get("idea") or "",
                "category": context.get("category") or "",
                "created_at": row.get("created_at"),
                "ended_at": row.get("ended_at"),
                "summary": row.get("summary") or "",
                "acceptance_rate": metrics.get("acceptance_rate"),
                "total_agents": metrics.get("total_agents"),
            }
        )
    return {"items": items, "total": total}


@router.get("/analytics")
async def simulation_analytics(
    days: int = 7,
    authorization: str = Header(None),
) -> Dict[str, Any]:
    auth_required = _auth_required()
    user = await _resolve_user(authorization, require=auth_required)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    if not auth_core.has_permission(user, "simulation:view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    is_admin = str(user.get("role") or "").lower() == "admin"
    days = min(max(days, 1), 90)
    rows = await db_core.fetch_simulations(
        user_id=int(user.get("id")) if user.get("id") is not None else None,
        limit=500,
        offset=0,
        include_all=is_admin,
    )
    from datetime import timedelta
    import json

    today = datetime.utcnow().date()
    start_date = today - timedelta(days=days - 1)
    daily = {}
    category_counts: Dict[str, int] = {}
    total_agents = 0
    completed = 0
    acceptance_sum = 0.0

    for row in rows:
        created_at = row.get("created_at")
        if isinstance(created_at, datetime):
            created_date = created_at.date()
        else:
            created_date = None
        context = row.get("user_context") or {}
        if isinstance(context, str):
            try:
                context = json.loads(context)
            except Exception:
                context = {}
        category = (context.get("category") or "other").title()
        category_counts[category] = category_counts.get(category, 0) + 1

        metrics = row.get("final_metrics") or {}
        if isinstance(metrics, str):
            try:
                metrics = json.loads(metrics)
            except Exception:
                metrics = {}
        if row.get("status") == "completed" and metrics:
            completed += 1
            acceptance_sum += float(metrics.get("acceptance_rate") or 0.0)
            total_agents += int(metrics.get("total_agents") or 0)

        if created_date and created_date >= start_date:
            key = created_date.isoformat()
            daily.setdefault(key, {"simulations": 0, "success": 0, "agents": 0})
            daily[key]["simulations"] += 1
            if metrics:
                daily[key]["agents"] += int(metrics.get("total_agents") or 0)
                if float(metrics.get("acceptance_rate") or 0.0) >= 0.6:
                    daily[key]["success"] += 1

    weekly = []
    for i in range(days):
        d = start_date + timedelta(days=i)
        key = d.isoformat()
        entry = daily.get(key, {"simulations": 0, "success": 0, "agents": 0})
        weekly.append({"date": key, **entry})

    categories = [{"name": name, "value": value} for name, value in category_counts.items()]

    avg_acceptance = (acceptance_sum / completed) if completed > 0 else 0.0

    return {
        "totals": {
            "total_simulations": len(rows),
            "completed": completed,
            "avg_acceptance_rate": avg_acceptance,
            "total_agents": total_agents,
        },
        "weekly": weekly,
        "categories": categories,
    }


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
