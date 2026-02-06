"""
Authentication and user management API routes.

This module exposes endpoints for user registration, login, fetching
the current user, and redeeming promo codes. Authentication is
implemented via opaque session tokens stored in the database.
Clients must include an ``Authorization: Bearer <token>`` header on
protected endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, status, Request
import os
from pydantic import BaseModel, Field, EmailStr
from typing import Optional

from ..core import auth as auth_core
from ..core import emailer as emailer_core
from ..core import db as db_core
from .health import health_db as health_db_endpoint


router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=64)
    email: Optional[EmailStr] = None
    password: str = Field(..., min_length=6, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class RedeemRequest(BaseModel):
    code: str = Field(..., min_length=2, max_length=64)


class PromoteRequest(BaseModel):
    secret: str = Field(..., min_length=1)


class GoogleLoginRequest(BaseModel):
    id_token: Optional[str] = None
    email: Optional[EmailStr] = None
    name: Optional[str] = None


class RefreshRequest(BaseModel):
    refresh_token: str = Field(..., min_length=16)


class VerifyEmailRequest(BaseModel):
    token: str = Field(..., min_length=16)


class ResendVerificationRequest(BaseModel):
    email: EmailStr


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirmRequest(BaseModel):
    token: str = Field(..., min_length=16)
    password: str = Field(..., min_length=6, max_length=128)


def _email_verify_required() -> bool:
    return os.getenv("EMAIL_VERIFY_REQUIRED", "true").lower() in {"1", "true", "yes"}


def _app_base_url() -> str:
    return (os.getenv("APP_BASE_URL") or os.getenv("FRONTEND_URL") or "").rstrip("/")


def _client_ip(request: Request) -> Optional[str]:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return None


async def get_current_user(authorization: str = Header(None)) -> dict:
    """Resolve the current user from the Authorization header.

    Raises HTTPException if the token is missing or invalid.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    return user


@router.get("/health/db")
async def health_db_fallback():
    """Fallback route in case the dedicated health router isn't mounted."""
    return await health_db_endpoint()


