"""
Authentication and user management API routes.

This module exposes endpoints for user registration, login, fetching
the current user, and redeeming promo codes. Authentication is
implemented via opaque session tokens stored in the database.
Clients must include an ``Authorization: Bearer <token>`` header on
protected endpoints.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Header, status
import os
from pydantic import BaseModel, Field, EmailStr
from typing import Optional

from ..core import auth as auth_core


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


@router.post("/register")
async def register(payload: RegisterRequest) -> dict:
    try:
        user_id = await auth_core.create_user(payload.username, payload.email or "", payload.password)
        # Auto login: create session token
        token = await auth_core.create_session(user_id)
        return {"message": "registered", "token": token}
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/login")
async def login(payload: LoginRequest) -> dict:
    user_id = await auth_core.authenticate_user(payload.username, payload.password)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = await auth_core.create_session(user_id)
    return {"token": token}


@router.post("/google")
async def login_google(payload: GoogleLoginRequest) -> dict:
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

    token = await auth_core.create_session(user_id)
    return {"token": token, "message": "google_login"}


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
        "daily_usage": daily_usage,
        "daily_limit": daily_limit,
    }


@router.post("/redeem")
async def redeem_promo(payload: RedeemRequest, current_user: dict = Depends(get_current_user)) -> dict:
    bonus = await auth_core.redeem_promo_code(current_user["id"], payload.code.strip())
    if bonus <= 0:
        raise HTTPException(status_code=400, detail="Invalid or already redeemed promo code")
    return {"message": "promo redeemed", "bonus_attempts": bonus}


@router.post("/promote")
async def promote_self(payload: PromoteRequest, current_user: dict = Depends(get_current_user)) -> dict:
    allow = os.getenv("ALLOW_SELF_PROMOTE", "false").lower() in {"1", "true", "yes"}
    secret = os.getenv("PROMOTE_SECRET")
    if not allow or not secret or payload.secret != secret:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Promotion disabled")
    await auth_core.set_user_role(current_user["id"], "admin")
    return {"message": "promoted", "role": "admin"}
