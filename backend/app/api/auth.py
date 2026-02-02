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


@router.get("/me")
async def get_me(current_user: dict = Depends(get_current_user)) -> dict:
    """Return the current authenticated user."""
    return {
        "id": current_user.get("id"),
        "username": current_user.get("username"),
        "role": current_user.get("role"),
        "credits": current_user.get("credits", 0),
    }


@router.post("/redeem")
async def redeem_promo(payload: RedeemRequest, current_user: dict = Depends(get_current_user)) -> dict:
    bonus = await auth_core.redeem_promo_code(current_user["id"], payload.code.strip())
    if bonus <= 0:
        raise HTTPException(status_code=400, detail="Invalid or already redeemed promo code")
    return {"message": "promo redeemed", "bonus_attempts": bonus}