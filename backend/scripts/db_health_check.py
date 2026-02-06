"""DB migration + auth health check.

Usage:
    ..\\.venv\\Scripts\\python.exe backend\\scripts\\db_health_check.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv

# Allow running as a standalone script from repo root or backend folder.
REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.core import auth  # noqa: E402
from backend.app.core import db  # noqa: E402


def _backend_env_path() -> Path:
    return Path(__file__).resolve().parents[1] / ".env"


async def _query_one(query: str, params: tuple[Any, ...] = ()) -> Dict[str, Any]:
    rows = await db.execute(query, params, fetch=True)
    return (rows or [{}])[0]


async def run() -> int:
    load_dotenv(_backend_env_path())
    await db.init_db()
    await auth.ensure_admin_user()

    db_name = os.getenv("DB_NAME") or os.getenv("MYSQL_DATABASE") or "agentic_simulator"
    admin_username = os.getenv("ADMIN_USERNAME") or "admin"
    admin_password = os.getenv("ADMIN_PASSWORD") or ""

    db_info = await _query_one("SELECT DATABASE() AS name")
    users_info = await _query_one("SELECT COUNT(*) AS total FROM users")

    critical_tables: List[str] = [
        "users",
        "refresh_tokens",
        "email_verifications",
        "password_resets",
        "audit_logs",
        "simulations",
    ]

    table_rows = await db.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema=%s
        """,
        (db_name,),
        fetch=True,
    )
    existing_tables = {str(row.get("table_name")) for row in (table_rows or [])}
    missing_tables = [name for name in critical_tables if name not in existing_tables]

    expires_rows = await db.execute(
        """
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema=%s
          AND table_name IN ('refresh_tokens','email_verifications','password_resets')
          AND column_name='expires_at'
        ORDER BY table_name
        """,
        (db_name,),
        fetch=True,
    )

    expires_map = {str(r.get("table_name")): str(r.get("data_type")).lower() for r in (expires_rows or [])}
    bad_expires = [t for t in ("refresh_tokens", "email_verifications", "password_resets") if expires_map.get(t) != "datetime"]

    admin_auth_user_id = None
    if admin_password:
        admin_auth_user_id = await auth.authenticate_user(admin_username, admin_password)

    status = {
        "database": db_info.get("name"),
        "users_count": int(users_info.get("total") or 0),
        "missing_tables": missing_tables,
        "expires_at_types": expires_map,
        "bad_expires_type_tables": bad_expires,
        "admin_auth_user_id": admin_auth_user_id,
        "admin_username": admin_username,
    }

    print(json.dumps(status, indent=2, default=str))
    ok = not missing_tables and not bad_expires and bool(admin_auth_user_id)
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))

