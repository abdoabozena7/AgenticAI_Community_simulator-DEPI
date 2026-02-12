"""
Admin API routes.

Endpoints under the /admin prefix are restricted to users with the
``admin`` role. They allow administrators to list all users, view basic
usage statistics and create promo codes for distributing bonus
simulation attempts.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Header, status
from pydantic import BaseModel, Field

from ..core import auth as auth_core
from ..core import db

router = APIRouter(prefix="/admin", tags=["admin"])


async def require_admin(authorization: Optional[str] = Header(None)) -> Dict[str, Any]:
    """Dependency to ensure the caller is an admin user."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing or invalid token")
    token = authorization.split(" ", 1)[1]
    user = await auth_core.get_user_by_token(token)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if not auth_core.has_permission(user, "admin:manage"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return {"id": int(user["id"]), "role": "admin"}


@router.get("/users")
async def list_users(_admin_user: Dict[str, Any] = Depends(require_admin)) -> List[Dict[str, Any]]:
    """Return a list of all users with their roles and credits."""
    rows = await db.execute("SELECT id, username, role, credits FROM users", fetch=True)
    return [dict(row) for row in (rows or [])]


@router.get("/stats")
async def get_stats(_admin_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, int]:
    """Return aggregate statistics: total simulations and today's usage."""
    # Total simulations
    sim_rows = await db.execute("SELECT COUNT(*) AS total FROM simulations", fetch=True)
    total_simulations = int(sim_rows[0]["total"]) if sim_rows else 0
    # Today's usage counts across all users
    today = date.today().isoformat()
    usage_rows = await db.execute(
        "SELECT SUM(used_count) AS used FROM daily_usage WHERE usage_date=%s",
        (today,),
        fetch=True,
    )
    used_today = int((usage_rows[0] or {}).get("used") or 0) if usage_rows else 0
    return {"total_simulations": total_simulations, "used_today": used_today}


class PromoCreateRequest(BaseModel):
    code: str = Field(..., min_length=2, max_length=64)
    bonus_attempts: int = Field(..., ge=0)
    max_uses: int = Field(1, ge=1)
    expires_at: Optional[str] = Field(None, description="Expiry date in YYYY-MM-DD format")


@router.post("/promo")
async def create_promo(request: PromoCreateRequest, _admin_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    """Create a promo code."""
    promo_id = await db.insert_promo_code(
        code=request.code.strip(),
        bonus_attempts=request.bonus_attempts,
        max_uses=request.max_uses,
        expires_at=request.expires_at,
        created_by=_admin_user["id"],
    )
    return {"id": promo_id, "code": request.code.strip()}


class CreditAdjustRequest(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None
    delta: float = Field(..., description="Positive or negative credit delta (2 decimals)")


@router.post("/credits")
async def adjust_credits(
    request: CreditAdjustRequest,
    _admin_user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    if not request.user_id and not request.username:
        raise HTTPException(status_code=400, detail="Provide user_id or username")
    user_id = request.user_id
    if user_id is None:
        rows = await db.execute(
            "SELECT id FROM users WHERE username=%s",
            (request.username,),
            fetch=True,
        )
        if not rows:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = int(rows[0]["id"])
    await auth_core.adjust_user_credits(user_id, request.delta)
    updated = await db.execute(
        "SELECT id, username, role, credits FROM users WHERE id=%s",
        (user_id,),
        fetch=True,
    )
    return updated[0] if updated else {"id": user_id, "credits": None}


@router.get("/billing")
async def get_billing_settings(_admin_user: Dict[str, Any] = Depends(require_admin)) -> Dict[str, Any]:
    return await auth_core.get_billing_settings()


class BillingSettingsUpdateRequest(BaseModel):
    token_price_per_1k_credits: float = Field(..., ge=0)
    free_daily_tokens: int = Field(..., ge=0)


@router.post("/billing")
async def update_billing_settings(
    request: BillingSettingsUpdateRequest,
    _admin_user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    settings = await auth_core.set_billing_settings(
        token_price_per_1k_credits=request.token_price_per_1k_credits,
        free_daily_tokens=request.free_daily_tokens,
    )
    return settings


class RoleUpdateRequest(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None
    role: str = Field(..., description="Role to set, e.g. admin or user")


@router.post("/role")
async def update_role(
    request: RoleUpdateRequest,
    _admin_user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    if not request.user_id and not request.username:
        raise HTTPException(status_code=400, detail="Provide user_id or username")
    user_id = request.user_id
    if user_id is None:
        rows = await db.execute(
            "SELECT id FROM users WHERE username=%s",
            (request.username,),
            fetch=True,
        )
        if not rows:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = int(rows[0]["id"])
    await auth_core.set_user_role(user_id, request.role.strip())
    updated = await db.execute(
        "SELECT id, username, role, credits FROM users WHERE id=%s",
        (user_id,),
        fetch=True,
    )
    return updated[0] if updated else {"id": user_id, "role": request.role.strip()}


class UsageResetRequest(BaseModel):
    user_id: Optional[int] = None
    username: Optional[str] = None
    date: Optional[str] = Field(None, description="YYYY-MM-DD; defaults to today")
    all_users: Optional[bool] = False


@router.post("/usage/reset")
async def reset_usage(
    request: UsageResetRequest,
    _admin_user: Dict[str, Any] = Depends(require_admin),
) -> Dict[str, Any]:
    usage_date = request.date or date.today().isoformat()
    if request.all_users:
        await db.execute(
            "DELETE FROM daily_usage WHERE usage_date=%s",
            (usage_date,),
        )
        return {"reset": "all", "date": usage_date}

    if not request.user_id and not request.username:
        raise HTTPException(status_code=400, detail="Provide user_id or username, or set all_users")
    user_id = request.user_id
    if user_id is None:
        rows = await db.execute(
            "SELECT id FROM users WHERE username=%s",
            (request.username,),
            fetch=True,
        )
        if not rows:
            raise HTTPException(status_code=404, detail="User not found")
        user_id = int(rows[0]["id"])
    await db.execute(
        "DELETE FROM daily_usage WHERE user_id=%s AND usage_date=%s",
        (user_id, usage_date),
    )
    return {"reset": user_id, "date": usage_date}
