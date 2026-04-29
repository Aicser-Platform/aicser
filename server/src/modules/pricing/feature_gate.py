"""
Feature Gating Middleware and Decorators
Enforces plan-based feature access throughout the application
"""

from functools import wraps
from typing import Callable, Any, Optional, Tuple, Union
from fastapi import HTTPException, Depends, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_
from datetime import datetime, timezone
import logging

from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.pricing.plans import get_plan_config, is_feature_available
from src.db.session import get_async_session
from src.modules.authentication.rbac.models import UserRole
from src.modules.billing.models import OrganizationSubscription, SubscriptionPlan, OrganizationUsage
from src.modules.organizations.models import Organization

logger = logging.getLogger(__name__)


async def get_user_organization_id(user_id: str, db: AsyncSession) -> Optional[str]:
    """
    Get the organization ID for a user from UserRole.
    Returns the first organization the user is associated with.
    """
    try:
        stmt = select(UserRole).where(
            and_(
                UserRole.user_id == user_id,
                UserRole.organization_id.isnot(None)
            )
        ).limit(1)
        
        result = await db.execute(stmt)
        user_role = result.scalar_one_or_none()
        
        if user_role:
            return str(user_role.organization_id)
        
        logger.warning(f"No organization found for user {user_id}")
        return None
        
    except Exception as e:
        logger.error(f"Error getting organization for user {user_id}: {e}")
        return None


def _subscription_inactive(sub: OrganizationSubscription) -> bool:
    now = datetime.now(timezone.utc)
    if sub.status == "trialing" and sub.trial_ends_at and sub.trial_ends_at < now:
        return True
    if sub.ends_at and sub.ends_at < now:
        return True
    return False


