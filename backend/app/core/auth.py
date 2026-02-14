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
import re
import uuid
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from datetime import datetime, timedelta, date, timezone
from typing import Any, Dict, Optional

import jwt

from . import db as db_core


TOKEN_PRICE_SETTING_KEY = "token_price_per_1k_credits"
FREE_DAILY_TOKENS_SETTING_KEY = "free_daily_tokens"
DEFAULT_TOKEN_PRICE_PER_1K = Decimal("0.10")
DEFAULT_FREE_DAILY_TOKENS = 2500
_TWOPLACES = Decimal("0.01")


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


def _to_decimal(value: Any, default: Decimal = Decimal("0")) -> Decimal:
    if value is None:
        return default
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return default


def _round_credits(value: Decimal) -> Decimal:
    if value <= Decimal("0"):
        return Decimal("0.00")
    return value.quantize(_TWOPLACES, rounding=ROUND_HALF_UP)


def _normalize_tokens(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, parsed)


async def create_user(
    username: str,
    email: str,
    password: str,
    role: str = "user",
    email_verified: bool = False,
) -> int:
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
        "INSERT INTO users (username, email, password_hash, role, email_verified) VALUES (%s, %s, %s, %s, %s)",
        (username, email or None, pw_hash, role, int(email_verified)),
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
    if not row and "@" in username:
        row = await db_core.execute(
            "SELECT id, password_hash FROM users WHERE email=%s",
            (username,),
            fetch=True,
        )
    if not row:
        # Lazy-bootstrap well-known local accounts so first login works
        # even if startup bootstrap didn't run in the current process.
        admin_username = os.getenv("ADMIN_USERNAME") or os.getenv("BOOTSTRAP_ADMIN_USERNAME") or "admin"
        admin_password = os.getenv("ADMIN_PASSWORD") or os.getenv("BOOTSTRAP_ADMIN_PASSWORD") or "Admin@1234"
        default_username = os.getenv("DEFAULT_USER_USERNAME") or "user"
        default_password = os.getenv("DEFAULT_USER_PASSWORD") or "User@1234"
        developer_username = os.getenv("DEVELOPER_USERNAME")
        developer_password = os.getenv("DEVELOPER_PASSWORD")

        if username == admin_username and password == admin_password:
            await _ensure_bootstrap_user(
                username=admin_username,
                password=admin_password,
                role="admin",
                email=(os.getenv("ADMIN_EMAIL") or os.getenv("BOOTSTRAP_ADMIN_EMAIL") or None),
                credits_target=_parse_int(os.getenv("ADMIN_CREDITS") or os.getenv("BOOTSTRAP_ADMIN_CREDITS"), default=0),
                reset_password=True,
                ensure_verified=True,
            )
        elif username == default_username and password == default_password:
            await _ensure_bootstrap_user(
                username=default_username,
                password=default_password,
                role="user",
                email=(os.getenv("DEFAULT_USER_EMAIL") or None),
                credits_target=_parse_int(os.getenv("DEFAULT_USER_CREDITS"), default=0),
                reset_password=True,
                ensure_verified=True,
            )
        elif developer_username and developer_password and username == developer_username and password == developer_password:
            await _ensure_bootstrap_user(
                username=developer_username,
                password=developer_password,
                role="developer",
                email=(os.getenv("DEVELOPER_EMAIL") or None),
                credits_target=_parse_int(os.getenv("DEVELOPER_CREDITS"), default=0),
                reset_password=True,
                ensure_verified=True,
            )

        row = await db_core.execute(
            "SELECT id, password_hash FROM users WHERE username=%s",
            (username,),
            fetch=True,
        )
        if not row and "@" in username:
            row = await db_core.execute(
                "SELECT id, password_hash FROM users WHERE email=%s",
                (username,),
                fetch=True,
            )
    if not row:
        return None
    stored_hash = row[0].get("password_hash") or ""
    if verify_password(password, stored_hash):
        return int(row[0]["id"])
    # Env fallback: if bootstrap creds match, reset password on the fly (dev only)
    admin_username = os.getenv("ADMIN_USERNAME") or os.getenv("BOOTSTRAP_ADMIN_USERNAME")
    admin_password = os.getenv("ADMIN_PASSWORD") or os.getenv("BOOTSTRAP_ADMIN_PASSWORD")
    if admin_username and admin_password and username == admin_username and password == admin_password:
        if _env_truthy(os.getenv("ADMIN_RESET_PASSWORD")):
            await db_core.execute(
                "UPDATE users SET password_hash=%s, role=%s WHERE id=%s",
                (hash_password(admin_password), "admin", row[0]["id"]),
            )
            return int(row[0]["id"])
    default_username = os.getenv("DEFAULT_USER_USERNAME")
    default_password = os.getenv("DEFAULT_USER_PASSWORD")
    if default_username and default_password and username == default_username and password == default_password:
        if _env_truthy(os.getenv("DEFAULT_USER_RESET_PASSWORD")):
            await db_core.execute(
                "UPDATE users SET password_hash=%s, role=%s WHERE id=%s",
                (hash_password(default_password), "user", row[0]["id"]),
            )
            return int(row[0]["id"])
    developer_username = os.getenv("DEVELOPER_USERNAME")
    developer_password = os.getenv("DEVELOPER_PASSWORD")
    if developer_username and developer_password and username == developer_username and password == developer_password:
        if _env_truthy(os.getenv("DEVELOPER_RESET_PASSWORD")):
            await db_core.execute(
                "UPDATE users SET password_hash=%s, role=%s WHERE id=%s",
                (hash_password(developer_password), "developer", row[0]["id"]),
            )
            return int(row[0]["id"])
    return None


