"""
Database persistence helpers and connection management.

This module centralises all MySQL access for the Agentic Simulator. It uses a
connection pool to efficiently reuse connections and supports automatic
database/schema initialisation on startup. All connection parameters are
configured via environment variables so the backend can run in a variety of
environments (local XAMPP, Docker, cloud hosts) without code changes.

The pool is created lazily on first use and the schema is loaded from
``core/sql/schema.sql`` if the necessary tables are missing. Helper
functions are provided for writing and reading data related to users,
sessions, promo codes, daily usage, simulations, agents, reasoning steps,
metrics and research sessions.

Environment variables:

``MYSQL_HOST``: hostname of the MySQL server (default ``127.0.0.1``)
``MYSQL_PORT``: port of the MySQL server (default ``3306``)
``MYSQL_DATABASE``: name of the database (default ``agentic_simulator``)
``MYSQL_USER``: username (default ``root``)
``MYSQL_PASSWORD``: password (default ````)

``DB_NAME``, ``DB_HOST``, etc. are still honoured for backwards
compatibility but the ``MYSQL_*`` variables take precedence.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import mysql.connector
from mysql.connector import pooling


# ---------------------------------------------------------------------------
# Connection pool management
# ---------------------------------------------------------------------------

_pool_lock = threading.Lock()
_pool: Optional[pooling.MySQLConnectionPool] = None


def _get_db_params() -> Dict[str, Any]:
    """Return connection parameters from environment.

    ``MYSQL_*`` variables take precedence over legacy ``DB_*`` variables.
    """
    return {
        "host": os.getenv("MYSQL_HOST") or os.getenv("DB_HOST", "127.0.0.1"),
        "port": int(os.getenv("MYSQL_PORT") or os.getenv("DB_PORT", "3306")),
        "database": os.getenv("MYSQL_DATABASE") or os.getenv("DB_NAME", "agentic_simulator"),
        "user": os.getenv("MYSQL_USER") or os.getenv("DB_USER", "root"),
        "password": os.getenv("MYSQL_PASSWORD") or os.getenv("DB_PASSWORD", ""),
    }


def _get_pool() -> pooling.MySQLConnectionPool:
    """Create or return a singleton connection pool."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                params = _get_db_params()
                pool_size = int(os.getenv("MYSQL_POOL_SIZE", "5"))
                _pool = pooling.MySQLConnectionPool(pool_name="agentic_pool", pool_size=pool_size, **params)
    return _pool


def _get_connection() -> mysql.connector.MySQLConnection:
    """Get a connection from the pool. Caller must close it."""
    return _get_pool().get_connection()


def _load_schema_file() -> str:
    """Load the schema SQL from core/sql/schema.sql if present."""
    base = Path(__file__).resolve().parent
    schema_path = base / "sql" / "schema.sql"
    if schema_path.exists():
        return schema_path.read_text(encoding="utf-8")
    alt = base / "db_schema.sql"
    return alt.read_text(encoding="utf-8") if alt.exists() else ""


def _split_sql(script: str) -> List[str]:
    statements: List[str] = []
    for raw in script.split(";"):
        stmt = raw.strip()
        if stmt:
            statements.append(stmt)
    return statements


def init_db_sync() -> None:
    """Initialise the database and schema synchronously."""
    params = _get_db_params()
    cfg = dict(params)
    db_name = cfg.pop("database")
    conn = mysql.connector.connect(**{**cfg})
    cursor = conn.cursor()
    cursor.execute(
        f"CREATE DATABASE IF NOT EXISTS `{db_name}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
    )
    cursor.close()
    conn.close()

    schema_sql = _load_schema_file()
    if not schema_sql:
        return
    conn2 = mysql.connector.connect(database=db_name, **cfg)
    cursor2 = conn2.cursor()
    for stmt in _split_sql(schema_sql):
        try:
            cursor2.execute(stmt)
        except mysql.connector.Error:
            pass
    cursor2.close()
    conn2.close()


async def init_db() -> None:
    """Asynchronously initialise the database."""
    await asyncio.to_thread(init_db_sync)


def _run_query(
    query: str,
    params: Optional[Iterable[Any]] = None,
    fetch: bool = False,
    many: bool = False,
    cursor_class: Optional[Any] = None,
) -> Optional[List[Dict[str, Any]]]:
    conn = _get_connection()
    cursor = conn.cursor(dictionary=True) if cursor_class is None else conn.cursor(cursor_class)
    try:
        if many:
            cursor.executemany(query, params or [])
        else:
            cursor.execute(query, params or ())
        rows = cursor.fetchall() if fetch else None
        conn.commit()
        return rows
    finally:
        cursor.close()
        conn.close()


async def execute(
    query: str,
    params: Optional[Iterable[Any]] = None,
    fetch: bool = False,
    many: bool = False,
) -> Optional[List[Dict[str, Any]]]:
    return await asyncio.to_thread(_run_query, query, params, fetch, many)