async def _fetch_active_subscription(
    organization_id: str, db: AsyncSession
) -> Optional[Tuple[OrganizationSubscription, SubscriptionPlan]]:
    """Active / trialing / canceled-but-in-period subscription row with plan."""
    try:
        now = datetime.now(timezone.utc)
        stmt = (
            select(OrganizationSubscription, SubscriptionPlan)
            .join(SubscriptionPlan, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(
                and_(
                    OrganizationSubscription.organization_id == organization_id,
                    or_(
                        OrganizationSubscription.status.in_(["active", "trialing"]),
                        and_(
                            OrganizationSubscription.status == "canceled",
                            OrganizationSubscription.ends_at != None,
                            OrganizationSubscription.ends_at > now,
                        ),
                    ),
                )
            )
        )
        result = await db.execute(stmt)
        row = result.first()
        return (row[0], row[1]) if row else None
    except Exception as e:
        logger.error("Error fetching subscription for org %s: %s", organization_id, e)
        return None


async def _resolve_org_plan_context(
    organization_id: Optional[str], db: AsyncSession
) -> Tuple[str, dict]:
    """
    Effective billing tier (slug) and DB plan.features for merges.
    No org, no subscription, or inactive trial/subscription => free tier.
    """
    if not organization_id:
        return "free", {}
    sp = await _fetch_active_subscription(organization_id, db)
    if not sp:
        return "free", {}
    sub, plan = sp
    if _subscription_inactive(sub):
        return "free", {}
    return plan.slug, (plan.features or {})


async def org_entitlement(
    organization_id: Optional[str], db: AsyncSession, feature: str
) -> Tuple[bool, str]:
    """
    Authoritative gate: PLAN_CONFIGS tier matrix + optional SubscriptionPlan.features
    booleans (DB can turn a tier feature off). Respects trial / period expiry.
    """
    slug, db_feats = await _resolve_org_plan_context(organization_id, db)
    if not is_feature_available(slug, feature):
        return False, f"Feature '{feature}' requires a higher plan."
    fv = db_feats.get(feature)
    if isinstance(fv, bool) and not fv:
        return False, f"Feature '{feature}' is disabled for your organization's subscription."
    return True, ""


async def org_has_plan_feature(
    organization_id: Optional[str], db: AsyncSession, feature: str
) -> bool:
    ok, _ = await org_entitlement(organization_id, db, feature)
    return ok


async def get_merged_plan_features_for_org(
    organization_id: Optional[str], db: AsyncSession
) -> dict[str, Any]:
    """Tier defaults from PLAN_CONFIGS merged with DB booleans; non-bool values from tier config."""
    slug, db_feats = await _resolve_org_plan_context(organization_id, db)
    tier = dict(get_plan_config(slug).get("features") or {})
    out: dict[str, Any] = {}
    for k, v in tier.items():
        if isinstance(v, bool):
            if k in db_feats and isinstance(db_feats[k], bool):
                out[k] = bool(v) and bool(db_feats[k])
            else:
                out[k] = bool(v)
        else:
            out[k] = v
    return out


def require_feature(feature_name: str, plan_required: Optional[str] = None):
    """
    Decorator to require a specific feature for an endpoint.
    
    Args:
        feature_name: Name of the feature to check (e.g., 'api_access', 'advanced_ai')
        plan_required: Optional specific plan name (e.g., 'pro'). If None, checks if feature is available.
    
    Usage:
        @require_feature("advanced_ai")
        async def advanced_endpoint(...):
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract current_token from kwargs (injected by JWTCookieBearer)
            current_token = kwargs.get('current_token')
            
            if not current_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required"
                )
            
            # Extract user_id from token
            user_id = None
            if isinstance(current_token, dict):
                user_id = current_token.get('sub') or current_token.get('user_id')
            
            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication token"
                )
            
            # Get database session
            db: AsyncSession = kwargs.get('db')
            if not db:
                # Try to get from dependency injection
                for arg in args:
                    if isinstance(arg, AsyncSession):
                        db = arg
                        break
            
            if not db:
                logger.error("No database session available for feature gating")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal server error"
                )
            
            # Get organization
            org_id = await get_user_organization_id(user_id, db)
            
            if not org_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No organization found. Please contact support."
                )
            
            # Check feature access
            has_access, denial_reason = await check_feature_for_org(org_id, feature_name, db)
            
            if not has_access:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail={
                        "message": f"Feature '{feature_name}' requires a higher plan",
                        "reason": denial_reason,
                        "feature": feature_name,
                        "upgrade_required": True
                    }
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


def require_plan(min_plan: str):
    """
    Decorator to require a minimum plan level.
    
    Args:
        min_plan: Minimum plan required ('free', 'pro', 'team', 'enterprise')
    
    Usage:
        @require_plan("pro")
        async def pro_endpoint(...):
            ...
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Extract current_token from kwargs
            current_token = kwargs.get('current_token')
            
            if not current_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authentication required"
                )
            
            # Extract user_id from token
            user_id = None
            if isinstance(current_token, dict):
                user_id = current_token.get('sub') or current_token.get('user_id')
            
            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication token"
                )
            
            # Get database session
            db: AsyncSession = kwargs.get('db')
            if not db:
                for arg in args:
                    if isinstance(arg, AsyncSession):
                        db = arg
                        break
            
            if not db:
                logger.error("No database session available for plan checking")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Internal server error"
                )
            
            # Get organization
            org_id = await get_user_organization_id(user_id, db)
            
            if not org_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="No organization found. Please contact support."
                )
            
            # Effective tier (includes orgs without a subscription row => free)
            current_plan, _ = await _resolve_org_plan_context(org_id, db)

            plan_hierarchy = {'free': 0, 'pro': 1, 'team': 2, 'enterprise': 3}
            required_level = plan_hierarchy.get(min_plan.lower(), 0)
            current_level = plan_hierarchy.get(current_plan.lower(), 0)
            
            if current_level < required_level:
                raise HTTPException(
                    status_code=status.HTTP_402_PAYMENT_REQUIRED,
                    detail={
                        "message": f"This feature requires at least '{min_plan}' plan",
                        "current_plan": current_plan,
                        "required_plan": min_plan,
                        "upgrade_required": True
                    }
                )
            
            return await func(*args, **kwargs)
        return wrapper
    return decorator