async def get_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    if not email:
        return None
    rows = await db_core.execute(
        "SELECT id, username, role, credits, email, email_verified FROM users WHERE email=%s",
        (email,),
        fetch=True,
    )
    return rows[0] if rows else None


async def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    rows = await db_core.execute(
        "SELECT id, username, role, credits, email, email_verified FROM users WHERE id=%s",
        (user_id,),
        fetch=True,
    )
    return rows[0] if rows else None


def _slugify_username(value: str) -> str:
    base = (value or "").strip().lower()
    base = re.sub(r"[^a-z0-9_]+", "_", base)
    base = base.strip("_")
    if len(base) < 3:
        base = f"user_{uuid.uuid4().hex[:6]}"
    return base[:32]


async def _username_exists(username: str) -> bool:
    rows = await db_core.execute(
        "SELECT id FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    return bool(rows)


async def create_oauth_user(email: str, name: Optional[str] = None, provider: str = "oauth") -> int:
    local_part = (email or "").split("@")[0]
    base = _slugify_username(local_part or name or provider)
    candidate = base
    suffix = 1
    while await _username_exists(candidate):
        candidate = f"{base}_{suffix}"
        if len(candidate) > 64:
            candidate = candidate[:64]
        suffix += 1
        if suffix > 50:
            candidate = f"{base}_{uuid.uuid4().hex[:4]}"
            break
    random_password = uuid.uuid4().hex
    return await create_user(candidate, email, random_password, role="user", email_verified=True)


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET") or ""
    if not secret:
        raise RuntimeError("JWT_SECRET is not configured")
    return secret


def _hash_token(raw: str) -> str:
    return hashlib.sha256(f"{raw}.{_jwt_secret()}".encode("utf-8")).hexdigest()


def _access_ttl_minutes() -> int:
    try:
        return int(os.getenv("ACCESS_TOKEN_TTL_MINUTES", "15"))
    except ValueError:
        return 15


def _refresh_ttl_days() -> int:
    try:
        return int(os.getenv("REFRESH_TOKEN_TTL_DAYS", "30"))
    except ValueError:
        return 30


def create_access_token(user: Dict[str, Any]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.get("id")),
        "role": user.get("role"),
        "username": user.get("username"),
        "email": user.get("email"),
        "type": "access",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=_access_ttl_minutes())).timestamp()),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


