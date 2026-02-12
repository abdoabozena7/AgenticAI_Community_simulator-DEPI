"""
MySQL persistence helpers for simulation data.

Uses mysql-connector-python to write simulation runs, agents, reasoning steps,
and metrics into a local MySQL (XAMPP) instance.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import mysql.connector
from mysql.connector import pooling

DEFAULT_DB_NAME = "agentic_simulator"
_POOL_LOCK = threading.Lock()
_POOLS: Dict[str, pooling.MySQLConnectionPool] = {}


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


def _pool_key(include_db: bool = True) -> str:
    cfg = _db_config(include_db)
    return "|".join(
        [
            str(cfg.get("host") or ""),
            str(cfg.get("port") or ""),
            str(cfg.get("user") or ""),
            str(cfg.get("database") or "_no_db"),
        ]
    )


def _get_pool(include_db: bool = True) -> pooling.MySQLConnectionPool:
    key = _pool_key(include_db)
    with _POOL_LOCK:
        pool_obj = _POOLS.get(key)
        if pool_obj is not None:
            return pool_obj
        cfg = _db_config(include_db)
        try:
            pool_size = int(os.getenv("DB_POOL_SIZE", "20"))
        except ValueError:
            pool_size = 20
        pool_size = max(1, min(64, pool_size))
        pool_name = f"agentic_pool_{abs(hash(key)) % 1000000}"
        pool_obj = pooling.MySQLConnectionPool(
            pool_name=pool_name,
            pool_size=pool_size,
            pool_reset_session=True,
            **cfg,
        )
        _POOLS[key] = pool_obj
        return pool_obj


def _connect(include_db: bool = True) -> mysql.connector.MySQLConnection:
    disable_pool = str(os.getenv("DB_DISABLE_POOL", "0")).strip().lower() in {"1", "true", "yes", "on"}
    if disable_pool:
        return mysql.connector.connect(**_db_config(include_db))
    conn = _get_pool(include_db).get_connection()
    conn.autocommit = True
    return conn


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
        "ALTER TABLE users MODIFY credits DECIMAL(12,2) NOT NULL DEFAULT 0.00",
        "ALTER TABLE refresh_tokens MODIFY expires_at DATETIME NOT NULL",
        "ALTER TABLE email_verifications MODIFY expires_at DATETIME NOT NULL",
        "ALTER TABLE password_resets MODIFY expires_at DATETIME NOT NULL",
        "ALTER TABLE metrics ADD COLUMN total_agents INT NULL AFTER polarization",
        "ALTER TABLE agents ADD COLUMN last_phase VARCHAR(64) NULL AFTER current_opinion",
        "ALTER TABLE reasoning_steps ADD COLUMN reply_to_short_id VARCHAR(8) NULL AFTER reply_to_agent_id",
        "ALTER TABLE reasoning_steps ADD COLUMN agent_label VARCHAR(32) NULL AFTER agent_short_id",
        "ALTER TABLE reasoning_steps ADD COLUMN opinion_source VARCHAR(24) NULL AFTER opinion",
        "ALTER TABLE reasoning_steps ADD COLUMN stance_confidence FLOAT NULL AFTER opinion_source",
        "ALTER TABLE reasoning_steps ADD COLUMN reasoning_length VARCHAR(16) NULL AFTER stance_confidence",
        "ALTER TABLE reasoning_steps ADD COLUMN fallback_reason VARCHAR(64) NULL AFTER reasoning_length",
        "ALTER TABLE reasoning_steps ADD COLUMN relevance_score FLOAT NULL AFTER fallback_reason",
        "ALTER TABLE reasoning_steps ADD COLUMN policy_guard TINYINT(1) NULL AFTER relevance_score",
        "ALTER TABLE reasoning_steps ADD COLUMN policy_reason VARCHAR(128) NULL AFTER policy_guard",
        "ALTER TABLE reasoning_steps ADD COLUMN stance_locked TINYINT(1) NULL AFTER policy_reason",
        "ALTER TABLE reasoning_steps ADD COLUMN reason_tag VARCHAR(64) NULL AFTER stance_locked",
        "ALTER TABLE reasoning_steps ADD COLUMN clarification_triggered TINYINT(1) NULL AFTER reason_tag",
        "ALTER TABLE reasoning_steps ADD COLUMN step_uid VARCHAR(96) NULL AFTER reasoning_length",
        "ALTER TABLE reasoning_steps ADD COLUMN event_seq BIGINT NULL AFTER step_uid",
        "ALTER TABLE reasoning_steps ADD COLUMN stance_before VARCHAR(16) NULL AFTER event_seq",
        "ALTER TABLE reasoning_steps ADD COLUMN stance_after VARCHAR(16) NULL AFTER stance_before",
        "CREATE UNIQUE INDEX uq_reasoning_step_uid ON reasoning_steps (simulation_id, step_uid)",
        "ALTER TABLE simulation_checkpoints ADD COLUMN status_reason VARCHAR(32) NULL AFTER last_error",
        "ALTER TABLE simulation_checkpoints ADD COLUMN current_phase_key VARCHAR(64) NULL AFTER status_reason",
        "ALTER TABLE simulation_checkpoints ADD COLUMN phase_progress_pct FLOAT NULL AFTER current_phase_key",
        "ALTER TABLE simulation_checkpoints ADD COLUMN event_seq BIGINT NULL AFTER phase_progress_pct",
        (
            "CREATE TABLE IF NOT EXISTS research_events ("
            "id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            "simulation_id VARCHAR(36) NOT NULL, "
            "event_seq BIGINT NULL, "
            "url TEXT NULL, "
            "domain VARCHAR(255) NULL, "
            "favicon_url VARCHAR(1024) NULL, "
            "action VARCHAR(32) NULL, "
            "status VARCHAR(24) NULL, "
            "snippet TEXT NULL, "
            "error TEXT NULL, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "INDEX idx_research_events_sim (simulation_id), "
            "INDEX idx_research_events_seq (simulation_id, event_seq), "
            "CONSTRAINT fk_research_events_sim FOREIGN KEY (simulation_id) "
            "REFERENCES simulations(simulation_id) ON DELETE CASCADE"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        ),
        "ALTER TABLE research_events ADD COLUMN favicon_url VARCHAR(1024) NULL AFTER domain",
        "ALTER TABLE research_events ADD COLUMN title VARCHAR(512) NULL AFTER status",
        "ALTER TABLE research_events ADD COLUMN http_status INT NULL AFTER title",
        "ALTER TABLE research_events ADD COLUMN content_chars INT NULL AFTER http_status",
        "ALTER TABLE research_events ADD COLUMN relevance_score FLOAT NULL AFTER content_chars",
        (
            "CREATE TABLE IF NOT EXISTS simulation_chat_events ("
            "id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            "simulation_id VARCHAR(36) NOT NULL, "
            "event_seq BIGINT NOT NULL, "
            "message_id VARCHAR(64) NOT NULL, "
            "role VARCHAR(16) NOT NULL, "
            "content LONGTEXT NOT NULL, "
            "meta_json JSON NULL, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "INDEX idx_chat_events_sim_seq (simulation_id, event_seq), "
            "UNIQUE KEY uq_chat_events_sim_msg (simulation_id, message_id), "
            "CONSTRAINT fk_chat_events_sim FOREIGN KEY (simulation_id) "
            "REFERENCES simulations(simulation_id) ON DELETE CASCADE"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        ),
        (
            "CREATE TABLE IF NOT EXISTS daily_token_usage ("
            "id BIGINT AUTO_INCREMENT PRIMARY KEY, "
            "user_id BIGINT NOT NULL, "
            "usage_date DATE NOT NULL, "
            "used_tokens INT NOT NULL DEFAULT 0, "
            "created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, "
            "UNIQUE KEY uq_daily_tokens_user_date (user_id, usage_date), "
            "INDEX idx_daily_tokens_user (user_id), "
            "CONSTRAINT fk_daily_tokens_user FOREIGN KEY (user_id) "
            "REFERENCES users(id) ON DELETE CASCADE"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        ),
        (
            "CREATE TABLE IF NOT EXISTS app_settings ("
            "setting_key VARCHAR(64) PRIMARY KEY, "
            "setting_value VARCHAR(255) NOT NULL, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        ),
        (
            "CREATE TABLE IF NOT EXISTS simulation_token_usage ("
            "simulation_id VARCHAR(36) PRIMARY KEY, "
            "user_id BIGINT NOT NULL, "
            "used_tokens INT NOT NULL DEFAULT 0, "
            "free_tokens_applied INT NOT NULL DEFAULT 0, "
            "credits_charged DECIMAL(12,2) NOT NULL DEFAULT 0.00, "
            "updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, "
            "INDEX idx_sim_token_user (user_id), "
            "CONSTRAINT fk_sim_token_sim FOREIGN KEY (simulation_id) "
            "REFERENCES simulations(simulation_id) ON DELETE CASCADE, "
            "CONSTRAINT fk_sim_token_user FOREIGN KEY (user_id) "
            "REFERENCES users(id) ON DELETE CASCADE"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        ),
        (
            "INSERT INTO app_settings (setting_key, setting_value) VALUES "
            "('token_price_per_1k_credits', '0.10') "
            "ON DUPLICATE KEY UPDATE setting_value=setting_value"
        ),
        (
            "INSERT INTO app_settings (setting_key, setting_value) VALUES "
            "('free_daily_tokens', '2500') "
            "ON DUPLICATE KEY UPDATE setting_value=setting_value"
        ),
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
    try:
        max_retries = int(os.getenv("DB_QUERY_RETRIES", "3"))
    except ValueError:
        max_retries = 3
    max_retries = max(1, min(8, max_retries))
    backoff_base = float(os.getenv("DB_RETRY_BACKOFF_SECONDS", "0.15") or 0.15)

    def _is_retryable(exc: Exception) -> bool:
        if not isinstance(exc, mysql.connector.Error):
            return False
        err_no = getattr(exc, "errno", None)
        if err_no in {2003, 2006, 2013, 2055, 1040}:
            return True
        lowered = str(exc).lower()
        return "10048" in lowered or "can't connect to mysql server" in lowered

    last_exc: Optional[Exception] = None
    for attempt in range(max_retries):
        conn = None
        cursor = None
        try:
            conn = _connect(include_db=True)
            cursor = conn.cursor(dictionary=True)
            if many:
                cursor.executemany(query, params or [])
            else:
                cursor.execute(query, params or ())
            return cursor.fetchall() if fetch else None
        except Exception as exc:
            last_exc = exc
            if attempt >= max_retries - 1 or not _is_retryable(exc):
                raise
            sleep_for = min(1.0, backoff_base * (2 ** attempt))
            time.sleep(max(0.01, sleep_for))
        finally:
            if cursor is not None:
                try:
                    cursor.close()
                except Exception:
                    pass
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass
    if last_exc is not None:
        raise last_exc
    return None


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


async def update_simulation_context(simulation_id: str, user_context: Dict[str, Any]) -> None:
    payload = json.dumps(user_context, ensure_ascii=False)
    await execute(
        "UPDATE simulations SET user_context=%s WHERE simulation_id=%s",
        (payload, simulation_id),
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


async def upsert_simulation_checkpoint(
    simulation_id: str,
    checkpoint: Optional[Dict[str, Any]],
    status: str = "running",
    last_error: Optional[str] = None,
    status_reason: Optional[str] = None,
    current_phase_key: Optional[str] = None,
    phase_progress_pct: Optional[float] = None,
    event_seq: Optional[int] = None,
) -> None:
    if status_reason is None and isinstance(checkpoint, dict):
        meta = checkpoint.get("meta") if isinstance(checkpoint.get("meta"), dict) else {}
        status_reason = str(meta.get("status_reason") or "").strip() or None
        current_phase_key = current_phase_key if current_phase_key is not None else (str(meta.get("current_phase_key") or "").strip() or None)
        if phase_progress_pct is None:
            try:
                raw_pct = meta.get("phase_progress_pct")
                phase_progress_pct = float(raw_pct) if raw_pct is not None else None
            except Exception:
                phase_progress_pct = None
        if event_seq is None:
            try:
                raw_seq = meta.get("event_seq")
                event_seq = int(raw_seq) if raw_seq is not None else None
            except Exception:
                event_seq = None
    payload = json.dumps(checkpoint or {}, ensure_ascii=False)
    await execute(
        "INSERT INTO simulation_checkpoints (simulation_id, checkpoint_json, status, last_error, status_reason, current_phase_key, phase_progress_pct, event_seq) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "checkpoint_json=VALUES(checkpoint_json), "
        "status=VALUES(status), "
        "last_error=VALUES(last_error), "
        "status_reason=VALUES(status_reason), "
        "current_phase_key=VALUES(current_phase_key), "
        "phase_progress_pct=VALUES(phase_progress_pct), "
        "event_seq=VALUES(event_seq), "
        "updated_at=CURRENT_TIMESTAMP",
        (simulation_id, payload, status, last_error, status_reason, current_phase_key, phase_progress_pct, event_seq),
    )


def _safe_json(value: Any, default: Any) -> Any:
    if value is None:
        return default
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed
        except Exception:
            return default
    return default


def _iso_datetime(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            text = value.isoformat()
            return f"{text}Z" if not str(text).endswith("Z") else str(text)
        except Exception:
            return None
    return str(value)


async def fetch_simulation_checkpoint(simulation_id: str) -> Optional[Dict[str, Any]]:
    rows = await execute(
        "SELECT simulation_id, checkpoint_json, status, last_error, status_reason, current_phase_key, phase_progress_pct, event_seq, updated_at "
        "FROM simulation_checkpoints WHERE simulation_id=%s",
        (simulation_id,),
        fetch=True,
    )
    if not rows:
        return None
    row = rows[0]
    return {
        "simulation_id": row.get("simulation_id"),
        "status": row.get("status") or "running",
        "last_error": row.get("last_error"),
        "status_reason": row.get("status_reason"),
        "current_phase_key": row.get("current_phase_key"),
        "phase_progress_pct": float(row.get("phase_progress_pct")) if row.get("phase_progress_pct") is not None else None,
        "event_seq": int(row.get("event_seq")) if row.get("event_seq") is not None else None,
        "updated_at": row.get("updated_at"),
        "checkpoint": _safe_json(row.get("checkpoint_json"), {}),
    }


async def fetch_simulation_snapshot(simulation_id: str) -> Optional[Dict[str, Any]]:
    sim_rows = await execute(
        "SELECT simulation_id, status, summary, final_metrics, ended_at FROM simulations WHERE simulation_id=%s",
        (simulation_id,),
        fetch=True,
    )
    if not sim_rows:
        return None
    sim_row = sim_rows[0]
    checkpoint_row = await fetch_simulation_checkpoint(simulation_id)
    checkpoint_data = (checkpoint_row or {}).get("checkpoint") or {}
    checkpoint_meta = checkpoint_data.get("meta") if isinstance(checkpoint_data.get("meta"), dict) else {}
    checkpoint_total_iterations = int(checkpoint_meta.get("total_iterations") or 0) if checkpoint_meta else 0
    checkpoint_status_reason = (
        (checkpoint_row or {}).get("status_reason")
        or checkpoint_meta.get("status_reason")
    )
    checkpoint_phase_key = (
        (checkpoint_row or {}).get("current_phase_key")
        or checkpoint_meta.get("current_phase_key")
    )
    checkpoint_phase_progress = (
        (checkpoint_row or {}).get("phase_progress_pct")
        if (checkpoint_row or {}).get("phase_progress_pct") is not None
        else checkpoint_meta.get("phase_progress_pct")
    )
    checkpoint_event_seq = (
        (checkpoint_row or {}).get("event_seq")
        if (checkpoint_row or {}).get("event_seq") is not None
        else checkpoint_meta.get("event_seq")
    )
    checkpoint_policy_mode = (
        checkpoint_meta.get("policy_mode")
        if isinstance(checkpoint_meta, dict)
        else None
    )
    checkpoint_policy_reason = (
        checkpoint_meta.get("policy_reason")
        if isinstance(checkpoint_meta, dict)
        else None
    )
    checkpoint_pending_clarification = (
        checkpoint_meta.get("pending_clarification")
        if isinstance(checkpoint_meta, dict)
        else None
    )
    checkpoint_search_quality = (
        checkpoint_meta.get("search_quality")
        if isinstance(checkpoint_meta, dict)
        else None
    )
    final_metrics_payload = _safe_json(sim_row.get("final_metrics"), {})

    metrics_rows = await execute(
        "SELECT accepted, rejected, neutral, acceptance_rate, polarization, "
        "per_category, iteration, created_at "
        "FROM metrics WHERE simulation_id=%s ORDER BY id DESC LIMIT 1",
        (simulation_id,),
        fetch=True,
    )
    metrics_payload: Optional[Dict[str, Any]] = None
    if metrics_rows:
        latest = metrics_rows[0]
        metrics_payload = {
            "accepted": int(latest.get("accepted") or 0),
            "rejected": int(latest.get("rejected") or 0),
            "neutral": int(latest.get("neutral") or 0),
            "acceptance_rate": float(latest.get("acceptance_rate") or 0.0),
            "polarization": float(latest.get("polarization") or 0.0),
            "total_agents": int(final_metrics_payload.get("total_agents") or 0),
            "per_category": _safe_json(latest.get("per_category"), {}),
            "iteration": int(latest.get("iteration") or 0),
            "total_iterations": checkpoint_total_iterations or int(latest.get("iteration") or 0),
        }
    else:
        if isinstance(final_metrics_payload, dict) and final_metrics_payload:
            metrics_payload = {
                "accepted": int(final_metrics_payload.get("accepted") or 0),
                "rejected": int(final_metrics_payload.get("rejected") or 0),
                "neutral": int(final_metrics_payload.get("neutral") or 0),
                "acceptance_rate": float(final_metrics_payload.get("acceptance_rate") or 0.0),
                "polarization": float(final_metrics_payload.get("polarization") or 0.0),
                "total_agents": int(final_metrics_payload.get("total_agents") or 0),
                "per_category": _safe_json(final_metrics_payload.get("per_category"), {}),
                "iteration": int(final_metrics_payload.get("total_iterations") or 0),
                "total_iterations": int(final_metrics_payload.get("total_iterations") or 0),
            }

    try:
        reasoning_rows = await execute(
            "SELECT agent_id, agent_short_id, agent_label, archetype_name, iteration, phase, reply_to_agent_id, reply_to_short_id, "
            "opinion, opinion_source, stance_confidence, reasoning_length, fallback_reason, relevance_score, "
            "policy_guard, policy_reason, stance_locked, reason_tag, clarification_triggered, step_uid, event_seq, "
            "stance_before, stance_after, message, created_at "
            "FROM reasoning_steps WHERE simulation_id=%s ORDER BY id ASC",
            (simulation_id,),
            fetch=True,
        )
    except Exception:
        # Backward compatibility for databases that have not yet applied step_uid migration.
        reasoning_rows = await execute(
            "SELECT agent_id, agent_short_id, NULL AS agent_label, archetype_name, iteration, phase, reply_to_agent_id, reply_to_short_id, "
            "opinion, opinion_source, stance_confidence, reasoning_length, NULL AS fallback_reason, NULL AS relevance_score, "
            "NULL AS policy_guard, NULL AS policy_reason, NULL AS stance_locked, NULL AS reason_tag, NULL AS clarification_triggered, "
            "NULL AS step_uid, NULL AS event_seq, NULL AS stance_before, NULL AS stance_after, message, created_at "
            "FROM reasoning_steps WHERE simulation_id=%s ORDER BY id ASC",
            (simulation_id,),
            fetch=True,
        )
    reasoning: List[Dict[str, Any]] = []
    for row in reasoning_rows or []:
        reasoning.append(
            {
                "agent_id": row.get("agent_id"),
                "agent_short_id": row.get("agent_short_id"),
                "agent_label": row.get("agent_label"),
                "archetype": row.get("archetype_name"),
                "iteration": int(row.get("iteration") or 0),
                "phase": row.get("phase"),
                "reply_to_agent_id": row.get("reply_to_agent_id"),
                "reply_to_short_id": row.get("reply_to_short_id"),
                "message": row.get("message") or "",
                "opinion": row.get("opinion"),
                "opinion_source": row.get("opinion_source"),
                "stance_confidence": float(row.get("stance_confidence") or 0.0) if row.get("stance_confidence") is not None else None,
                "reasoning_length": row.get("reasoning_length"),
                "fallback_reason": row.get("fallback_reason"),
                "relevance_score": float(row.get("relevance_score") or 0.0) if row.get("relevance_score") is not None else None,
                "policy_guard": bool(row.get("policy_guard")) if row.get("policy_guard") is not None else None,
                "policy_reason": row.get("policy_reason"),
                "stance_locked": bool(row.get("stance_locked")) if row.get("stance_locked") is not None else None,
                "reason_tag": row.get("reason_tag"),
                "clarification_triggered": bool(row.get("clarification_triggered")) if row.get("clarification_triggered") is not None else None,
                "step_uid": row.get("step_uid"),
                "event_seq": int(row.get("event_seq")) if row.get("event_seq") is not None else None,
                "stance_before": row.get("stance_before"),
                "stance_after": row.get("stance_after"),
                "timestamp": int((row.get("created_at") or 0).timestamp() * 1000) if row.get("created_at") else None,
            }
        )

    research_sources = await fetch_research_events(simulation_id)
    chat_events = await fetch_chat_events(simulation_id)

    agents: List[Dict[str, Any]] = []
    checkpoint_agents = checkpoint_data.get("agents")
    if isinstance(checkpoint_agents, list) and checkpoint_agents:
        for item in checkpoint_agents:
            if not isinstance(item, dict):
                continue
            agents.append(
                {
                    "agent_id": str(item.get("agent_id") or ""),
                    "category_id": str(item.get("category_id") or ""),
                    "opinion": str(item.get("current_opinion") or item.get("opinion") or "neutral"),
                    "confidence": float(item.get("confidence") or 0.0),
                }
            )
    if not agents:
        agent_rows = await execute(
            "SELECT agent_id, category_id, current_opinion, confidence FROM agents WHERE simulation_id=%s",
            (simulation_id,),
            fetch=True,
        )
        for row in agent_rows or []:
            agents.append(
                {
                    "agent_id": row.get("agent_id"),
                    "category_id": row.get("category_id"),
                    "opinion": row.get("current_opinion") or "neutral",
                    "confidence": float(row.get("confidence") or 0.0),
                }
            )
    if metrics_payload is not None:
        total_agents_value = int(metrics_payload.get("total_agents") or 0)
        if total_agents_value <= 0:
            fallback_total = int(final_metrics_payload.get("total_agents") or 0)
            if fallback_total <= 0:
                fallback_total = len(agents)
            metrics_payload["total_agents"] = fallback_total

    status_value = str(sim_row.get("status") or "running").lower()
    checkpoint_status = str((checkpoint_row or {}).get("status") or "").lower()
    if checkpoint_status in {"running", "paused", "completed", "error"}:
        if status_value in {"running", "paused"} or checkpoint_status in {"error", "completed"}:
            status_value = checkpoint_status

    ended_at_iso = _iso_datetime(sim_row.get("ended_at"))
    summary_text = sim_row.get("summary")
    last_error = (checkpoint_row or {}).get("last_error")
    can_resume = status_value in {"error", "paused"} and str(checkpoint_status_reason or "").strip().lower() != "paused_clarification_needed"

    return {
        "simulation_id": simulation_id,
        "status": status_value,
        "status_reason": checkpoint_status_reason,
        "summary": summary_text,
        "summary_ready": bool(summary_text),
        "summary_at": ended_at_iso,
        "metrics": metrics_payload,
        "agents": agents,
        "reasoning": reasoning,
        "chat_events": chat_events,
        "research_sources": research_sources,
        "can_resume": can_resume,
        "resume_reason": last_error,
        "current_phase_key": str(checkpoint_phase_key) if checkpoint_phase_key else None,
        "phase_progress_pct": float(checkpoint_phase_progress) if checkpoint_phase_progress is not None else None,
        "event_seq": int(checkpoint_event_seq) if checkpoint_event_seq is not None else None,
        "policy_mode": str(checkpoint_policy_mode) if checkpoint_policy_mode else None,
        "policy_reason": str(checkpoint_policy_reason) if checkpoint_policy_reason else None,
        "search_quality": checkpoint_search_quality if isinstance(checkpoint_search_quality, dict) else None,
        "pending_clarification": checkpoint_pending_clarification if isinstance(checkpoint_pending_clarification, dict) else None,
        "can_answer_clarification": bool(isinstance(checkpoint_pending_clarification, dict) and checkpoint_pending_clarification),
        "checkpoint": checkpoint_data,
    }


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
    step_uid = data.get("step_uid")
    if step_uid:
        existing = await execute(
            "SELECT id FROM reasoning_steps WHERE simulation_id=%s AND step_uid=%s LIMIT 1",
            (simulation_id, step_uid),
            fetch=True,
        )
        if existing:
            return
    try:
        await execute(
            "INSERT INTO reasoning_steps (simulation_id, agent_id, agent_short_id, agent_label, archetype_name, iteration, phase, "
            "reply_to_agent_id, reply_to_short_id, opinion, opinion_source, stance_confidence, reasoning_length, fallback_reason, relevance_score, "
            "policy_guard, policy_reason, stance_locked, reason_tag, clarification_triggered, step_uid, event_seq, stance_before, stance_after, message) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE "
            "message=VALUES(message), "
            "opinion=VALUES(opinion), "
            "opinion_source=VALUES(opinion_source), "
            "stance_confidence=VALUES(stance_confidence), "
            "reasoning_length=VALUES(reasoning_length), "
            "fallback_reason=VALUES(fallback_reason), "
            "relevance_score=VALUES(relevance_score), "
            "policy_guard=VALUES(policy_guard), "
            "policy_reason=VALUES(policy_reason), "
            "stance_locked=VALUES(stance_locked), "
            "reason_tag=VALUES(reason_tag), "
            "clarification_triggered=VALUES(clarification_triggered), "
            "event_seq=VALUES(event_seq), "
            "stance_before=VALUES(stance_before), "
            "stance_after=VALUES(stance_after)",
            (
                simulation_id,
                data.get("agent_id"),
                data.get("agent_short_id"),
                data.get("agent_label"),
                data.get("archetype"),
                data.get("iteration"),
                data.get("phase"),
                data.get("reply_to_agent_id"),
                data.get("reply_to_short_id"),
                data.get("opinion"),
                data.get("opinion_source"),
                data.get("stance_confidence"),
                data.get("reasoning_length"),
                data.get("fallback_reason"),
                data.get("relevance_score"),
                data.get("policy_guard"),
                data.get("policy_reason"),
                data.get("stance_locked"),
                data.get("reason_tag"),
                data.get("clarification_triggered"),
                step_uid,
                data.get("event_seq"),
                data.get("stance_before"),
                data.get("stance_after"),
                data.get("message"),
            ),
        )
    except Exception:
        # Backward compatibility for databases that have not yet applied step_uid migration.
        await execute(
            "INSERT INTO reasoning_steps (simulation_id, agent_id, agent_short_id, archetype_name, iteration, phase, "
            "reply_to_agent_id, reply_to_short_id, opinion, opinion_source, stance_confidence, reasoning_length, message) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            (
                simulation_id,
                data.get("agent_id"),
                data.get("agent_short_id"),
                data.get("archetype"),
                data.get("iteration"),
                data.get("phase"),
                data.get("reply_to_agent_id"),
                data.get("reply_to_short_id"),
                data.get("opinion"),
                data.get("opinion_source"),
                data.get("stance_confidence"),
                data.get("reasoning_length"),
                data.get("message"),
            ),
        )


async def update_agent_runtime_state(
    simulation_id: str,
    agent_id: str,
    opinion: str,
    confidence: float,
    phase: Optional[str] = None,
) -> None:
    await execute(
        "UPDATE agents SET current_opinion=%s, confidence=%s, last_phase=%s WHERE simulation_id=%s AND agent_id=%s",
        (opinion, confidence, phase, simulation_id, agent_id),
    )


async def fetch_simulation_agents_filtered(
    simulation_id: str,
    stance: Optional[str] = None,
    phase: Optional[str] = None,
    page: int = 1,
    page_size: int = 50,
) -> Dict[str, Any]:
    page = max(1, int(page or 1))
    page_size = max(1, min(200, int(page_size or 50)))
    offset = (page - 1) * page_size
    where_parts = ["simulation_id=%s"]
    params: List[Any] = [simulation_id]
    if stance in {"accept", "reject", "neutral"}:
        where_parts.append("current_opinion=%s")
        params.append(stance)
    if phase:
        where_parts.append("(last_phase=%s OR last_phase IS NULL)")
        params.append(phase)
    where_sql = " AND ".join(where_parts)
    total_rows = await execute(
        f"SELECT COUNT(*) AS total FROM agents WHERE {where_sql}",
        tuple(params),
        fetch=True,
    )
    rows = await execute(
        f"SELECT agent_id, short_id, archetype_name, category_id, current_opinion, confidence, last_phase "
        f"FROM agents WHERE {where_sql} ORDER BY id ASC LIMIT %s OFFSET %s",
        tuple(params + [page_size, offset]),
        fetch=True,
    )
    items: List[Dict[str, Any]] = []
    for idx, row in enumerate(rows or []):
        items.append(
            {
                "agent_id": row.get("agent_id"),
                "agent_short_id": row.get("short_id") or str(row.get("agent_id") or "")[:4],
                "agent_label": f"Agent {offset + idx + 1}",
                "archetype": row.get("archetype_name"),
                "category_id": row.get("category_id"),
                "opinion": row.get("current_opinion") or "neutral",
                "confidence": float(row.get("confidence") or 0.0),
                "phase": row.get("last_phase"),
            }
        )
    total = int((total_rows or [{}])[0].get("total") or 0)
    return {
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
    }


async def insert_research_event(simulation_id: str, data: Dict[str, Any]) -> None:
    await execute(
        "INSERT INTO research_events (simulation_id, event_seq, url, domain, favicon_url, action, status, title, http_status, content_chars, relevance_score, snippet, error) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            simulation_id,
            data.get("event_seq"),
            data.get("url"),
            data.get("domain"),
            data.get("favicon_url"),
            data.get("action"),
            data.get("status"),
            data.get("title"),
            data.get("http_status"),
            data.get("content_chars"),
            data.get("relevance_score"),
            data.get("snippet"),
            data.get("error"),
        ),
    )


async def fetch_research_events(simulation_id: str) -> List[Dict[str, Any]]:
    rows = await execute(
        "SELECT event_seq, url, domain, favicon_url, action, status, title, http_status, content_chars, relevance_score, snippet, error, created_at "
        "FROM research_events WHERE simulation_id=%s ORDER BY id ASC",
        (simulation_id,),
        fetch=True,
    )
    items: List[Dict[str, Any]] = []
    for row in rows or []:
        items.append(
            {
                "event_seq": int(row.get("event_seq")) if row.get("event_seq") is not None else None,
                "url": row.get("url"),
                "domain": row.get("domain"),
                "favicon_url": row.get("favicon_url"),
                "action": row.get("action"),
                "status": row.get("status"),
                "title": row.get("title"),
                "http_status": int(row.get("http_status")) if row.get("http_status") is not None else None,
                "content_chars": int(row.get("content_chars")) if row.get("content_chars") is not None else None,
                "relevance_score": float(row.get("relevance_score")) if row.get("relevance_score") is not None else None,
                "snippet": row.get("snippet"),
                "error": row.get("error"),
                "timestamp": int((row.get("created_at") or 0).timestamp() * 1000) if row.get("created_at") else None,
            }
        )
    return items


async def insert_chat_event(
    simulation_id: str,
    *,
    event_seq: int,
    message_id: str,
    role: str,
    content: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    await execute(
        "INSERT INTO simulation_chat_events (simulation_id, event_seq, message_id, role, content, meta_json) "
        "VALUES (%s, %s, %s, %s, %s, %s) "
        "ON DUPLICATE KEY UPDATE "
        "event_seq=VALUES(event_seq), "
        "role=VALUES(role), "
        "content=VALUES(content), "
        "meta_json=VALUES(meta_json)",
        (
            simulation_id,
            int(event_seq),
            str(message_id),
            str(role),
            str(content or ""),
            json.dumps(meta or {}, ensure_ascii=False),
        ),
    )


async def fetch_chat_events(simulation_id: str) -> List[Dict[str, Any]]:
    rows = await execute(
        "SELECT event_seq, message_id, role, content, meta_json, created_at "
        "FROM simulation_chat_events WHERE simulation_id=%s ORDER BY event_seq ASC, id ASC",
        (simulation_id,),
        fetch=True,
    )
    items: List[Dict[str, Any]] = []
    for row in rows or []:
        items.append(
            {
                "event_seq": int(row.get("event_seq") or 0),
                "message_id": row.get("message_id"),
                "role": row.get("role"),
                "content": row.get("content") or "",
                "meta": _safe_json(row.get("meta_json"), {}),
                "timestamp": int((row.get("created_at") or 0).timestamp() * 1000) if row.get("created_at") else None,
            }
        )
    return items


async def insert_reasoning_steps_bulk(simulation_id: str, steps: List[Dict[str, Any]]) -> None:
    if not steps:
        return
    for step in steps:
        await insert_reasoning_step(simulation_id, step)


async def insert_metrics(simulation_id: str, data: Dict[str, Any]) -> None:
    await execute(
        "INSERT INTO metrics (simulation_id, iteration, accepted, rejected, neutral, acceptance_rate, polarization, total_agents, per_category) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            simulation_id,
            data.get("iteration"),
            data.get("accepted"),
            data.get("rejected"),
            data.get("neutral"),
            data.get("acceptance_rate"),
            data.get("polarization"),
            data.get("total_agents"),
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
        "SELECT agent_id, agent_short_id, archetype_name, iteration, phase, reply_to_agent_id, reply_to_short_id, "
        "opinion, opinion_source, stance_confidence, reasoning_length, message, created_at "
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
                "reply_to_short_id": row.get("reply_to_short_id") or short_map.get(row.get("reply_to_agent_id")),
                "opinion": row.get("opinion"),
                "opinion_source": row.get("opinion_source"),
                "stance_confidence": row.get("stance_confidence"),
                "reasoning_length": row.get("reasoning_length"),
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
