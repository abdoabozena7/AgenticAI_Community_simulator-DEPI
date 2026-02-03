"""
Authentication API routes.

This router exposes endpoints for registering a new account, logging in
with username/password to receive a JWT, fetching the current user and
redeeming promo codes. All protected endpoints require the client to
include an ``Authorization: Bearer <jwt>`` header. The JWT payload
includes the user ID and role and is verified via the secret configured
in ``JWT_SECRET``.
"""

from __future__ import annotations

from typing import Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

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


async def get_current_user(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Resolve the current user from the Authorization header.

    Raises HTTPException if the token is missing or invalid.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ", 1)[1]
    payload = auth_core.decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    # Retrieve user details
    user_id = int(payload.get("sub"))
    role = payload.get("role", "user")
    # Credits are not stored in JWT; fetch from DB
    return {"id": user_id, "role": role}


@router.post("/register")
async def register(payload: RegisterRequest) -> Dict[str, Any]:
    try:
        user_id = await auth_core.create_user(payload.username, payload.email or "", payload.password)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    # Issue JWT on registration
    token = auth_core.create_access_token(user_id, role="user")
    return {"token": token}


@router.post("/login")
async def login(payload: LoginRequest) -> Dict[str, Any]:
    user = await auth_core.authenticate_user(payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = auth_core.create_access_token(user["id"], role=user.get("role", "user"))
    return {"token": token}


@router.get("/me")
async def get_me(current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = current_user["id"]
    # Fetch credits from DB
    credits = await auth_core.get_user_credits(user_id)
    return {"id": user_id, "role": current_user.get("role"), "credits": credits}


@router.post("/redeem")
async def redeem_promo(payload: RedeemRequest, current_user: Dict[str, Any] = Depends(get_current_user)) -> Dict[str, Any]:
    user_id = current_user["id"]
    bonus = await auth_core.redeem_promo_code(user_id, payload.code.strip())
    if bonus <= 0:
        raise HTTPException(status_code=400, detail="Invalid or already redeemed promo code")
    return {"bonus_attempts": bonus}