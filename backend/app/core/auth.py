"""
Authentication and user management helpers.

This module provides simple, stateless authentication using randomly
generated tokens stored in a MySQL database. Passwords are hashed
with PBKDF2 using SHA‑256 and a per‑user salt. Tokens are stored
in the sessions table with an optional expiration time. Daily usage
tracking and promo code redemption logic are also defined here.

NOTE: This implementation deliberately avoids external dependencies
such as PyJWT or passlib to remain compatible with the environment.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import uuid
from datetime import datetime, timedelta, date
from typing import Any, Dict, Optional

from . import db as db_core


def _pbkdf2_hash(password: str, salt: bytes) -> bytes:
    """Compute a PBKDF2‑HMAC‑SHA256 hash for the given password and salt."""
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)


def hash_password(password: str) -> str:
    """Create a salted password hash.

    The returned string contains the salt and hash separated by a colon.
    """
    salt = os.urandom(16)
    pw_hash = _pbkdf2_hash(password, salt)
    return f"{salt.hex()}:{pw_hash.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Verify a password against a stored salt:hash string."""
    try:
        salt_hex, hash_hex = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        stored_hash = bytes.fromhex(hash_hex)
        computed = _pbkdf2_hash(password, salt)
        return hmac.compare_digest(computed, stored_hash)
    except Exception:
        return False


