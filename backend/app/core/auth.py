"""
Authentication and authorisation utilities.

This module provides helpers for hashing passwords, issuing and verifying JWT
tokens, enforcing daily usage limits and redeeming promo codes. It uses
bcrypt for secure password hashing and PyJWT for token generation. Tokens
include the user ID and role and can optionally expire. Daily usage and
credits are tracked in the database via the helpers in ``db``.

Environment variables:

``JWT_SECRET``: Secret key used to sign and verify JWTs. Must be set.
``JWT_EXPIRES_HOURS``: Lifetime of tokens in hours (default 24).
``DAILY_LIMIT``: Number of simulations allowed per day (default 5).
"""

from __future__ import annotations

import asyncio
import datetime
import os
from typing import Any, Dict, Optional

import bcrypt
import jwt

from . import db


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------

def hash_password(password: str) -> str:
    """Hash a password using bcrypt and return the encoded hash."""
    salt = bcrypt.gensalt()
    pw_hash = bcrypt.hashpw(password.encode("utf-8"), salt)
    return pw_hash.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


# ---------------------------------------------------------------------------
# JWT utilities
# ---------------------------------------------------------------------------

_JWT_SECRET = os.getenv("JWT_SECRET", "changeme")
_JWT_EXPIRES_HOURS = int(os.getenv("JWT_EXPIRES_HOURS", "24"))


def create_access_token(user_id: int, role: str) -> str:
    """Create a signed JWT containing user_id, role and expiry."""
    now = datetime.datetime.utcnow()
    payload = {
        "sub": user_id,
        "role": role,
        "iat": now,
        "exp": now + datetime.timedelta(hours=_JWT_EXPIRES_HOURS),
    }
    token = jwt.encode(payload, _JWT_SECRET, algorithm="HS256")
    # PyJWT >=2 returns a string; older versions return bytes
    return token if isinstance(token, str) else token.decode("utf-8")


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decode and verify a JWT. Returns payload on success, None on failure."""
    try:
        return jwt.decode(token, _JWT_SECRET, algorithms=["HS256"])
    except Exception:
        return None


# ---------------------------------------------------------------------------
# User management
# ---------------------------------------------------------------------------

async def create_user(username: str, email: str, password: str, role: str = "user") -> int:
    """Register a new user and return the new ID.

    Raises RuntimeError if the username already exists.
    """
    existing = await db.find_user_by_username(username)
    if existing:
        raise RuntimeError("Username already taken")
    password_hash = hash_password(password)
    return await db.insert_user(username=username, email=email, password_hash=password_hash, role=role, credits=0)


async def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticate a user by username and password.

    Returns a dict with keys id and role on success, or None on failure.
    """
    user = await db.find_user_by_username(username)
    if not user:
        return None
    stored = user.get("password_hash") or ""
    if verify_password(password, stored):
        return {"id": int(user["id"]), "role": user.get("role", "user")}
    return None


# ---------------------------------------------------------------------------
# Daily usage and credits
# ---------------------------------------------------------------------------

_DAILY_LIMIT = int(os.getenv("DAILY_LIMIT", "5"))


async def check_daily_limit(user_id: int) -> bool:
    """Return True if the user has reached their daily simulation limit."""
    today = datetime.date.today().isoformat()
    used = await db.get_daily_usage(user_id, today)
    return used >= _DAILY_LIMIT


async def increment_daily_usage(user_id: int) -> None:
    """Increment the daily usage counter for the user."""
    today = datetime.date.today().isoformat()
    await db.increment_daily_usage(user_id, today)


async def adjust_user_credits(user_id: int, delta: int) -> None:
    """Adjust user credits (can be negative)."""
    await db.adjust_user_credits(user_id, delta)


async def get_user_credits(user_id: int) -> int:
    return await db.get_user_credits(user_id)


async def consume_simulation_credit(user_id: int) -> bool:
    """Consume one credit if available. Returns True if a credit was used."""
    credits = await get_user_credits(user_id)
    if credits > 0:
        await adjust_user_credits(user_id, -1)
        return True
    return False


async def get_user_daily_usage(user_id: int) -> int:
    """Return how many simulations the user has started today."""
    today = datetime.date.today().isoformat()
    return await db.get_daily_usage(user_id, today)


# ---------------------------------------------------------------------------
# Promo code redemption
# ---------------------------------------------------------------------------

async def redeem_promo_code(user_id: int, code: str) -> int:
    """Redeem a promo code and return bonus attempts added, or 0 on failure."""
    promo = await db.find_promo_code(code)
    if not promo:
        return 0
    # Check expiry
    expires_at = promo.get("expires_at")
    if expires_at and expires_at < datetime.date.today():
        return 0
    max_uses = promo.get("max_uses", 1)
    uses = promo.get("uses", 0)
    if uses >= max_uses:
        return 0
    promo_id = int(promo["id"])
    # Check if user already redeemed
    existing = await db.find_user_promo_redemption(user_id, promo_id)
    if existing:
        return 0
    await db.insert_promo_redemption(user_id, promo_id)
    await db.increment_promo_uses(promo_id)
    bonus = int(promo.get("bonus_attempts") or 0)
    if bonus > 0:
        await adjust_user_credits(user_id, bonus)
    return bonus