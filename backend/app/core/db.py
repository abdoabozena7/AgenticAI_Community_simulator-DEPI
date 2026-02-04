"""
MySQL persistence helpers for simulation data.

Uses mysql-connector-python to write simulation runs, agents, reasoning steps,
and metrics into a local MySQL (XAMPP) instance.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import mysql.connector

DEFAULT_DB_NAME = "agentic_simulator"


def _db_config(include_db: bool = True) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {
        "host": os.getenv("DB_HOST") or os.getenv("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT") or os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("DB_USER") or os.getenv("MYSQL_USER", "root"),
        "password": os.getenv("DB_PASSWORD") or os.getenv("MYSQL_PASSWORD", ""),
        "autocommit": True,
    }
    if include_db:
        cfg["database"] = os.getenv("DB_NAME") or os.getenv("MYSQL_DATABASE", DEFAULT_DB_NAME)
    return cfg


def _connect(include_db: bool = True) -> mysql.connector.MySQLConnection:
    return mysql.connector.connect(**_db_config(include_db))


def _load_schema_sql() -> str:
    schema_path = Path(__file__).with_name("db_schema.sql")
    if schema_path.exists():
        return schema_path.read_text(encoding="utf-8")
    return ""


def _split_sql(script: str) -> List[str]:
    statements: List[str] = []
    for raw in script.split(";"):
        stmt = raw.strip()
        if stmt:
            statements.append(stmt)
    return statements


def _init_db_sync() -> None:
    db_name = os.getenv("DB_NAME", DEFAULT_DB_NAME)
    conn = _connect(include_db=False)
    cursor = conn.cursor()
    cursor.execute(
        f"CREATE DATABASE IF NOT EXISTS `{db_name}` "
        "DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    )
    cursor.close()
    conn.close()

    schema_sql = _load_schema_sql()
    if not schema_sql:
        return
    conn = _connect(include_db=True)
    cursor = conn.cursor()
    for stmt in _split_sql(schema_sql):
        cursor.execute(stmt)
    cursor.close()
    conn.close()


async def init_db() -> None:
    """Create database and tables if they do not already exist."""
    await asyncio.to_thread(_init_db_sync)


def _run_query(
    query: str,
    params: Optional[Iterable[Any]] = None,
    fetch: bool = False,
    many: bool = False,
) -> Optional[List[Dict[str, Any]]]:
    conn = _connect(include_db=True)
    cursor = conn.cursor(dictionary=True)
    if many:
        cursor.executemany(query, params or [])
    else:
        cursor.execute(query, params or ())
    rows = cursor.fetchall() if fetch else None
    cursor.close()
    conn.close()
    return rows


async def execute(
    query: str,
    params: Optional[Iterable[Any]] = None,
    fetch: bool = False,
    many: bool = False,
) -> Optional[List[Dict[str, Any]]]:
    return await asyncio.to_thread(_run_query, query, params, fetch, many)


async def insert_simulation(simulation_id: str, user_context: Dict[str, Any], status: str = "running") -> None:
    payload = json.dumps(user_context, ensure_ascii=False)
    await execute(
        "INSERT INTO simulations (simulation_id, status, user_context) "
        "VALUES (%s, %s, %s) "
        "ON DUPLICATE KEY UPDATE status=VALUES(status), user_context=VALUES(user_context)",
        (simulation_id, status, payload),
    )


def upsert_simulation_context_sync(simulation_id: str, user_context: Dict[str, Any]) -> None:
    payload = json.dumps(user_context, ensure_ascii=False)
    _run_query(
        "INSERT INTO simulations (simulation_id, status, user_context) "
        "VALUES (%s, %s, %s) "
        "ON DUPLICATE KEY UPDATE user_context=VALUES(user_context)",
        (simulation_id, "running", payload),
    )


async def update_simulation(
    simulation_id: str,
    status: Optional[str] = None,
    summary: Optional[str] = None,
    ended_at: Optional[str] = None,
) -> None:
    fields: List[str] = []
    params: List[Any] = []
    if status is not None:
        fields.append("status=%s")
        params.append(status)
    if summary is not None:
        fields.append("summary=%s")
        params.append(summary)
    if ended_at is not None:
        fields.append("ended_at=%s")
        params.append(ended_at)
    if not fields:
        return
    params.append(simulation_id)
    await execute(
        f"UPDATE simulations SET {', '.join(fields)} WHERE simulation_id=%s",
        params,
    )


async def insert_agents(simulation_id: str, agents: List[Dict[str, Any]]) -> None:
    if not agents:
        return
    rows = []
    for agent in agents:
        rows.append(
            (
                simulation_id,
                agent.get("agent_id"),
                agent.get("agent_short_id") or (agent.get("agent_id") or "")[:4],
                agent.get("category_id"),
                agent.get("template_id"),
                agent.get("archetype_name"),
                json.dumps(agent.get("traits") or {}, ensure_ascii=False),
                json.dumps(agent.get("biases") or [], ensure_ascii=False),
                agent.get("influence_weight"),
                bool(agent.get("is_leader")),
                agent.get("fixed_opinion"),
                agent.get("initial_opinion"),
                agent.get("opinion"),
                agent.get("confidence"),
            )
        )
    await execute(
        "INSERT INTO agents (simulation_id, agent_id, short_id, category_id, template_id, archetype_name, traits, biases, "
        "influence_weight, is_leader, fixed_opinion, initial_opinion, current_opinion, confidence) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        rows,
        many=True,
    )


async def insert_reasoning_step(simulation_id: str, data: Dict[str, Any]) -> None:
    await execute(
        "INSERT INTO reasoning_steps (simulation_id, agent_id, agent_short_id, archetype_name, iteration, phase, "
        "reply_to_agent_id, opinion, message) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            simulation_id,
            data.get("agent_id"),
            data.get("agent_short_id"),
            data.get("archetype"),
            data.get("iteration"),
            data.get("phase"),
            data.get("reply_to_agent_id"),
            data.get("opinion"),
            data.get("message"),
        ),
    )


async def insert_reasoning_steps_bulk(simulation_id: str, steps: List[Dict[str, Any]]) -> None:
    if not steps:
        return
    rows = []
    for data in steps:
        rows.append(
            (
                simulation_id,
                data.get("agent_id"),
                data.get("agent_short_id"),
                data.get("archetype"),
                data.get("iteration"),
                data.get("phase"),
                data.get("reply_to_agent_id"),
                data.get("opinion"),
                data.get("message"),
            )
        )
    await execute(
        "INSERT INTO reasoning_steps (simulation_id, agent_id, agent_short_id, archetype_name, iteration, phase, "
        "reply_to_agent_id, opinion, message) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        rows,
        many=True,
    )


async def insert_metrics(simulation_id: str, data: Dict[str, Any]) -> None:
    await execute(
        "INSERT INTO metrics (simulation_id, iteration, accepted, rejected, neutral, acceptance_rate, polarization, per_category) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
        (
            simulation_id,
            data.get("iteration"),
            data.get("accepted"),
            data.get("rejected"),
            data.get("neutral"),
            data.get("acceptance_rate"),
            data.get("polarization"),
            json.dumps(data.get("per_category") or {}, ensure_ascii=False),
        ),
    )


async def insert_promo_code(
    code: str,
    bonus_attempts: int,
    max_uses: int,
    expires_at: Optional[str] = None,
    created_by: Optional[int] = None,
) -> int:
    await execute(
        "INSERT INTO promo_codes (code, bonus_attempts, max_uses, expires_at, created_by) "
        "VALUES (%s, %s, %s, %s, %s)",
        (code, bonus_attempts, max_uses, expires_at, created_by),
    )
    rows = await execute(
        "SELECT id FROM promo_codes WHERE code=%s",
        (code,),
        fetch=True,
    )
    return int(rows[0]["id"]) if rows else 0


async def fetch_transcript(simulation_id: str) -> List[Dict[str, Any]]:
    agent_rows = await execute(
        "SELECT agent_id, short_id, archetype_name FROM agents WHERE simulation_id=%s",
        (simulation_id,),
        fetch=True,
    )
    short_map = {row["agent_id"]: row.get("short_id") for row in (agent_rows or [])}
    archetype_map = {row["agent_id"]: row.get("archetype_name") for row in (agent_rows or [])}

    rows = await execute(
        "SELECT agent_id, agent_short_id, archetype_name, iteration, phase, reply_to_agent_id, opinion, message, created_at "
        "FROM reasoning_steps WHERE simulation_id=%s ORDER BY id ASC",
        (simulation_id,),
        fetch=True,
    )
    phases: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows or []:
        phase = row.get("phase") or "Phase"
        phases.setdefault(phase, []).append(
            {
                "agent_id": row.get("agent_id"),
                "agent_short_id": row.get("agent_short_id") or short_map.get(row.get("agent_id")),
                "archetype": row.get("archetype_name") or archetype_map.get(row.get("agent_id")),
                "iteration": row.get("iteration"),
                "reply_to_agent_id": row.get("reply_to_agent_id"),
                "reply_to_short_id": short_map.get(row.get("reply_to_agent_id")),
                "opinion": row.get("opinion"),
                "message": row.get("message"),
                "created_at": row.get("created_at"),
            }
        )
    grouped = [{"phase": phase, "lines": lines} for phase, lines in phases.items()]
    return grouped