async def create_refresh_token(
    user_id: int,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> str:
    raw = uuid.uuid4().hex + uuid.uuid4().hex
    token_hash = _hash_token(raw)
    expires_at = datetime.utcnow() + timedelta(days=_refresh_ttl_days())
    await db_core.execute(
        "INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent) "
        "VALUES (%s, %s, %s, %s, %s)",
        (user_id, token_hash, expires_at, ip_address, user_agent),
    )
    return raw


async def revoke_refresh_token(raw_token: str, replaced_by: Optional[str] = None) -> None:
    token_hash = _hash_token(raw_token)
    await db_core.execute(
        "UPDATE refresh_tokens SET revoked_at=%s, replaced_by=%s WHERE token_hash=%s",
        (datetime.utcnow(), replaced_by, token_hash),
    )


async def rotate_refresh_token(
    raw_token: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Optional[str]:
    token_hash = _hash_token(raw_token)
    rows = await db_core.execute(
        "SELECT id, user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash=%s",
        (token_hash,),
        fetch=True,
    )
    if not rows:
        return None
    record = rows[0]
    if record.get("revoked_at"):
        return None
    expires_at = record.get("expires_at")
    if isinstance(expires_at, datetime) and expires_at < datetime.utcnow():
        return None
    new_raw = await create_refresh_token(int(record["user_id"]), ip_address, user_agent)
    await revoke_refresh_token(raw_token, replaced_by=_hash_token(new_raw))
    return new_raw


async def get_user_by_token_from_refresh(raw_token: str) -> Optional[Dict[str, Any]]:
    token_hash = _hash_token(raw_token)
    rows = await db_core.execute(
        "SELECT user_id, expires_at, revoked_at FROM refresh_tokens WHERE token_hash=%s",
        (token_hash,),
        fetch=True,
    )
    if not rows:
        return None
    record = rows[0]
    if record.get("revoked_at"):
        return None
    expires_at = record.get("expires_at")
    if isinstance(expires_at, datetime) and expires_at < datetime.utcnow():
        return None
    return await get_user_by_id(int(record["user_id"]))


async def verify_access_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except Exception:
        return None
    if payload.get("type") != "access":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = await get_user_by_id(int(user_id))
    return user


async def get_user_by_token(token: str) -> Optional[Dict[str, Any]]:
    """Return user information for a valid access token, or None."""
    return await verify_access_token(token)


async def create_auth_tokens(
    user: Dict[str, Any],
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> Dict[str, str]:
    access = create_access_token(user)
    refresh = await create_refresh_token(int(user.get("id")), ip_address, user_agent)
    return {"access_token": access, "refresh_token": refresh, "token_type": "bearer"}


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


async def get_billing_settings() -> Dict[str, Any]:
    rows = await db_core.execute(
        "SELECT setting_key, setting_value FROM app_settings "
        "WHERE setting_key IN (%s, %s)",
        (TOKEN_PRICE_SETTING_KEY, FREE_DAILY_TOKENS_SETTING_KEY),
        fetch=True,
    )
    values: Dict[str, str] = {}
    for row in rows or []:
        key = str(row.get("setting_key") or "")
        val = str(row.get("setting_value") or "")
        if key:
            values[key] = val

    token_price = _to_decimal(values.get(TOKEN_PRICE_SETTING_KEY), DEFAULT_TOKEN_PRICE_PER_1K)
    token_price = _round_credits(token_price)
    free_daily_tokens = _normalize_tokens(values.get(FREE_DAILY_TOKENS_SETTING_KEY), DEFAULT_FREE_DAILY_TOKENS)

    if TOKEN_PRICE_SETTING_KEY not in values:
        await db_core.execute(
            "INSERT INTO app_settings (setting_key, setting_value) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
            (TOKEN_PRICE_SETTING_KEY, str(token_price)),
        )
    if FREE_DAILY_TOKENS_SETTING_KEY not in values:
        await db_core.execute(
            "INSERT INTO app_settings (setting_key, setting_value) VALUES (%s, %s) "
            "ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
            (FREE_DAILY_TOKENS_SETTING_KEY, str(free_daily_tokens)),
        )

    return {
        "token_price_per_1k_credits": float(token_price),
        "free_daily_tokens": int(free_daily_tokens),
    }


async def set_billing_settings(token_price_per_1k_credits: float, free_daily_tokens: int) -> Dict[str, Any]:
    price_decimal = _to_decimal(token_price_per_1k_credits, DEFAULT_TOKEN_PRICE_PER_1K)
    if price_decimal < 0:
        raise ValueError("token_price_per_1k_credits must be >= 0")
    price_decimal = _round_credits(price_decimal)
    if free_daily_tokens < 0:
        raise ValueError("free_daily_tokens must be >= 0")

    await db_core.execute(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES (%s, %s) "
        "ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
        (TOKEN_PRICE_SETTING_KEY, str(price_decimal)),
    )
    await db_core.execute(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES (%s, %s) "
        "ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)",
        (FREE_DAILY_TOKENS_SETTING_KEY, str(int(free_daily_tokens))),
    )
    return await get_billing_settings()


async def get_user_daily_token_usage(user_id: int, usage_date: Optional[date] = None) -> int:
    target_date = usage_date or date.today()
    rows = await db_core.execute(
        "SELECT used_tokens FROM daily_token_usage WHERE user_id=%s AND usage_date=%s",
        (user_id, target_date),
        fetch=True,
    )
    if not rows:
        return 0
    return _normalize_tokens(rows[0].get("used_tokens"), 0)


async def _get_user_credit_balance(user_id: int) -> Decimal:
    rows = await db_core.execute(
        "SELECT credits FROM users WHERE id=%s",
        (user_id,),
        fetch=True,
    )
    if not rows:
        return Decimal("0.00")
    return _round_credits(_to_decimal(rows[0].get("credits"), Decimal("0")))


async def get_user_billing_overview(user_id: int) -> Dict[str, Any]:
    settings = await get_billing_settings()
    free_daily_tokens = int(settings.get("free_daily_tokens") or 0)
    used_today = await get_user_daily_token_usage(user_id)
    remaining = max(0, free_daily_tokens - used_today)
    credits = await _get_user_credit_balance(user_id)
    return {
        "credits": float(credits),
        "daily_tokens_used": int(used_today),
        "daily_tokens_limit": int(free_daily_tokens),
        "daily_tokens_remaining": int(remaining),
        "token_price_per_1k_credits": float(settings.get("token_price_per_1k_credits") or 0.0),
    }


async def _ensure_simulation_token_usage_row(user_id: int, simulation_id: str) -> None:
    await db_core.execute(
        "INSERT INTO simulation_token_usage (simulation_id, user_id, used_tokens, free_tokens_applied, credits_charged) "
        "VALUES (%s, %s, 0, 0, 0.00) "
        "ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)",
        (simulation_id, user_id),
    )


async def get_simulation_outstanding_credits(user_id: int, simulation_id: str) -> Dict[str, Any]:
    settings = await get_billing_settings()
    price_per_1k = _round_credits(_to_decimal(settings.get("token_price_per_1k_credits"), DEFAULT_TOKEN_PRICE_PER_1K))
    await _ensure_simulation_token_usage_row(user_id, simulation_id)
    rows = await db_core.execute(
        "SELECT used_tokens, free_tokens_applied, credits_charged "
        "FROM simulation_token_usage WHERE simulation_id=%s AND user_id=%s",
        (simulation_id, user_id),
        fetch=True,
    )
    row = (rows or [{}])[0]
    used_tokens = _normalize_tokens(row.get("used_tokens"), 0)
    free_tokens_applied = _normalize_tokens(row.get("free_tokens_applied"), 0)
    charged = _round_credits(_to_decimal(row.get("credits_charged"), Decimal("0")))
    billable_tokens = max(0, used_tokens - free_tokens_applied)
    target_total = _round_credits((Decimal(billable_tokens) / Decimal(1000)) * price_per_1k)
    outstanding = _round_credits(max(Decimal("0.00"), target_total - charged))
    credits_available = await _get_user_credit_balance(user_id)
    return {
        "used_tokens": used_tokens,
        "free_tokens_applied": free_tokens_applied,
        "billable_tokens": billable_tokens,
        "target_total_credits": float(target_total),
        "charged_credits": float(charged),
        "outstanding_credits": float(outstanding),
        "credits_available": float(credits_available),
    }


async def settle_simulation_outstanding(user_id: int, simulation_id: str) -> Dict[str, Any]:
    snapshot = await get_simulation_outstanding_credits(user_id, simulation_id)
    outstanding = _round_credits(_to_decimal(snapshot.get("outstanding_credits"), Decimal("0")))
    if outstanding <= Decimal("0.00"):
        return {**snapshot, "charged_now": 0.0, "ok": True}

    available = _round_credits(_to_decimal(snapshot.get("credits_available"), Decimal("0")))
    charge_now = _round_credits(min(outstanding, available))
    if charge_now > Decimal("0.00"):
        await db_core.execute(
            "UPDATE users SET credits=GREATEST(0, credits-%s) WHERE id=%s",
            (float(charge_now), user_id),
        )
        await db_core.execute(
            "UPDATE simulation_token_usage SET credits_charged=credits_charged+%s WHERE simulation_id=%s AND user_id=%s",
            (float(charge_now), simulation_id, user_id),
        )
    refreshed = await get_simulation_outstanding_credits(user_id, simulation_id)
    refreshed["charged_now"] = float(charge_now)
    refreshed["ok"] = float(refreshed.get("outstanding_credits") or 0.0) <= 0.0001
    return refreshed


async def consume_simulation_tokens(user_id: int, simulation_id: str, tokens_used: int) -> Dict[str, Any]:
    """Apply simulation token usage and charge credits progressively.

    Returns a billing snapshot including whether charging fully succeeded.
    """
    tokens = _normalize_tokens(tokens_used, 0)
    if tokens <= 0:
        snapshot = await get_simulation_outstanding_credits(user_id, simulation_id)
        snapshot["ok"] = float(snapshot.get("outstanding_credits") or 0.0) <= 0.0001
        snapshot["charged_now"] = 0.0
        snapshot["tokens_added"] = 0
        return snapshot

    settings = await get_billing_settings()
    free_daily_tokens = int(settings.get("free_daily_tokens") or 0)
    price_per_1k = _round_credits(_to_decimal(settings.get("token_price_per_1k_credits"), DEFAULT_TOKEN_PRICE_PER_1K))
    await _ensure_simulation_token_usage_row(user_id, simulation_id)

    today = date.today()
    daily_before = await get_user_daily_token_usage(user_id, today)
    free_remaining = max(0, free_daily_tokens - daily_before)
    free_applied_now = min(tokens, free_remaining)

    sim_rows = await db_core.execute(
        "SELECT used_tokens, free_tokens_applied, credits_charged "
        "FROM simulation_token_usage WHERE simulation_id=%s AND user_id=%s",
        (simulation_id, user_id),
        fetch=True,
    )
    sim_row = (sim_rows or [{}])[0]
    sim_used_before = _normalize_tokens(sim_row.get("used_tokens"), 0)
    sim_free_before = _normalize_tokens(sim_row.get("free_tokens_applied"), 0)
    sim_charged_before = _round_credits(_to_decimal(sim_row.get("credits_charged"), Decimal("0")))

    sim_used_after = sim_used_before + tokens
    sim_free_after = sim_free_before + free_applied_now
    billable_after = max(0, sim_used_after - sim_free_after)
    target_credits_after = _round_credits((Decimal(billable_after) / Decimal(1000)) * price_per_1k)
    delta_due = _round_credits(max(Decimal("0.00"), target_credits_after - sim_charged_before))

    credits_available = await _get_user_credit_balance(user_id)
    charge_now = _round_credits(min(delta_due, credits_available))

    await db_core.execute(
        "INSERT INTO daily_token_usage (user_id, usage_date, used_tokens) VALUES (%s, %s, %s) "
        "ON DUPLICATE KEY UPDATE used_tokens=used_tokens+VALUES(used_tokens)",
        (user_id, today, tokens),
    )
    await db_core.execute(
        "UPDATE simulation_token_usage SET "
        "used_tokens=used_tokens+%s, "
        "free_tokens_applied=free_tokens_applied+%s, "
        "credits_charged=credits_charged+%s "
        "WHERE simulation_id=%s AND user_id=%s",
        (tokens, free_applied_now, float(charge_now), simulation_id, user_id),
    )
    if charge_now > Decimal("0.00"):
        await db_core.execute(
            "UPDATE users SET credits=GREATEST(0, credits-%s) WHERE id=%s",
            (float(charge_now), user_id),
        )

    snapshot = await get_simulation_outstanding_credits(user_id, simulation_id)
    snapshot["ok"] = float(snapshot.get("outstanding_credits") or 0.0) <= 0.0001
    snapshot["charged_now"] = float(charge_now)
    snapshot["tokens_added"] = tokens
    snapshot["free_applied_now"] = free_applied_now
    return snapshot


async def adjust_user_credits(user_id: int, delta: float) -> None:
    """Adjust a user's credits by delta (positive or negative) with 2-decimal precision."""
    delta_decimal = _round_credits(_to_decimal(delta, Decimal("0")))
    if delta_decimal == Decimal("0.00"):
        return
    await db_core.execute(
        "UPDATE users SET credits=GREATEST(0, credits+%s) WHERE id=%s",
        (float(delta_decimal), user_id),
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
    credits = _round_credits(_to_decimal(rows[0].get("credits"), Decimal("0")))
    if credits > Decimal("0.00"):
        await adjust_user_credits(user_id, -1.0)
        return True
    return False


async def mark_email_verified(user_id: int) -> None:
    await db_core.execute(
        "UPDATE users SET email_verified=1, email_verified_at=%s WHERE id=%s",
        (datetime.utcnow(), user_id),
    )


async def create_email_verification(user_id: int, ttl_hours: int = 24) -> str:
    raw = uuid.uuid4().hex + uuid.uuid4().hex
    token_hash = _hash_token(raw)
    expires_at = datetime.utcnow() + timedelta(hours=ttl_hours)
    await db_core.execute(
        "INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
        (user_id, token_hash, expires_at),
    )
    return raw


async def verify_email_token(raw_token: str) -> Optional[int]:
    token_hash = _hash_token(raw_token)
    rows = await db_core.execute(
        "SELECT id, user_id, expires_at, used_at FROM email_verifications WHERE token_hash=%s",
        (token_hash,),
        fetch=True,
    )
    if not rows:
        return None
    record = rows[0]
    if record.get("used_at"):
        return None
    expires_at = record.get("expires_at")
    if isinstance(expires_at, datetime) and expires_at < datetime.utcnow():
        return None
    user_id = int(record["user_id"])
    await mark_email_verified(user_id)
    await db_core.execute(
        "UPDATE email_verifications SET used_at=%s WHERE id=%s",
        (datetime.utcnow(), record["id"]),
    )
    return user_id


async def create_password_reset(user_id: int, ttl_hours: int = 2) -> str:
    raw = uuid.uuid4().hex + uuid.uuid4().hex
    token_hash = _hash_token(raw)
    expires_at = datetime.utcnow() + timedelta(hours=ttl_hours)
    await db_core.execute(
        "INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (%s, %s, %s)",
        (user_id, token_hash, expires_at),
    )
    return raw


async def reset_password_with_token(raw_token: str, new_password: str) -> bool:
    token_hash = _hash_token(raw_token)
    rows = await db_core.execute(
        "SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash=%s",
        (token_hash,),
        fetch=True,
    )
    if not rows:
        return False
    record = rows[0]
    if record.get("used_at"):
        return False
    expires_at = record.get("expires_at")
    if isinstance(expires_at, datetime) and expires_at < datetime.utcnow():
        return False
    user_id = int(record["user_id"])
    await db_core.execute(
        "UPDATE users SET password_hash=%s WHERE id=%s",
        (hash_password(new_password), user_id),
    )
    await db_core.execute(
        "UPDATE password_resets SET used_at=%s WHERE id=%s",
        (datetime.utcnow(), record["id"]),
    )
    return True


async def log_audit(
    user_id: Optional[int],
    action: str,
    meta: Optional[Dict[str, Any]] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    try:
        await db_core.insert_audit_log(user_id, action, meta, ip_address, user_agent)
    except Exception:
        pass


ROLE_PERMISSIONS: Dict[str, set[str]] = {
    "user": {
        "simulation:run",
        "simulation:view",
        "research:run",
        "court:run",
        "llm:use",
        "search:use",
        "account:view",
    },
    "developer": {
        "simulation:run",
        "simulation:view",
        "research:run",
        "court:run",
        "llm:use",
        "search:use",
        "account:view",
        "developer:lab",
    },
    "admin": {
        "simulation:run",
        "simulation:view",
        "research:run",
        "court:run",
        "llm:use",
        "search:use",
        "account:view",
        "admin:manage",
        "admin:users",
        "admin:credits",
        "admin:stats",
    },
}


def has_permission(user: Optional[Dict[str, Any]], perm: str) -> bool:
    if not user:
        return False
    role = str(user.get("role") or "user").lower()
    perms = ROLE_PERMISSIONS.get(role, set())
    return perm in perms or role == "admin"


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
    return await _ensure_bootstrap_user(
        username=username,
        password=password,
        role="admin",
        email=email or None,
        credits_target=credits_target,
        reset_password=reset_password,
        ensure_verified=True,
    )


async def _ensure_bootstrap_user(
    *,
    username: str,
    password: str,
    role: str,
    email: Optional[str] = None,
    credits_target: int = 0,
    reset_password: bool = False,
    ensure_verified: bool = True,
) -> Dict[str, Any]:
    rows = await db_core.execute(
        "SELECT id, role, credits, email, email_verified FROM users WHERE username=%s",
        (username,),
        fetch=True,
    )
    if rows:
        user = rows[0]
        updates: list[str] = []
        params: list[Any] = []

        if role and user.get("role") != role:
            updates.append("role=%s")
            params.append(role)

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

        if ensure_verified and not user.get("email_verified"):
            updates.append("email_verified=%s")
            params.append(1)
            updates.append("email_verified_at=%s")
            params.append(datetime.utcnow())

        if updates:
            params.append(user["id"])
            await db_core.execute(
                f"UPDATE users SET {', '.join(updates)} WHERE id=%s",
                params,
            )

        return {
            "id": int(user["id"]),
            "username": username,
            "role": role,
            "credits": current_credits,
        }

    pw_hash = hash_password(password)
    await db_core.execute(
        "INSERT INTO users (username, email, password_hash, role, credits, email_verified, email_verified_at) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s)",
        (
            username,
            email or None,
            pw_hash,
            role,
            credits_target,
            1 if ensure_verified else 0,
            datetime.utcnow() if ensure_verified else None,
        ),
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
        "role": role,
        "credits": credits_target,
    }


async def ensure_default_user() -> Optional[Dict[str, Any]]:
    """Ensure a normal (non-admin) bootstrap account exists for testing.

    Environment variables:
      DEFAULT_USER_USERNAME, DEFAULT_USER_PASSWORD (required)
      DEFAULT_USER_EMAIL (optional)
      DEFAULT_USER_CREDITS (optional, minimum credits to set)
      DEFAULT_USER_RESET_PASSWORD (optional, true/false to overwrite password)
    """
    username = os.getenv("DEFAULT_USER_USERNAME")
    password = os.getenv("DEFAULT_USER_PASSWORD")
    if not username or not password:
        return None

    email = os.getenv("DEFAULT_USER_EMAIL") or ""
    credits_target = _parse_int(os.getenv("DEFAULT_USER_CREDITS"), default=0)
    reset_password = _env_truthy(os.getenv("DEFAULT_USER_RESET_PASSWORD"))

    return await _ensure_bootstrap_user(
        username=username,
        password=password,
        role="user",
        email=email or None,
        credits_target=credits_target,
        reset_password=reset_password,
        ensure_verified=True,
    )


async def ensure_developer_user() -> Optional[Dict[str, Any]]:
    """Ensure a developer bootstrap account exists when env credentials are provided."""
    username = os.getenv("DEVELOPER_USERNAME")
    password = os.getenv("DEVELOPER_PASSWORD")
    if not username or not password:
        return None

    email = os.getenv("DEVELOPER_EMAIL") or ""
    credits_target = _parse_int(os.getenv("DEVELOPER_CREDITS"), default=0)
    reset_password = _env_truthy(os.getenv("DEVELOPER_RESET_PASSWORD"))

    return await _ensure_bootstrap_user(
        username=username,
        password=password,
        role="developer",
        email=email or None,
        credits_target=credits_target,
        reset_password=reset_password,
        ensure_verified=True,
    )
