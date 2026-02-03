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
    payload = auth_core.decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if payload.get("role") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return {"id": int(payload["sub"]), "role": "admin"}


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
    )
    return {"id": promo_id, "code": request.code.strip()}