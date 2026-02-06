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


def _resolve_db_name() -> str:
    return os.getenv("DB_NAME") or os.getenv("MYSQL_DATABASE", DEFAULT_DB_NAME)


def _db_config(include_db: bool = True) -> Dict[str, Any]:
    cfg: Dict[str, Any] = {
        "host": os.getenv("DB_HOST") or os.getenv("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.getenv("DB_PORT") or os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("DB_USER") or os.getenv("MYSQL_USER", "root"),
        "password": os.getenv("DB_PASSWORD") or os.getenv("MYSQL_PASSWORD", ""),
        "autocommit": True,
    }
    if include_db:
        cfg["database"] = _resolve_db_name()
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
    db_name = _resolve_db_name()
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
        try:
            cursor.execute(stmt)
        except mysql.connector.Error as exc:
            # Legacy databases may contain invalid default values on expires_at
            # columns. Repair those tables, then continue schema bootstrap.
            if exc.errno == 1067 and "expires_at" in str(exc).lower():
                _repair_expires_columns(cursor)
                continue
            raise
    # Best-effort migrations for existing databases.
    _apply_migrations(cursor)
    cursor.close()
    conn.close()


def _table_exists(cursor: mysql.connector.cursor.MySQLCursor, table_name: str) -> bool:
    cursor.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s",
        (table_name,),
    )
    return bool(cursor.fetchone())


def _repair_expires_columns(cursor: mysql.connector.cursor.MySQLCursor) -> None:
    for table_name in ("refresh_tokens", "email_verifications", "password_resets"):
        if not _table_exists(cursor, table_name):
            continue
        try:
            cursor.execute(f"ALTER TABLE {table_name} MODIFY expires_at DATETIME NULL")
            cursor.execute(f"UPDATE {table_name} SET expires_at = UTC_TIMESTAMP() WHERE expires_at IS NULL")
            cursor.execute(f"ALTER TABLE {table_name} MODIFY expires_at DATETIME NOT NULL")
        except mysql.connector.Error:
            # Keep startup resilient: migrations below will attempt repair again.
            pass


def _apply_migrations(cursor: mysql.connector.cursor.MySQLCursor) -> None:
    migrations = [
        "ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN email_verified_at TIMESTAMP NULL",
        "ALTER TABLE refresh_tokens MODIFY expires_at DATETIME NOT NULL",
        "ALTER TABLE email_verifications MODIFY expires_at DATETIME NOT NULL",
        "ALTER TABLE password_resets MODIFY expires_at DATETIME NOT NULL",
    ]
    for stmt in migrations:
        try:
            cursor.execute(stmt)
        except mysql.connector.Error:
            pass


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


async def insert_simulation(
    simulation_id: str,
    user_context: Dict[str, Any],
    status: str = "running",
    user_id: Optional[int] = None,
) -> None:
    payload = json.dumps(user_context, ensure_ascii=False)
    await execute(
        "INSERT INTO simulations (simulation_id, user_id, status, user_context) "
        "VALUES (%s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "status=VALUES(status), "
        "user_context=VALUES(user_context), "
        "user_id=COALESCE(VALUES(user_id), user_id)",
        (simulation_id, user_id, status, payload),
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
    final_metrics: Optional[Dict[str, Any]] = None,
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
    if final_metrics is not None:
        fields.append("final_metrics=%s")
        params.append(json.dumps(final_metrics, ensure_ascii=False))
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


async def get_simulation_owner(simulation_id: str) -> Optional[int]:
    rows = await execute(
        "SELECT user_id FROM simulations WHERE simulation_id=%s",
        (simulation_id,),
        fetch=True,
    )
    if not rows:
        return None
    owner = rows[0].get("user_id")
    return int(owner) if owner is not None else None


async def fetch_simulations(
    user_id: Optional[int],
    limit: int = 25,
    offset: int = 0,
    include_all: bool = False,
) -> List[Dict[str, Any]]:
    params: List[Any] = []
    where = ""
    if not include_all and user_id is not None:
        where = "WHERE user_id=%s"
        params.append(user_id)
    query = (
        "SELECT simulation_id, user_id, status, user_context, summary, final_metrics, created_at, ended_at "
        "FROM simulations "
        f"{where} "
        "ORDER BY created_at DESC "
        "LIMIT %s OFFSET %s"
    )
    params.extend([limit, offset])
    rows = await execute(query, params, fetch=True)
    return rows or []


async def count_simulations(user_id: Optional[int], include_all: bool = False) -> int:
    params: List[Any] = []
    where = ""
    if not include_all and user_id is not None:
        where = "WHERE user_id=%s"
        params.append(user_id)
    rows = await execute(
        f"SELECT COUNT(*) AS total FROM simulations {where}",
        params,
        fetch=True,
    )
    if not rows:
        return 0
    return int(rows[0].get("total") or 0)


async def insert_audit_log(
    user_id: Optional[int],
    action: str,
    meta: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    payload = json.dumps(meta or {}, ensure_ascii=False)
    await execute(
        "INSERT INTO audit_logs (user_id, action, meta, ip_address, user_agent) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, action, payload, ip_address, user_agent),
    )


async def fetch_audit_logs(user_id: int, limit: int = 20, offset: int = 0) -> List[Dict[str, Any]]:
    rows = await execute(
        "SELECT id, action, meta, created_at FROM audit_logs "
        "WHERE user_id=%s ORDER BY created_at DESC LIMIT %s OFFSET %s",
        (user_id, limit, offset),
        fetch=True,
    )
    logs: List[Dict[str, Any]] = []
    for row in rows or []:
        meta = row.get("meta") or {}
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        logs.append(
            {
                "id": row.get("id"),
                "action": row.get("action"),
                "meta": meta,
                "created_at": row.get("created_at"),
            }
        )
    return logs