async def insert_user(username: str, email: str, password_hash: str, role: str = "user", credits: int = 0) -> int:
    await execute(
        "INSERT INTO users (username, email, password_hash, role, credits) VALUES (%s, %s, %s, %s, %s)",
        (username, email, password_hash, role, credits),
    )
    rows = await execute(
        "SELECT id FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    return int(rows[0]["id"]) if rows else 0


async def find_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    rows = await execute(
        "SELECT * FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    return rows[0] if rows else None


async def find_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    rows = await execute(
        "SELECT * FROM users WHERE id=%s",
        (user_id,),
        fetch=True,
    )
    return rows[0] if rows else None


async def insert_session(user_id: int, token: str, expires_at: str) -> None:
    await execute(
        "INSERT INTO sessions (user_id, token, expires_at) VALUES (%s, %s, %s)",
        (user_id, token, expires_at),
    )


async def find_session(token: str) -> Optional[Dict[str, Any]]:
    rows = await execute(
        "SELECT * FROM sessions WHERE token=%s",
        (token,),
        fetch=True,
    )
    return rows[0] if rows else None


async def delete_session(token: str) -> None:
    await execute(
        "DELETE FROM sessions WHERE token=%s",
        (token,),
    )


async def insert_promo_code(code: str, bonus_attempts: int, max_uses: int = 1, expires_at: Optional[str] = None) -> int:
    await execute(
        "INSERT INTO promo_codes (code, bonus_attempts, max_uses, expires_at) VALUES (%s, %s, %s, %s)",
        (code, bonus_attempts, max_uses, expires_at),
    )
    rows = await execute(
        "SELECT id FROM promo_codes WHERE code=%s",
        (code,),
        fetch=True,
    )
    return int(rows[0]["id"]) if rows else 0


async def find_promo_code(code: str) -> Optional[Dict[str, Any]]:
    rows = await execute(
        "SELECT * FROM promo_codes WHERE code=%s",
        (code,),
        fetch=True,
    )
    return rows[0] if rows else None


async def insert_promo_redemption(user_id: int, promo_code_id: int) -> None:
    await execute(
        "INSERT INTO promo_redemptions (user_id, promo_code_id) VALUES (%s, %s)",
        (user_id, promo_code_id),
    )


async def increment_promo_uses(promo_code_id: int) -> None:
    await execute(
        "UPDATE promo_codes SET uses=uses+1 WHERE id=%s",
        (promo_code_id,),
    )


async def find_user_promo_redemption(user_id: int, promo_code_id: int) -> Optional[Dict[str, Any]]:
    rows = await execute(
        "SELECT * FROM promo_redemptions WHERE user_id=%s AND promo_code_id=%s",
        (user_id, promo_code_id),
        fetch=True,
    )
    return rows[0] if rows else None


async def adjust_user_credits(user_id: int, delta: int) -> None:
    await execute(
        "UPDATE users SET credits=GREATEST(0, credits+%s) WHERE id=%s",
        (delta, user_id),
    )


async def get_user_credits(user_id: int) -> int:
    rows = await execute(
        "SELECT credits FROM users WHERE id=%s",
        (user_id,),
        fetch=True,
    )
    return int(rows[0]["credits"]) if rows else 0


async def get_daily_usage(user_id: int, usage_date: str) -> int:
    rows = await execute(
        "SELECT used_count FROM daily_usage WHERE user_id=%s AND usage_date=%s",
        (user_id, usage_date),
        fetch=True,
    )
    return int(rows[0]["used_count"]) if rows else 0


async def increment_daily_usage(user_id: int, usage_date: str) -> None:
    await execute(
        "INSERT INTO daily_usage (user_id, usage_date, used_count) VALUES (%s, %s, 1) ON DUPLICATE KEY UPDATE used_count=used_count+1",
        (user_id, usage_date),
    )


async def insert_simulation(simulation_id: str, user_id: Optional[int], status: str, user_context: Dict[str, Any]) -> None:
    payload = json.dumps(user_context, ensure_ascii=False)
    await execute(
        "INSERT INTO simulations (simulation_id, user_id, status, user_context) VALUES (%s, %s, %s, %s) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id), status=VALUES(status), user_context=VALUES(user_context)",
        (simulation_id, user_id, status, payload),
    )


async def update_simulation(simulation_id: str, status: Optional[str] = None, summary: Optional[str] = None, ended_at: Optional[str] = None) -> None:
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
    rows: List[Tuple[Any, ...]] = []
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
        "INSERT INTO agents (simulation_id, agent_id, short_id, category_id, template_id, archetype_name, traits, biases, influence_weight, is_leader, fixed_opinion, initial_opinion, current_opinion, confidence) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        rows,
        many=True,
    )


async def insert_reasoning_step(simulation_id: str, data: Dict[str, Any]) -> None:
    await execute(
        "INSERT INTO reasoning_steps (simulation_id, agent_id, agent_short_id, archetype_name, iteration, phase, reply_to_agent_id, opinion, message) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
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


async def insert_metrics(simulation_id: str, data: Dict[str, Any]) -> None:
    await execute(
        "INSERT INTO metrics (simulation_id, iteration, accepted, rejected, neutral, acceptance_rate, polarization, per_category) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
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


async def insert_research_session(user_id: int, query: str, location: Optional[str], category: Optional[str], search_results: Dict[str, Any], structured: Dict[str, Any], evidence_cards: List[Any], map_data: Dict[str, Any], pages: List[Dict[str, Any]]) -> int:
    await execute(
        "INSERT INTO research_sessions (user_id, query, location, category, search_results, structured, evidence_cards, map_data, pages) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            user_id,
            query,
            location,
            category,
            json.dumps(search_results, ensure_ascii=False),
            json.dumps(structured, ensure_ascii=False),
            json.dumps(evidence_cards, ensure_ascii=False),
            json.dumps(map_data, ensure_ascii=False),
            json.dumps(pages, ensure_ascii=False),
        ),
    )
    rows = await execute(
        "SELECT LAST_INSERT_ID() AS id",
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
        "SELECT agent_id, agent_short_id, archetype_name, iteration, phase, reply_to_agent_id, opinion, message, created_at FROM reasoning_steps WHERE simulation_id=%s ORDER BY id ASC",
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
    grouped = [
        {"phase": phase, "lines": lines} for phase, lines in phases.items()
    ]
    return grouped