@router.post("/register")
async def register(payload: RegisterRequest, request: Request) -> dict:
    try:
        require_verify = _email_verify_required()
        if require_verify and not payload.email:
            raise HTTPException(status_code=400, detail="Email is required")
        user_id = await auth_core.create_user(
            payload.username,
            payload.email or "",
            payload.password,
            email_verified=not require_verify,
        )
        user = await auth_core.get_user_by_id(user_id)
        if require_verify:
            token = await auth_core.create_email_verification(user_id)
            link = f"{_app_base_url()}/verify-email?token={token}" if _app_base_url() else token
            await emailer_core.send_verification_email(payload.email or "", link)
            await auth_core.log_audit(user_id, "auth.register", {"verify": True}, _client_ip(request), request.headers.get("user-agent"))
            return {"message": "verification_sent"}
        tokens = await auth_core.create_auth_tokens(user, _client_ip(request), request.headers.get("user-agent"))
        await auth_core.log_audit(user_id, "auth.register", {"verify": False}, _client_ip(request), request.headers.get("user-agent"))
        return tokens
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/login")
async def login(payload: LoginRequest, request: Request) -> dict:
    user_id = await auth_core.authenticate_user(payload.username, payload.password)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    user = await auth_core.get_user_by_id(user_id)
    if _email_verify_required() and not user.get("email_verified"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email not verified")
    tokens = await auth_core.create_auth_tokens(user, _client_ip(request), request.headers.get("user-agent"))
    await auth_core.log_audit(user_id, "auth.login", None, _client_ip(request), request.headers.get("user-agent"))
    return tokens


@router.post("/refresh")
async def refresh(payload: RefreshRequest, request: Request) -> dict:
    user = await auth_core.get_user_by_token_from_refresh(payload.refresh_token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    new_refresh = await auth_core.rotate_refresh_token(
        payload.refresh_token,
        _client_ip(request),
        request.headers.get("user-agent"),
    )
    if not new_refresh:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    access = auth_core.create_access_token(user)
    await auth_core.log_audit(user.get("id"), "auth.refresh", None, _client_ip(request), request.headers.get("user-agent"))
    return {"access_token": access, "refresh_token": new_refresh, "token_type": "bearer"}


@router.post("/logout")
async def logout(payload: RefreshRequest, request: Request) -> dict:
    user = await auth_core.get_user_by_token_from_refresh(payload.refresh_token)
    await auth_core.revoke_refresh_token(payload.refresh_token)
    await auth_core.log_audit(user.get("id") if user else None, "auth.logout", None, _client_ip(request), request.headers.get("user-agent"))
    return {"message": "logged_out"}


@router.post("/verify-email")
async def verify_email(payload: VerifyEmailRequest, request: Request) -> dict:
    user_id = await auth_core.verify_email_token(payload.token)
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid or expired verification token")
    await auth_core.log_audit(user_id, "auth.verify_email", None, _client_ip(request), request.headers.get("user-agent"))
    return {"message": "email_verified"}


@router.post("/resend-verification")
async def resend_verification(payload: ResendVerificationRequest) -> dict:
    user = await auth_core.get_user_by_email(payload.email)
    if user and not user.get("email_verified"):
        token = await auth_core.create_email_verification(int(user["id"]))
        link = f"{_app_base_url()}/verify-email?token={token}" if _app_base_url() else token
        await emailer_core.send_verification_email(payload.email, link)
    return {"message": "verification_sent"}


@router.post("/request-password-reset")
async def request_password_reset(payload: PasswordResetRequest) -> dict:
    user = await auth_core.get_user_by_email(payload.email)
    if user:
        token = await auth_core.create_password_reset(int(user["id"]))
        link = f"{_app_base_url()}/reset-password?token={token}" if _app_base_url() else token
        await emailer_core.send_password_reset_email(payload.email, link)
    return {"message": "reset_sent"}


@router.post("/reset-password")
async def reset_password(payload: PasswordResetConfirmRequest) -> dict:
    ok = await auth_core.reset_password_with_token(payload.token, payload.password)
    if not ok:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")
    return {"message": "password_reset"}


@router.post("/google")
async def login_google(payload: GoogleLoginRequest, request: Request) -> dict:
    client_id = os.getenv("GOOGLE_CLIENT_ID") or ""
    allow_dev = os.getenv("ALLOW_DEV_GOOGLE", "true").lower() in {"1", "true", "yes"}
    email: Optional[str] = None
    name: Optional[str] = None

    if payload.id_token and client_id:
        try:
            from google.oauth2 import id_token as google_id_token
            from google.auth.transport import requests as google_requests
            info = google_id_token.verify_oauth2_token(
                payload.id_token,
                google_requests.Request(),
                client_id,
            )
            email = info.get("email")
            name = info.get("name")
            if info.get("email_verified") is False:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unverified Google email")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google token")
    elif allow_dev and payload.email:
        email = payload.email
        name = payload.name
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google login not configured",
        )

    if not email:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google email missing")

    user = await auth_core.get_user_by_email(email)
    if user:
        user_id = int(user.get("id"))
    else:
        user_id = await auth_core.create_oauth_user(email=email, name=name, provider="google")

    user_record = await auth_core.get_user_by_id(user_id)
    tokens = await auth_core.create_auth_tokens(user_record, _client_ip(request), request.headers.get("user-agent"))
    await auth_core.log_audit(user_id, "auth.google", None, _client_ip(request), request.headers.get("user-agent"))
    return {**tokens, "message": "google_login"}


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)) -> dict:
    """Return the current authenticated user."""
    user_id = int(current_user.get("id"))
    daily_usage = await auth_core.get_user_daily_usage(user_id)
    try:
        daily_limit = int(os.getenv("DAILY_LIMIT", "5") or 5)
    except ValueError:
        daily_limit = 5
    return {
        "id": user_id,
        "username": current_user.get("username"),
        "role": current_user.get("role"),
        "credits": current_user.get("credits", 0),
        "email": current_user.get("email"),
        "email_verified": current_user.get("email_verified", 0),
        "daily_usage": daily_usage,
        "daily_limit": daily_limit,
    }


@router.post("/redeem")
async def redeem_promo(payload: RedeemRequest, current_user: dict = Depends(get_current_user)) -> dict:
    bonus = await auth_core.redeem_promo_code(current_user["id"], payload.code.strip())
    if bonus <= 0:
        raise HTTPException(status_code=400, detail="Invalid or already redeemed promo code")
    await auth_core.log_audit(
        current_user["id"],
        "promo.redeem",
        {"code": payload.code.strip(), "bonus_attempts": bonus},
    )
    return {"message": "promo redeemed", "bonus_attempts": bonus}


@router.post("/promote")
async def promote_self(payload: PromoteRequest, current_user: dict = Depends(get_current_user)) -> dict:
    allow = os.getenv("ALLOW_SELF_PROMOTE", "false").lower() in {"1", "true", "yes"}
    secret = os.getenv("PROMOTE_SECRET")
    if not allow or not secret or payload.secret != secret:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Promotion disabled")
    await auth_core.set_user_role(current_user["id"], "admin")
    return {"message": "promoted", "role": "admin"}


@router.get("/notifications")
async def notifications(limit: int = 20, current_user: dict = Depends(get_current_user)) -> dict:
    if not auth_core.has_permission(current_user, "account:view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    safe_limit = min(max(limit, 1), 50)
    items = await db_core.fetch_audit_logs(int(current_user.get("id")), limit=safe_limit, offset=0)
    return {"items": items}
