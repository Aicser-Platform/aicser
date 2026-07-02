"""Community Edition feature-gating helpers.

CE does not have organizations, subscriptions, or billing tables. Shared routes
import these helpers, so they must be available without EE modules.
"""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable, Optional, Tuple

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.pricing.plans import get_plan_config, is_feature_available


async def get_user_organization_id(
    user_id: str,
    db: AsyncSession,
    requested_organization_id: Optional[str] = None,
) -> Optional[str]:
    del db
    return requested_organization_id or user_id or None


async def ensure_free_subscription(organization_id: str, db: AsyncSession) -> None:
    del organization_id, db
    return None


async def org_entitlement(
    organization_id: Optional[str],
    db: AsyncSession,
    feature: str,
) -> Tuple[bool, str]:
    del organization_id, db
    if is_feature_available("free", feature):
        return True, ""
    return False, f"Feature '{feature}' is not available in Community Edition."


async def org_has_plan_feature(
    organization_id: Optional[str],
    db: AsyncSession,
    feature: str,
) -> bool:
    ok, _ = await org_entitlement(organization_id, db, feature)
    return ok


async def get_merged_plan_features_for_org(
    organization_id: Optional[str],
    db: AsyncSession,
) -> dict[str, Any]:
    del organization_id, db
    return dict(get_plan_config("free").get("features") or {})


async def check_feature_for_org(
    organization_id: str,
    feature: str,
    db: AsyncSession,
) -> Tuple[bool, str]:
    return await org_entitlement(organization_id, db, feature)


async def get_organization_plan(organization_id: str, db: AsyncSession) -> Optional[str]:
    del organization_id, db
    return "free"


async def get_plan_features(organization_id: str, db: AsyncSession) -> dict[str, Any]:
    return await get_merged_plan_features_for_org(organization_id, db)


async def check_usage_limit(
    organization_id: str,
    metric: str,
    limit: int,
    db: AsyncSession,
) -> Tuple[bool, str]:
    del organization_id, metric, limit, db
    return True, "Usage limits are not enforced in Community Edition."


async def increment_usage(
    organization_id: str,
    metric: str,
    amount: int,
    db: AsyncSession,
) -> bool:
    del organization_id, metric, amount, db
    return True


def _extract_user_id(token: Any) -> str:
    if isinstance(token, dict):
        return str(token.get("id") or token.get("sub") or token.get("user_id") or "")
    return str(token or "")


def require_feature(feature_name: str, plan_required: Optional[str] = None):
    del plan_required

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            db = kwargs.get("db")
            if not db:
                for arg in args:
                    if isinstance(arg, AsyncSession):
                        db = arg
                        break
            if db:
                ok, reason = await check_feature_for_org("ce", feature_name, db)
                if not ok:
                    raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=reason)
            return await func(*args, **kwargs)

        return wrapper

    return decorator


def require_plan(min_plan: str):
    del min_plan

    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            return await func(*args, **kwargs)

        return wrapper

    return decorator


def require_plan_feature(feature: str):
    async def dependency(
        request: Request,
        current_token: Any = Depends(JWTCookieBearer()),
        db: AsyncSession = Depends(get_async_session),
    ) -> None:
        user_id = _extract_user_id(current_token)
        org_id = await get_user_organization_id(user_id, db)
        ok, reason = await check_feature_for_org(org_id or "ce", feature, db)
        if not ok:
            raise HTTPException(status_code=status.HTTP_402_PAYMENT_REQUIRED, detail=reason)
        request.state.organization_id = org_id

    return dependency
