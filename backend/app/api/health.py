"""Health endpoints for DB and auth diagnostics."""

from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Any, Dict, Optional

from fastapi import APIRouter, status
from fastapi.responses import JSONResponse

from ..core import auth as auth_core
from ..core import db as db_core


router = APIRouter(tags=["health"])


def _db_name() -> str:
    return os.getenv("DB_NAME") or os.getenv("MYSQL_DATABASE") or "agentic_simulator"


def _truthy(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


@router.get("/health/db")
async def health_db() -> JSONResponse:
    """Return DB/auth health details and use 503 when degraded."""

    db_name = _db_name()
    admin_username = os.getenv("ADMIN_USERNAME") or os.getenv("BOOTSTRAP_ADMIN_USERNAME") or "admin"
    admin_password = os.getenv("ADMIN_PASSWORD") or os.getenv("BOOTSTRAP_ADMIN_PASSWORD")
    default_username = os.getenv("DEFAULT_USER_USERNAME") or "user"
    default_password = os.getenv("DEFAULT_USER_PASSWORD")

    payload: Dict[str, Any] = {
        "status": "ok",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "database": {
            "configured_name": db_name,
            "connected": False,
            "name": None,
            "users_count": 0,
            "missing_tables": [],
            "expires_at_types": {},
            "bad_expires_type_tables": [],
            "migration_ok": False,
        },
        "auth": {
            "auth_required": _truthy(os.getenv("AUTH_REQUIRED", "false")),
            "jwt_secret_configured": bool(os.getenv("JWT_SECRET")),
            "admin_username": admin_username,
            "admin_exists": False,
            "admin_role": None,
            "admin_email_verified": None,
            "admin_password_configured": bool(admin_password),
            "admin_env_login_ok": None,
            "default_username": default_username,
            "default_exists": False,
            "default_role": None,
            "default_email_verified": None,
            "default_password_configured": bool(default_password),
            "default_env_login_ok": None,
        },
    }

    try:
        db_row = await db_core.execute("SELECT DATABASE() AS name", fetch=True)
        connected_db_name = (db_row or [{}])[0].get("name")
        payload["database"]["connected"] = bool(connected_db_name)
        payload["database"]["name"] = connected_db_name

        users_row = await db_core.execute("SELECT COUNT(*) AS total FROM users", fetch=True)
        payload["database"]["users_count"] = int((users_row or [{}])[0].get("total") or 0)

        critical_tables = [
            "users",
            "refresh_tokens",
            "email_verifications",
            "password_resets",
            "audit_logs",
            "simulations",
        ]
        table_rows = await db_core.execute(
            "SELECT table_name FROM information_schema.tables WHERE table_schema=%s",
            (db_name,),
            fetch=True,
        )
        existing_tables = {str(row.get("table_name")) for row in (table_rows or [])}
        missing_tables = [name for name in critical_tables if name not in existing_tables]

        expires_rows = await db_core.execute(
            """
            SELECT table_name, data_type
            FROM information_schema.columns
            WHERE table_schema=%s
              AND table_name IN ('refresh_tokens', 'email_verifications', 'password_resets')
              AND column_name='expires_at'
            ORDER BY table_name
            """,
            (db_name,),
            fetch=True,
        )
        expires_map = {
            str(row.get("table_name")): str(row.get("data_type") or "").lower()
            for row in (expires_rows or [])
        }
        bad_expires_type_tables = [
            name
            for name in ("refresh_tokens", "email_verifications", "password_resets")
            if expires_map.get(name) != "datetime"
        ]

        payload["database"]["missing_tables"] = missing_tables
        payload["database"]["expires_at_types"] = expires_map
        payload["database"]["bad_expires_type_tables"] = bad_expires_type_tables
        payload["database"]["migration_ok"] = not missing_tables and not bad_expires_type_tables
    except Exception as exc:
        payload["status"] = "error"
        payload["database"]["error"] = str(exc)
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content=payload)

    try:
        admin_rows = await db_core.execute(
            "SELECT id, role, email_verified FROM users WHERE username=%s",
            (admin_username,),
            fetch=True,
        )
        if admin_rows:
            admin = admin_rows[0]
            payload["auth"]["admin_exists"] = True
            payload["auth"]["admin_role"] = admin.get("role")
            payload["auth"]["admin_email_verified"] = bool(admin.get("email_verified"))

        if admin_password:
            auth_user_id = await auth_core.authenticate_user(admin_username, admin_password)
            payload["auth"]["admin_env_login_ok"] = bool(auth_user_id)

        default_rows = await db_core.execute(
            "SELECT id, role, email_verified FROM users WHERE username=%s",
            (default_username,),
            fetch=True,
        )
        if default_rows:
            default_user = default_rows[0]
            payload["auth"]["default_exists"] = True
            payload["auth"]["default_role"] = default_user.get("role")
            payload["auth"]["default_email_verified"] = bool(default_user.get("email_verified"))

        if default_password:
            default_auth_user_id = await auth_core.authenticate_user(default_username, default_password)
            payload["auth"]["default_env_login_ok"] = bool(default_auth_user_id)
    except Exception as exc:
        payload["auth"]["error"] = str(exc)
        payload["auth"]["admin_env_login_ok"] = False
        payload["auth"]["default_env_login_ok"] = False

    healthy = bool(payload["database"]["connected"]) and bool(payload["database"]["migration_ok"])
    if not payload["auth"]["jwt_secret_configured"]:
        healthy = False
    if payload["auth"]["admin_password_configured"] and payload["auth"]["admin_env_login_ok"] is False:
        healthy = False
    if payload["auth"]["default_password_configured"] and payload["auth"]["default_env_login_ok"] is False:
        healthy = False

    payload["status"] = "ok" if healthy else "degraded"
    code = status.HTTP_200_OK if healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    return JSONResponse(status_code=code, content=payload)
