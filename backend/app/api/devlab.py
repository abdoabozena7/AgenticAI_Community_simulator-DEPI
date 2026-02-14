"""
Developer Lab endpoints for internal validation workflows.
"""

from __future__ import annotations

import asyncio
import os
import time
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field

from ..core import auth as auth_core
from ..core import db as db_core
from ..core.ollama_client import generate_ollama
from ..core.text_encoding_guard import attempt_repair, detect_mojibake
from ..core.web_search import search_web
from . import routes as simulation_routes


router = APIRouter(prefix="/devlab", tags=["devlab"])

_suite_tasks: Dict[str, asyncio.Task] = {}


async def require_developer_lab(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if not auth_core.has_permission(user, "developer:lab"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Developer Lab access required")
    return user


class DevLabSearchRequest(BaseModel):
    query: str = Field(..., min_length=2)
    language: Optional[str] = Field(default="ar")
    max_results: int = Field(default=5, ge=1, le=10)


class DevLabLlmRequest(BaseModel):
    prompt: str = Field(..., min_length=2)
    system: Optional[str] = None
    temperature: Optional[float] = Field(default=0.35, ge=0.0, le=2.0)
    language: Optional[str] = Field(default="ar")


class SuiteCasePayload(BaseModel):
    key: str
    title: str
    idea: str
    expected: Dict[str, Any]


class ReasoningSuiteStartRequest(BaseModel):
    language: Optional[str] = Field(default="ar")
    agent_count: Optional[int] = Field(default=20, ge=6, le=500)
    iterations: Optional[int] = Field(default=4, ge=1, le=12)
    neutral_cap_pct: Optional[float] = Field(default=0.30, ge=0.05, le=0.7)
    cases: Optional[List[SuiteCasePayload]] = None


def _default_suite_cases(language: str) -> List[Dict[str, Any]]:
    if language == "ar":
        return [
            {
                "key": "good_idea",
                "title": "فكرة جيدة",
                "idea": "تطبيق ذكي لاكتشاف تسريب المياه في المنازل عبر حساسات IoT مع تنبيه فوري وتقارير استهلاك شهرية.",
                "expected": {"accept_min": 0.55, "neutral_max": 0.30},
            },
            {
                "key": "bad_idea",
                "title": "فكرة سيئة",
                "idea": "نظام يجمع الرسائل الخاصة وتحركات GPS وسجل المشتريات البنكية ويمنع المتقدمين من التوظيف لمدة خمس سنوات تلقائيًا.",
                "expected": {"reject_min": 0.70, "accept_max": 0.10, "neutral_max": 0.30},
            },
            {
                "key": "ambiguous_idea",
                "title": "فكرة غامضة",
                "idea": "منصة ذكاء اصطناعي لتحسين التوظيف بشكل عام بدون تحديد القطاع أو طريقة جمع البيانات أو معايير القرار.",
                "expected": {"clarification_min": 1, "neutral_max": 0.30},
            },
        ]
    return [
        {
            "key": "good_idea",
            "title": "Good Idea",
            "idea": "IoT water leak detection for apartment buildings with instant alerts and monthly savings analytics.",
            "expected": {"accept_min": 0.55, "neutral_max": 0.30},
        },
        {
            "key": "bad_idea",
            "title": "Bad Idea",
            "idea": "A hiring trust-score system that reads private chats, GPS movement and banking history to auto-ban applicants for 5 years.",
            "expected": {"reject_min": 0.70, "accept_max": 0.10, "neutral_max": 0.30},
        },
        {
            "key": "ambiguous_idea",
            "title": "Ambiguous Idea",
            "idea": "An AI platform to improve hiring outcomes without clear target segment, scope, or policy constraints.",
            "expected": {"clarification_min": 1, "neutral_max": 0.30},
        },
    ]


def _safe_ratio(value: Any, total: int) -> float:
    try:
        num = float(value or 0.0)
    except Exception:
        num = 0.0
    return num / max(1, total) if num > 1 else num


def _evaluate_case(expected: Dict[str, Any], actual: Dict[str, Any]) -> tuple[bool, List[str]]:
    failures: List[str] = []
    accepted = _safe_ratio(actual.get("accepted"), max(1, int(actual.get("total_agents") or 0)))
    rejected = _safe_ratio(actual.get("rejected"), max(1, int(actual.get("total_agents") or 0)))
    neutral = _safe_ratio(actual.get("neutral"), max(1, int(actual.get("total_agents") or 0)))
    clarification_count = int(actual.get("clarification_count") or 0)

    if expected.get("accept_min") is not None and accepted < float(expected["accept_min"]):
        failures.append(f"accept<{expected['accept_min']}")
    if expected.get("accept_max") is not None and accepted > float(expected["accept_max"]):
        failures.append(f"accept>{expected['accept_max']}")
    if expected.get("reject_min") is not None and rejected < float(expected["reject_min"]):
        failures.append(f"reject<{expected['reject_min']}")
    if expected.get("reject_max") is not None and rejected > float(expected["reject_max"]):
        failures.append(f"reject>{expected['reject_max']}")
    if expected.get("neutral_max") is not None and neutral > float(expected["neutral_max"]):
        failures.append(f"neutral>{expected['neutral_max']}")
    if expected.get("clarification_min") is not None and clarification_count < int(expected["clarification_min"]):
        failures.append(f"clarification<{expected['clarification_min']}")

    return (len(failures) == 0), failures


async def _poll_simulation_until_done(
    simulation_id: str,
    authorization: str,
    language: str,
    timeout_seconds: int = 420,
) -> Dict[str, Any]:
    started = time.perf_counter()
    while True:
        state = await simulation_routes.get_state(simulation_id=simulation_id, authorization=authorization)
        status_value = str(state.get("status") or "").lower()
        status_reason = str(state.get("status_reason") or "").lower()
        if status_value == "completed":
            return state
        if status_value == "error":
            return state
        if status_value == "paused":
            if status_reason == "paused_clarification_needed":
                pending = state.get("pending_clarification") if isinstance(state.get("pending_clarification"), dict) else {}
                options = pending.get("options") if isinstance(pending.get("options"), list) else []
                selected_option_id = None
                if options:
                    first = options[0] if isinstance(options[0], dict) else {}
                    selected_option_id = str(first.get("id") or first.get("value") or "").strip() or None
                custom_text = (
                    "قدّم افتراضات واضحة: السوق المستهدف، نموذج الربح، والقيود القانونية."
                    if language == "ar"
                    else "Use explicit assumptions for target segment, business model, and legal constraints."
                )
                await simulation_routes.submit_clarification_answer(
                    payload={
                        "simulation_id": simulation_id,
                        "question_id": pending.get("question_id"),
                        "selected_option_id": selected_option_id,
                        "custom_text": custom_text,
                    },
                    authorization=authorization,
                )
            elif bool(state.get("can_resume")):
                await simulation_routes.resume_simulation(
                    payload={"simulation_id": simulation_id},
                    authorization=authorization,
                )
            else:
                return state
        if (time.perf_counter() - started) > timeout_seconds:
            return {**state, "status": "failed", "error": "suite_timeout"}
        await asyncio.sleep(1.4)


async def _run_suite_background(
    *,
    suite_id: str,
    user: Dict[str, Any],
    authorization: str,
    language: str,
    agent_count: int,
    iterations: int,
    neutral_cap_pct: float,
    cases: List[Dict[str, Any]],
) -> None:
    user_id = int(user.get("id"))
    passed_count = 0
    failed_count = 0
    try:
        for case in cases:
            case_key = str(case.get("key") or "")
            expected = case.get("expected") if isinstance(case.get("expected"), dict) else {}
            await db_core.upsert_developer_suite_case(
                suite_id,
                case_key,
                expected=expected,
                status="running",
            )
            start_payload = {
                "idea": str(case.get("idea") or "").strip(),
                "category": "technology",
                "targetAudience": ["general"],
                "country": "Egypt" if language == "ar" else "Global",
                "city": "Cairo" if language == "ar" else "Remote",
                "riskAppetite": 50,
                "ideaMaturity": "concept",
                "goals": ["validate idea quality"],
                "language": language,
                "agentCount": int(agent_count),
                "iterations": int(iterations),
                "run_mode": "dev_suite",
                "neutral_cap_pct": float(neutral_cap_pct),
                "neutral_enforcement": "clarification_before_complete",
            }
            start_response = await simulation_routes.start_simulation(start_payload, authorization=authorization)
            simulation_id = str(start_response.get("simulation_id") or "")
            await db_core.upsert_developer_suite_case(
                suite_id,
                case_key,
                simulation_id=simulation_id,
                status="running",
            )
            final_state = await _poll_simulation_until_done(
                simulation_id=simulation_id,
                authorization=authorization,
                language=language,
            )
            metrics = final_state.get("metrics") if isinstance(final_state.get("metrics"), dict) else {}
            reasoning = final_state.get("reasoning") if isinstance(final_state.get("reasoning"), list) else []
            fallback_steps = 0
            for step in reasoning:
                if not isinstance(step, dict):
                    continue
                if str(step.get("opinion_source") or "") == "fallback":
                    fallback_steps += 1
            fallback_ratio = (fallback_steps / len(reasoning)) if reasoning else 0.0
            actual = {
                "accepted": int(metrics.get("accepted") or 0),
                "rejected": int(metrics.get("rejected") or 0),
                "neutral": int(metrics.get("neutral") or 0),
                "total_agents": int(metrics.get("total_agents") or agent_count),
                "clarification_count": int(final_state.get("clarification_count") or 0),
                "fallback_ratio": float(fallback_ratio),
                "status": str(final_state.get("status") or ""),
                "status_reason": str(final_state.get("status_reason") or ""),
            }
            passed, failures = _evaluate_case(expected, actual)
            if passed:
                passed_count += 1
            else:
                failed_count += 1
            await db_core.upsert_developer_suite_case(
                suite_id,
                case_key,
                simulation_id=simulation_id,
                expected=expected,
                actual=actual,
                status="completed" if passed else "failed",
                passed=passed,
                failure_reason=", ".join(failures) if failures else None,
            )

        summary = {
            "summary": {
                "total_cases": len(cases),
                "passed": passed_count,
                "failed": failed_count,
            }
        }
        await db_core.update_developer_suite_run(
            suite_id,
            status="completed" if failed_count == 0 else "failed",
            result=summary,
            ended=True,
        )
    except Exception as exc:  # noqa: BLE001
        await db_core.update_developer_suite_run(
            suite_id,
            status="failed",
            result={"summary": {"error": str(exc)}},
            ended=True,
        )
        await auth_core.log_audit(
            user_id,
            "devlab.suite_failed",
            {"suite_id": suite_id, "error": str(exc)},
        )
    finally:
        _suite_tasks.pop(suite_id, None)


@router.post("/search/test")
async def devlab_search_test(payload: DevLabSearchRequest, user: Dict[str, Any] = Depends(require_developer_lab)) -> Dict[str, Any]:
    started = time.perf_counter()
    result = await search_web(
        query=payload.query,
        max_results=payload.max_results,
        language=payload.language or "ar",
        strict_web_only=True,
    )
    latency_ms = int((time.perf_counter() - started) * 1000)
    warnings: List[str] = []
    summary_text = str((result.get("structured") or {}).get("summary") or "")
    if summary_text:
        guard = detect_mojibake(summary_text)
        if guard["flag"]:
            warnings.append("mojibake_detected_in_summary")

    await auth_core.log_audit(
        int(user.get("id")),
        "devlab.search_test",
        {"query": payload.query, "latency_ms": latency_ms, "results": len(result.get("results") or [])},
    )
    return {
        "provider": result.get("provider"),
        "is_live": bool(result.get("is_live")),
        "strict_mode": bool(result.get("strict_mode")),
        "quality": result.get("quality") if isinstance(result.get("quality"), dict) else {},
        "results": result.get("results") if isinstance(result.get("results"), list) else [],
        "structured": result.get("structured") if isinstance(result.get("structured"), dict) else {},
        "latency_ms": latency_ms,
        "warnings": warnings,
    }


@router.post("/llm/test")
async def devlab_llm_test(payload: DevLabLlmRequest, user: Dict[str, Any] = Depends(require_developer_lab)) -> Dict[str, Any]:
    started = time.perf_counter()
    warnings: List[str] = []
    model_name = os.getenv("OLLAMA_MODEL") or "auto"
    response_text = await generate_ollama(
        prompt=payload.prompt,
        system=payload.system,
        temperature=float(payload.temperature or 0.35),
    )
    guard = detect_mojibake(response_text)
    if guard["flag"]:
        warnings.append("mojibake_detected")
        retry_prompt = (
            "أعد الصياغة بنفس المعنى لكن بنص عربي واضح UTF-8 بدون أي رموز مشوهة:\n" + response_text
            if (payload.language or "ar") == "ar"
            else "Rewrite the same meaning in clean UTF-8 text without mojibake:\n" + response_text
        )
        try:
            response_text = await generate_ollama(
                prompt=retry_prompt,
                system=payload.system,
                temperature=0.2,
            )
            guard = detect_mojibake(response_text)
            if guard["flag"]:
                response_text = attempt_repair(response_text)
        except Exception:
            response_text = attempt_repair(response_text)

    latency_ms = int((time.perf_counter() - started) * 1000)
    await auth_core.log_audit(
        int(user.get("id")),
        "devlab.llm_test",
        {"latency_ms": latency_ms, "mojibake_detected": bool(guard["flag"])},
    )
    return {
        "text": response_text,
        "latency_ms": latency_ms,
        "model": model_name,
        "mojibake_detected": bool(guard["flag"]),
        "warnings": warnings,
    }


@router.post("/reasoning-suite/start")
async def start_reasoning_suite(
    payload: ReasoningSuiteStartRequest,
    authorization: str = Header(None),
    user: Dict[str, Any] = Depends(require_developer_lab),
) -> Dict[str, Any]:
    language = (payload.language or "ar").lower()
    suite_id = str(uuid.uuid4())
    raw_cases = payload.cases or []
    if raw_cases:
        cases = [
            {
                "key": str(item.key),
                "title": str(item.title),
                "idea": str(item.idea),
                "expected": dict(item.expected or {}),
            }
            for item in raw_cases
        ]
    else:
        cases = _default_suite_cases(language)
    config = {
        "language": language,
        "agent_count": int(payload.agent_count or 20),
        "iterations": int(payload.iterations or 4),
        "neutral_cap_pct": float(payload.neutral_cap_pct or 0.30),
        "cases": [{"key": c["key"], "title": c["title"], "expected": c["expected"]} for c in cases],
    }
    await db_core.insert_developer_suite_run(
        suite_id=suite_id,
        user_id=int(user.get("id")),
        status="running",
        config=config,
    )
    for case in cases:
        await db_core.upsert_developer_suite_case(
            suite_id,
            str(case.get("key") or ""),
            expected=case.get("expected") if isinstance(case.get("expected"), dict) else {},
            status="pending",
        )
    task = asyncio.create_task(
        _run_suite_background(
            suite_id=suite_id,
            user=user,
            authorization=authorization or "",
            language=language,
            agent_count=int(payload.agent_count or 20),
            iterations=int(payload.iterations or 4),
            neutral_cap_pct=float(payload.neutral_cap_pct or 0.30),
            cases=cases,
        )
    )
    _suite_tasks[suite_id] = task
    await auth_core.log_audit(
        int(user.get("id")),
        "devlab.suite_started",
        {"suite_id": suite_id, "cases": [c["key"] for c in cases]},
    )
    return {"suite_id": suite_id, "status": "running", "created_at": int(time.time() * 1000)}


@router.get("/reasoning-suite/state")
async def get_reasoning_suite_state(
    suite_id: str,
    user: Dict[str, Any] = Depends(require_developer_lab),
) -> Dict[str, Any]:
    suite = await db_core.fetch_developer_suite_run(suite_id, user_id=int(user.get("id")))
    if not suite:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Suite not found")
    cases = suite.get("cases") if isinstance(suite.get("cases"), list) else []
    completed = sum(1 for c in cases if str(c.get("status") or "") in {"completed", "failed"})
    progress_pct = round((completed / max(1, len(cases))) * 100.0, 1)
    result = suite.get("result") if isinstance(suite.get("result"), dict) else {}
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    return {
        "suite_id": suite_id,
        "status": suite.get("status") or "running",
        "progress_pct": progress_pct,
        "cases": cases,
        "started_at": suite.get("started_at"),
        "ended_at": suite.get("ended_at"),
        "summary": summary,
    }


@router.get("/reasoning-suite/list")
async def list_reasoning_suites(
    limit: int = 20,
    offset: int = 0,
    user: Dict[str, Any] = Depends(require_developer_lab),
) -> Dict[str, Any]:
    return await db_core.list_developer_suite_runs(
        user_id=int(user.get("id")),
        limit=limit,
        offset=offset,
    )