async def create_user(username: str, email: str, password: str, role: str = "user") -> int:
    """Create a new user and return the user ID.

    Raises RuntimeError if the username already exists.
    """
    # Check if username exists
    existing = await db_core.execute(
        "SELECT id FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    if existing:
        raise RuntimeError("Username already taken")
    pw_hash = hash_password(password)
    await db_core.execute(
        "INSERT INTO users (username, email, password_hash, role) VALUES (%s, %s, %s, %s)",
        (username, email or None, pw_hash, role),
    )
    row = await db_core.execute(
        "SELECT id FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    return int(row[0]["id"]) if row else 0


async def authenticate_user(username: str, password: str) -> Optional[int]:
    """Authenticate a user and return their ID if valid, else None."""
    row = await db_core.execute(
        "SELECT id, password_hash FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    if not row:
        return None
    stored_hash = row[0].get("password_hash") or ""
    if verify_password(password, stored_hash):
        return int(row[0]["id"])
    return None


def _create_token() -> str:
    """Generate a random token for session authentication."""
    return uuid.uuid4().hex


async def create_session(user_id: int, ttl_hours: int = 24) -> str:
    """Create a session for the given user and return the token."""
    token = _create_token()
    expires_at = datetime.utcnow() + timedelta(hours=ttl_hours)
    await db_core.execute(
        "INSERT INTO sessions (user_id, token, expires_at) VALUES (%s, %s, %s)",
        (user_id, token, expires_at),
    )
    return token


async def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    """Return user information for a valid session token, or None."""
    if not token:
        return None
    rows = await db_core.execute(
        "SELECT u.id, u.username, u.role, u.credits, s.expires_at FROM sessions s JOIN users u ON s.user_id=u.id "
        "WHERE s.token=%s",
        (token,),
        fetch=True,
    )
    if not rows:
        return None
    user = rows[0]
    expires_at = user.get("expires_at")
    if expires_at and isinstance(expires_at, datetime) and expires_at < datetime.utcnow():
        # Session expired, optionally remove it
        await db_core.execute("DELETE FROM sessions WHERE token=%s", (token,))
        return None
    return user


async def get_user_daily_usage(user_id: int) -> int:
    """Return how many simulations the user has started today."""
    today = date.today()
    rows = await db_core.execute(
        "SELECT used_count FROM daily_usage WHERE user_id=%s AND usage_date=%s",
        (user_id, today),
        fetch=True,
    )
    if not rows:
        return 0
    return int(rows[0]["used_count"])


async def increment_daily_usage(user_id: int) -> None:
    """Increment today's usage count for a user."""
    today = date.today()
    await db_core.execute(
        "INSERT INTO daily_usage (user_id, usage_date, used_count) VALUES (%s, %s, 1) "
        "ON DUPLICATE KEY UPDATE used_count=used_count+1",
        (user_id, today),
    )


async def adjust_user_credits(user_id: int, delta: int) -> None:
    """Adjust a user's credits by delta (positive or negative)."""
    await db_core.execute(
        "UPDATE users SET credits=GREATEST(0, credits+%s) WHERE id=%s",
        (delta, user_id),
    )


async def set_user_role(user_id: int, role: str) -> None:
    """Set a user's role explicitly."""
    await db_core.execute(
        "UPDATE users SET role=%s WHERE id=%s",
        (role, user_id),
    )


async def redeem_promo_code(user_id: int, code: str) -> int:
    """Redeem a promo code for a user. Returns bonus attempts on success, 0 on failure."""
    # Find promo code
    rows = await db_core.execute(
        "SELECT id, bonus_attempts, max_uses, uses, expires_at FROM promo_codes WHERE code=%s",
        (code,),
        fetch=True,
    )
    if not rows:
        return 0
    promo = rows[0]
    expires_at = promo.get("expires_at")
    if expires_at:
        if isinstance(expires_at, datetime):
            if expires_at < datetime.utcnow():
                return 0
        elif isinstance(expires_at, date):
            if expires_at < date.today():
                return 0
    max_uses = promo.get("max_uses")
    if max_uses is not None and promo.get("uses", 0) >= int(max_uses):
        return 0
    promo_id = int(promo["id"])
    # Check if user already redeemed
    check = await db_core.execute(
        "SELECT id FROM promo_redemptions WHERE user_id=%s AND promo_code_id=%s",
        (user_id, promo_id),
        fetch=True,
    )
    if check:
        return 0
    # Redeem
    await db_core.execute(
        "INSERT INTO promo_redemptions (user_id, promo_code_id) VALUES (%s, %s)",
        (user_id, promo_id),
    )
    await db_core.execute(
        "UPDATE promo_codes SET uses=uses+1 WHERE id=%s",
        (promo_id,),
    )
    bonus = int(promo.get("bonus_attempts") or 0)
    if bonus > 0:
        await adjust_user_credits(user_id, bonus)
    return bonus


async def consume_simulation_credit(user_id: int) -> bool:
    """Consume a simulation credit if available. Returns True if credit used."""
    # Decrement credits if positive
    rows = await db_core.execute(
        "SELECT credits FROM users WHERE id=%s",
        (user_id,),
        fetch=True,
    )
    if not rows:
        return False
    credits = int(rows[0]["credits"] or 0)
    if credits > 0:
        await adjust_user_credits(user_id, -1)
        return True
    return False


def _env_truthy(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _parse_int(value: Optional[str], default: int = 0) -> int:
    try:
        return int(value) if value is not None else default
    except (TypeError, ValueError):
        return default


async def ensure_admin_user() -> Optional[Dict[str, Any]]:
    """Ensure an admin account exists using env bootstrap values.

    Environment variables:
      ADMIN_USERNAME, ADMIN_PASSWORD (required to create)
      ADMIN_EMAIL (optional)
      ADMIN_CREDITS (optional, minimum credits to set)
      ADMIN_RESET_PASSWORD (optional, true/false to overwrite password)
    """
    username = os.getenv("ADMIN_USERNAME") or os.getenv("BOOTSTRAP_ADMIN_USERNAME")
    password = os.getenv("ADMIN_PASSWORD") or os.getenv("BOOTSTRAP_ADMIN_PASSWORD")
    if not username or not password:
        return None
    email = os.getenv("ADMIN_EMAIL") or os.getenv("BOOTSTRAP_ADMIN_EMAIL") or ""
    credits_target = _parse_int(
        os.getenv("ADMIN_CREDITS") or os.getenv("BOOTSTRAP_ADMIN_CREDITS"),
        default=0,
    )
    reset_password = _env_truthy(os.getenv("ADMIN_RESET_PASSWORD"))

    rows = await db_core.execute(
        "SELECT id, role, credits, email FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    if rows:
        user = rows[0]
        updates: list[str] = []
        params: list[Any] = []
        if user.get("role") != "admin":
            updates.append("role=%s")
            params.append("admin")
        if email and not user.get("email"):
            updates.append("email=%s")
            params.append(email)
        current_credits = int(user.get("credits") or 0)
        if credits_target > current_credits:
            updates.append("credits=%s")
            params.append(credits_target)
            current_credits = credits_target
        if reset_password:
            updates.append("password_hash=%s")
            params.append(hash_password(password))
        if updates:
            params.append(user["id"])
            await db_core.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id=%s",
                params,
            )
        return {
            "id": int(user["id"]),
            "username": username,
            "role": "admin",
            "credits": current_credits,
        }

    pw_hash = hash_password(password)
    await db_core.execute(
        "INSERT INTO users (username, email, password_hash, role, credits) VALUES (%s, %s, %s, %s, %s)",
        (username, email or None, pw_hash, "admin", credits_target),
    )
    created = await db_core.execute(
        "SELECT id FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    user_id = int(created[0]["id"]) if created else 0
    return {
        "id": user_id,
        "username": username,
        "role": "admin",
        "credits": credits_target,
    }