async def check_feature_for_org(organization_id: str, feature: str, db: AsyncSession) -> Tuple[bool, str]:
    """
    Check if an organization has access to a specific feature.

    Uses live subscription tier + PLAN_CONFIGS, merged with SubscriptionPlan.features booleans.
    """
    try:
        return await org_entitlement(organization_id, db, feature)
    except Exception as e:
        logger.error(f"Error checking feature for org {organization_id}: {e}")
        return (False, "Error checking feature access. Please try again.")


async def get_organization_plan(organization_id: str, db: AsyncSession) -> Optional[str]:
    """
    Plan slug from an active, in-period subscription, or None if the org should be treated
    as having no paid row (callers typically use `or \"free\"`).

    Expired trials / ended subscriptions return None so billing falls back to free.
    """
    try:
        sp = await _fetch_active_subscription(organization_id, db)
        if not sp:
            return None
        sub, plan = sp
        if _subscription_inactive(sub):
            return None
        return plan.slug
    except Exception as e:
        logger.error(f"Error getting plan for org {organization_id}: {e}")
        return None


async def get_plan_features(organization_id: str, db: AsyncSession) -> dict[str, Any]:
    """Merged feature map (same basis as /pricing/entitlements and API gates)."""
    try:
        return await get_merged_plan_features_for_org(organization_id, db)
    except Exception as e:
        logger.error(f"Error getting features for org {organization_id}: {e}")
        return {}


async def check_usage_limit(
    organization_id: str,
    metric: str,
    limit: int,
    db: AsyncSession
) -> Tuple[bool, int, int]:
    """
    Check if organization is within usage limit for a metric.
    
    Returns:
        (under_limit: bool, current_usage: int, limit: int)
    """
    try:
        # Get current period usage
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == organization_id,
                OrganizationUsage.metric == metric,
                OrganizationUsage.period_start == period_start
            )
        )
        
        result = await db.execute(stmt)
        usage = result.scalar_one_or_none()
        
        current_usage = usage.used if usage else 0
        
        # -1 means unlimited
        if limit == -1:
            return (True, current_usage, -1)
        
        under_limit = current_usage < limit
        
        return (under_limit, current_usage, limit)
        
    except Exception as e:
        logger.error(f"Error checking usage limit for org {organization_id}: {e}")
        return (True, 0, limit)  # Allow access on error


async def increment_usage(
    organization_id: str,
    metric: str,
    amount: int,
    db: AsyncSession
) -> None:
    """Increment usage for a metric."""
    try:
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        # Calculate next period start
        if period_start.month == 12:
            period_end = period_start.replace(year=period_start.year + 1, month=1)
        else:
            period_end = period_start.replace(month=period_start.month + 1)
        
        # Try to get existing usage record
        stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == organization_id,
                OrganizationUsage.metric == metric,
                OrganizationUsage.period_start == period_start
            )
        )
        
        result = await db.execute(stmt)
        usage = result.scalar_one_or_none()
        
        if usage:
            usage.used += amount
        else:
            # Create new usage record
            from src.modules.billing.models import OrganizationUsage
            usage = OrganizationUsage(
                organization_id=organization_id,
                metric=metric,
                used=amount,
                period_start=period_start,
                period_end=period_end
            )
            db.add(usage)
        
        await db.commit()
        
    except Exception as e:
        logger.error(f"Error incrementing usage for org {organization_id}: {e}")
        await db.rollback()


def require_plan_feature(feature: str):
    """
    FastAPI dependency factory: require a PLAN_CONFIGS feature for the caller's org
    (resolved via active subscription plan slug).
    """

    async def _dep(
        current_token: Union[str, dict] = Depends(JWTCookieBearer()),
        db: AsyncSession = Depends(get_async_session),
    ) -> None:
        user_id = None
        if isinstance(current_token, dict):
            user_id = (
                current_token.get("id")
                or current_token.get("user_id")
                or current_token.get("sub")
            )
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

        org_id = await get_user_organization_id(str(user_id), db)
        slug, _ = await _resolve_org_plan_context(org_id, db)
        ok, reason = await org_entitlement(org_id, db, feature)
        if not ok:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "message": reason or "This capability requires a higher plan.",
                    "feature": feature,
                    "upgrade_required": True,
                    "required_plan": "pro",
                    "current_plan": slug,
                },
            )

    return _dep

