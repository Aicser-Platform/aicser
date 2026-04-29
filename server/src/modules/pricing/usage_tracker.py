"""
Usage Tracking Utilities
Track and enforce usage limits for organizations
"""

from typing import Optional, Tuple, Dict, Any
from datetime import datetime, timezone
from uuid import UUID
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.exc import IntegrityError
import logging
import traceback
from math import ceil

from src.modules.ai.models import LlmAuditLog, LlmRequestSummary
from src.modules.authentication.rbac.models import UserRole, Role
from src.modules.billing.models import OrganizationSubscription, SubscriptionPlan, OrganizationUsage
from src.modules.data.models import DataSource
from src.modules.project.models import Project
from src.modules.user.models import User
from src.modules.pricing.plans import PLAN_CONFIGS

logger = logging.getLogger(__name__)

SAMPLE_DATA_SOURCE_TYPES = ("sample_duckdb",)


def _is_transient_db_connection_error(exc: BaseException) -> bool:
    """True when a fresh session / retry may succeed (stale pool conn, server closed socket, etc.)."""
    if isinstance(exc, asyncio.CancelledError):
        return False
    msg = str(exc).lower()
    needles = (
        "connection is closed",
        "connection was closed",
        "connection closed",
        "interfaceerror",
        "operationalerror",
        "server closed the connection",
        "ssl syscall error",
        "connection reset",
        "broken pipe",
        "cannot switch to state",
    )
    if any(n in msg for n in needles):
        return True
    orig = getattr(exc, "orig", None)
    if orig is not None and orig is not exc:
        return _is_transient_db_connection_error(orig)
    return False


def _active_subscription_filter():
    """SQLAlchemy filter for subscriptions that should grant plan access.
    Includes active, trialing, AND canceled-but-still-in-period subscriptions."""
    now = datetime.now(timezone.utc)
    return or_(
        OrganizationSubscription.status.in_(['active', 'trialing']),
        and_(
            OrganizationSubscription.status == 'canceled',
            OrganizationSubscription.ends_at != None,
            OrganizationSubscription.ends_at > now,
        ),
    )


async def resolve_organization_id(user_id: str, db: AsyncSession = None) -> Optional[str]:
    """
    Resolve the real organization UUID for a user.
    Looks up user_roles.user_id == auth_user_id first,
    then falls back to users.user_id -> users.id -> user_roles.
    Returns the organization_id string or None.
    """
    async def _do_resolve(_db: AsyncSession) -> Optional[str]:
        # Direct: user_roles.user_id matches JWT sub directly
        stmt = (
            select(UserRole.organization_id)
            .where(
                and_(
                    UserRole.user_id == user_id,
                    UserRole.organization_id != None,
                )
            )
            .limit(1)
        )
        result = await _db.execute(stmt)
        org_id = result.scalar_one_or_none()
        if org_id:
            return str(org_id)

        # Indirect: users.user_id (Supabase) -> users.id -> user_roles
        stmt2 = (
            select(UserRole.organization_id)
            .join(User, User.user_id == UserRole.user_id)
            .where(
                and_(
                    User.user_id == user_id,
                    UserRole.organization_id != None,
                )
            )
            .limit(1)
        )
        result2 = await _db.execute(stmt2)
        org_id2 = result2.scalar_one_or_none()
        return str(org_id2) if org_id2 else None

    max_attempts = 3 if db is None else 1
    for attempt in range(max_attempts):
        try:
            if db:
                return await _do_resolve(db)
            from src.db.session import async_session as _async_session

            async with _async_session() as _db:
                return await _do_resolve(_db)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            transient = _is_transient_db_connection_error(e)
            if transient and db is None and attempt < max_attempts - 1:
                delay = 0.05 * (attempt + 1)
                logger.warning(
                    "resolve_organization_id transient DB error for user %s (attempt %s/%s), retrying in %ss: %s",
                    user_id,
                    attempt + 1,
                    max_attempts,
                    delay,
                    e,
                )
                await asyncio.sleep(delay)
                continue
            logger.error("Error resolving organization_id for user %s: %s", user_id, e)
            return None
    return None


def _get_free_plan_limits() -> dict:
    """Get free plan limits dict matching the DB limits JSONB shape."""
    config = PLAN_CONFIGS['free']
    return {
        "ai_credits_limit": config["ai_credits_limit"],
        "max_projects": config["max_projects"],
        "max_users": config.get("max_users", 1),
        "max_data_sources": config["max_data_sources"],
        "storage_limit_gb": config["storage_limit_gb"],
        "api_calls_per_month": config.get("api_calls_per_month", 100),
    }


def _normalized_plan_limits(plan_slug: str, limits: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Normalize plan limits with code defaults, forcing current Team credit policy."""
    slug = (plan_slug or "free").strip().lower()
    normalized: Dict[str, Any] = dict(limits or {})
    plan_defaults = PLAN_CONFIGS.get(slug, PLAN_CONFIGS["free"])

    if slug == "team":
        # Team policy is authoritative in code: 5000 total / 1000 per seat.
        normalized["ai_credits_limit"] = plan_defaults.get("ai_credits_limit", 5000)
        normalized["ai_credits_per_user_limit"] = plan_defaults.get("ai_credits_per_user_limit", 1000)
        if normalized.get("max_users") in (None, 0):
            normalized["max_users"] = plan_defaults.get("max_users", 5)

    return normalized


def _safe_uuid(value: Optional[str]) -> Optional[UUID]:
    if not value:
        return None
    try:
        return UUID(str(value))
    except Exception:
        return None


def _team_per_user_ai_credit_limit(limits: Dict[str, Any]) -> int:
    """Resolve Team plan per-user AI credit cap (defaults to 1000)."""
    explicit = limits.get("ai_credits_per_user_limit")
    if explicit is not None:
        try:
            return max(1, int(explicit))
        except (TypeError, ValueError):
            pass

    try:
        total = int(limits.get("ai_credits_limit", 0) or 0)
        seats = int(limits.get("max_users", 0) or 0)
        if total > 0 and seats > 0:
            return max(1, total // seats)
    except (TypeError, ValueError):
        pass

    return 1000


def _user_ai_credit_metric(user_id: str) -> str:
    """Build a user-scoped metric key for per-user AI credit tracking."""
    normalized = str(user_id).strip()
    if len(normalized) > 80:
        import hashlib

        normalized = hashlib.sha1(normalized.encode("utf-8")).hexdigest()
    return f"ai_credits_user:{normalized}"


async def _resolve_user_uuid_candidates(user_id: Optional[str], db: AsyncSession) -> list[UUID]:
    """Resolve candidate UUIDs for a user across auth-id and internal-id shapes."""
    if not user_id:
        return []

    candidate_set: set[UUID] = set()
    parsed = _safe_uuid(user_id)
    if parsed:
        candidate_set.add(parsed)

    try:
        if parsed:
            stmt = (
                select(User.id, User.user_id)
                .where(or_(User.id == parsed, User.user_id == parsed))
                .limit(1)
            )
            result = await db.execute(stmt)
            row = result.first()
            if row:
                if row[0]:
                    candidate_set.add(row[0])
                if row[1]:
                    candidate_set.add(row[1])
    except Exception:
        # Best-effort enrichment only.
        pass

    return list(candidate_set)


async def _normalize_user_id_for_metric(user_id: Optional[str], db: AsyncSession) -> Optional[str]:
    """Resolve a canonical user id string for per-user usage metrics."""
    if not user_id:
        return None
    raw = str(user_id).strip()
    if not raw:
        return None
    parsed = _safe_uuid(raw)
    if not parsed:
        return raw

    stmt = select(User).where(or_(User.id == parsed, User.user_id == parsed)).limit(1)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()
    if not user:
        return raw
    if user.user_id:
        return str(user.user_id)
    if user.id:
        return str(user.id)
    return raw


async def _user_metric_keys(user_id: Optional[str], db: AsyncSession) -> list[str]:
    """Build a de-duplicated list of possible per-user usage metric keys."""
    if not user_id:
        return []

    keys: list[str] = []
    primary = await _normalize_user_id_for_metric(user_id, db)
    if primary:
        keys.append(_user_ai_credit_metric(primary))

    raw = str(user_id).strip()
    if raw and raw != primary:
        keys.append(_user_ai_credit_metric(raw))

    for candidate in await _resolve_user_uuid_candidates(user_id, db):
        candidate_str = str(candidate)
        key = _user_ai_credit_metric(candidate_str)
        if key not in keys:
            keys.append(key)

    return keys


# ── AI Credit Cost Calculation ──────────────────────────────────────────────

# Credit formula (proposal aligned):
# credits = ceil(ceil(tokens/1000) * model_multiplier + dataset_cost + analysis_mode_multiplier * base_cost)
BASE_ANALYSIS_COST = 1.0
MAX_CREDITS_PER_REQUEST = 10

# Multiplier based on LLM model (substring match, first hit wins)
MODEL_MULTIPLIER = {
    "gpt-5": 1.5,
    "gpt-4.1": 1.5,
    "gpt-4o": 1.0,
    "gpt-4o-mini": 1.0,
    "gpt-4": 1.5,
    "claude-3-sonnet": 2.0,
    "claude-3-haiku": 1.0,
    "claude-3-opus": 3.0,
    "auto": 1.25,
}

# Analysis-mode multipliers
ANALYSIS_MODE_MULTIPLIER = {
    "chat": 0.3,
    "conversational": 0.3,
    "descriptive": 0.5,
    "standard": 0.5,
    "diagnostic": 1.0,
    "predictive": 1.0,
    "animate": 1.0,
    "deep": 1.0,
    "prescriptive": 1.5,
    "executive_report": 1.0,
    "executive_report_brief": 1.0,
    "executive_report_standard": 1.5,
    "executive_report_comprehensive": 2.0,
}

# Dataset add-on based on data source size (bytes)
SIZE_THRESHOLDS = [
    (1 * 1024 * 1024 * 1024 * 1024, 12),  # >1TB:   +12 credits
    (1 * 1024 * 1024 * 1024, 6),          # >1GB:   +6 credits
    (500 * 1024 * 1024, 4),               # >500MB: +4 credits
    (10 * 1024 * 1024, 2),   # >10MB: +2 credits
    (1 * 1024 * 1024, 1),    # >1MB:  +1 credit
    (0, 0.5),                 # >0B:   +0.5 credits
]


def estimate_token_usage(
    query: Optional[str],
    analysis_mode: Optional[str] = "standard",
    data_source_size_bytes: int = 0,
    has_data_source: bool = True,
) -> int:
    """Estimate token usage before execution for pre-flight quota checks."""
    text = (query or "").strip()
    words = len(text.split())
    prompt_tokens = max(64, int(words * 1.35) + 64)

    mode_key = (analysis_mode or "standard").strip().lower()
    mode_completion_hint = {
        "chat": 180,
        "conversational": 220,
        "descriptive": 350,
        "standard": 350,
        "diagnostic": 600,
        "predictive": 700,
        "animate": 650,
        "deep": 900,
        "prescriptive": 1000,
        "executive_report": 850,
        "executive_report_brief": 850,
        "executive_report_standard": 1200,
        "executive_report_comprehensive": 1700,
    }
    completion_tokens = mode_completion_hint.get(mode_key, 450)

    # Larger datasets typically increase SQL/debug/reasoning iterations
    dataset_hint = 0
    if has_data_source:
        if data_source_size_bytes > 1 * 1024 * 1024 * 1024 * 1024:
            dataset_hint = 2500
        elif data_source_size_bytes > 1 * 1024 * 1024 * 1024:
            dataset_hint = 1400
        elif data_source_size_bytes > 500 * 1024 * 1024:
            dataset_hint = 1000
        elif data_source_size_bytes > 10 * 1024 * 1024:
            dataset_hint = 500
        elif data_source_size_bytes > 1 * 1024 * 1024:
            dataset_hint = 220

    estimate = prompt_tokens + completion_tokens + dataset_hint
    return max(1, estimate)


def _resolve_model_multiplier(model: Optional[str], policy_overrides: Optional[Dict[str, Any]] = None) -> float:
    model_key = (model or "").lower().strip()
    override_map = (policy_overrides or {}).get("model_multipliers") or {}
    for key, mult in override_map.items():
        if key and key.lower() in model_key:
            try:
                return float(mult)
            except (TypeError, ValueError):
                continue
    for key, mult in MODEL_MULTIPLIER.items():
        if key in model_key:
            return float(mult)
    return float((policy_overrides or {}).get("default_model_multiplier", 1.0))


def _resolve_analysis_multiplier(analysis_mode: Optional[str], policy_overrides: Optional[Dict[str, Any]] = None) -> float:
    mode = (analysis_mode or "standard").lower().strip()
    override_map = (policy_overrides or {}).get("analysis_mode_multipliers") or {}
    if mode in override_map:
        try:
            return float(override_map[mode])
        except (TypeError, ValueError):
            pass
    return float(ANALYSIS_MODE_MULTIPLIER.get(mode, 1.0))


def _resolve_dataset_cost(data_source_size_bytes: int, policy_overrides: Optional[Dict[str, Any]] = None) -> float:
    tiers = (policy_overrides or {}).get("dataset_tiers")
    if isinstance(tiers, list):
        try:
            normalized = sorted(
                [(int(t.get("threshold_bytes", 0)), float(t.get("credits", 0) or 0)) for t in tiers],
                key=lambda x: x[0],
                reverse=True,
            )
            for threshold, credits in normalized:
                if data_source_size_bytes > threshold:
                    return max(0.0, float(credits))
        except Exception:
            pass

    for threshold, bonus in SIZE_THRESHOLDS:
        if data_source_size_bytes > threshold:
            return float(bonus)
    return 0.0


def _credit_cap(policy_overrides: Optional[Dict[str, Any]] = None) -> int:
    try:
        return max(1, int((policy_overrides or {}).get("max_credits_per_request", MAX_CREDITS_PER_REQUEST)))
    except (TypeError, ValueError):
        return MAX_CREDITS_PER_REQUEST


def calculate_ai_credit_cost(
    analysis_mode: Optional[str] = "standard",
    model: Optional[str] = None,
    data_source_size_bytes: int = 0,
    has_data_source: bool = True,
    token_usage: Optional[int] = None,
    policy_overrides: Optional[Dict[str, Any]] = None,
) -> int:
    """
    Calculate AI credit cost for a query based on analysis mode, model, and dataset size.

    Returns:
        int: Number of credits to deduct (minimum 1 for data analysis, 0 for conversational)
    """
    # Conversational queries (no data source) are free
    if not has_data_source:
        return 0

    effective_tokens = max(0, int(token_usage or 0))
    token_units = ceil(effective_tokens / 1000) if effective_tokens > 0 else 0

    multiplier = _resolve_model_multiplier(model, policy_overrides)
    mode_multiplier = _resolve_analysis_multiplier(analysis_mode, policy_overrides)
    size_bonus = _resolve_dataset_cost(data_source_size_bytes, policy_overrides)

    token_cost = token_units * multiplier
    mode_cost = mode_multiplier * float((policy_overrides or {}).get("base_analysis_cost", BASE_ANALYSIS_COST))
    total_raw = token_cost + size_bonus + mode_cost
    total = max(1, int(ceil(total_raw)))
    total = min(total, _credit_cap(policy_overrides))

    logger.debug(
        "AI credit cost: tokens=%s token_units=%s model=%s(%.2f) mode=%s(%.2f) dataset_bonus=%s => %.2f => capped=%s",
        effective_tokens,
        token_units,
        (model or "").lower().strip(),
        multiplier,
        (analysis_mode or "standard").lower().strip(),
        mode_multiplier,
        size_bonus,
        total_raw,
        total,
    )
    return total


async def get_customer_credit_policy(
    organization_id: str,
    db: AsyncSession,
) -> Dict[str, Any]:
    """Resolve credit policy for an org.

    Priority order:
    1) DB limits JSON (if present) — allows runtime overrides.
    2) Code defaults from `PLAN_CONFIGS` based on the active subscription's plan slug.
    3) Free plan defaults when no active subscription.
    """
    try:
        stmt = (
            select(SubscriptionPlan.slug, SubscriptionPlan.limits)
            .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(
                and_(
                    OrganizationSubscription.organization_id == organization_id,
                    _active_subscription_filter(),
                )
            )
        )
        result = await db.execute(stmt)
        row = result.first()

        plan_slug = None
        limits: Dict[str, Any] = {}
        if row:
            plan_slug = str(row[0]) if row[0] else None
            limits = row[1] or {}

        if not isinstance(limits, dict):
            limits = {}

        effective_slug = (plan_slug or "free").strip().lower()
        plan_config = PLAN_CONFIGS.get(effective_slug, PLAN_CONFIGS["free"])

        # Start from code defaults so behavior is plan-aware even when DB limits are minimal.
        merged_limits: Dict[str, Any] = {
            "ai_credit_max_per_request": plan_config.get("ai_credit_max_per_request"),
            "ai_base_analysis_cost": plan_config.get("ai_base_analysis_cost"),
            "ai_model_multipliers": plan_config.get("ai_model_multipliers"),
            "ai_analysis_mode_multipliers": plan_config.get("ai_analysis_mode_multipliers"),
            "ai_dataset_tiers": plan_config.get("ai_dataset_tiers"),
            "ai_default_model_multiplier": plan_config.get("ai_default_model_multiplier"),
        }
        # Overlay DB-provided keys (if any) to allow runtime overrides.
        for key in (
            "ai_credit_max_per_request",
            "ai_base_analysis_cost",
            "ai_model_multipliers",
            "ai_analysis_mode_multipliers",
            "ai_dataset_tiers",
            "ai_default_model_multiplier",
        ):
            if key in limits and limits.get(key) is not None:
                merged_limits[key] = limits.get(key)

        policy: Dict[str, Any] = {}
        if merged_limits.get("ai_credit_max_per_request") is not None:
            policy["max_credits_per_request"] = merged_limits.get("ai_credit_max_per_request")
        if merged_limits.get("ai_model_multipliers") is not None:
            policy["model_multipliers"] = merged_limits.get("ai_model_multipliers")
        if merged_limits.get("ai_analysis_mode_multipliers") is not None:
            policy["analysis_mode_multipliers"] = merged_limits.get("ai_analysis_mode_multipliers")
        if merged_limits.get("ai_dataset_tiers") is not None:
            policy["dataset_tiers"] = merged_limits.get("ai_dataset_tiers")
        if merged_limits.get("ai_default_model_multiplier") is not None:
            policy["default_model_multiplier"] = merged_limits.get("ai_default_model_multiplier")
        if merged_limits.get("ai_base_analysis_cost") is not None:
            policy["base_analysis_cost"] = merged_limits.get("ai_base_analysis_cost")
        return policy
    except Exception as e:
        logger.debug("Could not load customer credit policy for org %s: %s", organization_id, e)
        return {}


async def check_ai_credit_limit(
    organization_id: str,
    credits_needed: int,
    db: AsyncSession,
    user_id: Optional[str] = None,
) -> Tuple[bool, int, int, str]:
    """
    Check if the organization has enough AI credits without deducting.

    Returns:
        (allowed: bool, current_used: int, credit_limit: int, message: str)
    """
    try:
        if credits_needed <= 0:
            return (True, 0, 0, "No credits required")

        # Get plan limits
        stmt = (
            select(SubscriptionPlan.slug, SubscriptionPlan.limits)
            .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(
                and_(
                    OrganizationSubscription.organization_id == organization_id,
                    _active_subscription_filter()
                )
            )
        )
        result = await db.execute(stmt)
        row = result.first()

        if not row:
            plan_slug = "free"
            limits = _get_free_plan_limits()
        else:
            plan_slug, limits = row
            plan_slug = str(plan_slug or "free").lower()
            limits = _normalized_plan_limits(plan_slug, limits)

        if plan_slug == "free":
            limits = _normalized_plan_limits(plan_slug, limits)

        credit_limit = limits.get('ai_credits_limit', 0)

        # Get current period usage
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == organization_id,
                OrganizationUsage.metric == 'ai_credits',
                OrganizationUsage.period_start == period_start
            )
        )
        result = await db.execute(stmt)
        usage = result.scalar_one_or_none()
        current_used = usage.used if usage else 0

        # First enforce team-wide credits for Team plan.
        if credit_limit != -1:
            team_remaining = credit_limit - current_used
            if team_remaining < credits_needed:
                return (
                    False,
                    current_used,
                    credit_limit,
                    f"Team AI credit limit reached ({current_used}/{credit_limit}). This query costs {credits_needed} credits but your team only has {team_remaining} remaining.",
                )

        # Team plan enforces an additional per-user monthly cap.
        if plan_slug == "team" and user_id:
            per_user_limit = _team_per_user_ai_credit_limit(limits)
            user_metric_keys = await _user_metric_keys(user_id, db)
            user_current_used = 0
            if user_metric_keys:
                user_sum_stmt = select(func.coalesce(func.sum(OrganizationUsage.used), 0)).where(
                    and_(
                        OrganizationUsage.organization_id == organization_id,
                        OrganizationUsage.metric.in_(user_metric_keys),
                        OrganizationUsage.period_start == period_start,
                    )
                )
                user_sum_result = await db.execute(user_sum_stmt)
                user_current_used = int(user_sum_result.scalar_one_or_none() or 0)
            user_remaining = per_user_limit - user_current_used

            if user_remaining < credits_needed:
                return (
                    False,
                    user_current_used,
                    per_user_limit,
                    f"Your Team plan AI credit limit reached ({user_current_used}/{per_user_limit}). This query costs {credits_needed} credits but you only have {user_remaining} remaining this month.",
                )

            return (
                True,
                user_current_used,
                per_user_limit,
                f"You have {user_remaining} personal Team credits remaining this month",
            )

        # Check if unlimited
        if credit_limit == -1:
            return (True, current_used, -1, "Unlimited credits")

        remaining = credit_limit - current_used
        if remaining < credits_needed:
            return (
                False,
                current_used,
                credit_limit,
                f"AI credit limit reached ({current_used}/{credit_limit}). This query costs {credits_needed} credits but you only have {remaining} remaining. Please upgrade your plan.",
            )

        return (True, current_used, credit_limit, f"{remaining} credits remaining")

    except Exception as e:
        logger.error(f"Error checking AI credit limit for org {organization_id}: {e}")
        # Fail open
        return (True, 0, 0, "Credit check unavailable")


async def track_ai_credits(
    organization_id: str,
    credits_used: int,
    db: AsyncSession,
    user_id: Optional[str] = None,
) -> Tuple[bool, str]:
    """
    Track AI credit usage and check if within limit.
    
    Returns:
        (success: bool, message: str)
    """
    try:
        if credits_used == 0:
            return (True, "No credit change")

        # Get plan limits (active/trialing/canceled-in-period first, fall back to free plan)
        stmt = (
            select(SubscriptionPlan.slug, SubscriptionPlan.limits)
            .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(
                and_(
                    OrganizationSubscription.organization_id == organization_id,
                    _active_subscription_filter()
                )
            )
        )
        
        result = await db.execute(stmt)
        row = result.first()
        
        if not row:
            plan_slug = "free"
            # No active subscription — use free plan limits
            limits = _get_free_plan_limits()
        else:
            plan_slug, limits = row
            plan_slug = str(plan_slug or "free").lower()
            limits = _normalized_plan_limits(plan_slug, limits)

        if plan_slug == "free":
            limits = _normalized_plan_limits(plan_slug, limits)
        
        credit_limit = limits.get('ai_credits_limit', 0)
        
        # Get current usage
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if period_start.month == 12:
            period_end = period_start.replace(year=period_start.year + 1, month=1)
        else:
            period_end = period_start.replace(month=period_start.month + 1)
        
        stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == organization_id,
                OrganizationUsage.metric == 'ai_credits',
                OrganizationUsage.period_start == period_start
            )
        )
        
        result = await db.execute(stmt)
        usage = result.scalar_one_or_none()
        
        current_usage = usage.used if usage else 0

        user_usage = None
        user_metric = None
        user_current_usage = 0
        user_credit_limit = -1

        if plan_slug == 'team' and user_id:
            user_metric_keys = await _user_metric_keys(user_id, db)
            user_metric = user_metric_keys[0] if user_metric_keys else None
            user_credit_limit = _team_per_user_ai_credit_limit(limits)
            user_current_usage = 0
            if user_metric_keys:
                user_sum_stmt = select(func.coalesce(func.sum(OrganizationUsage.used), 0)).where(
                    and_(
                        OrganizationUsage.organization_id == organization_id,
                        OrganizationUsage.metric.in_(user_metric_keys),
                        OrganizationUsage.period_start == period_start,
                    )
                )
                user_sum_result = await db.execute(user_sum_stmt)
                user_current_usage = int(user_sum_result.scalar_one_or_none() or 0)
            if user_metric:
                user_stmt = select(OrganizationUsage).where(
                    and_(
                        OrganizationUsage.organization_id == organization_id,
                        OrganizationUsage.metric == user_metric,
                        OrganizationUsage.period_start == period_start,
                    )
                )
                user_result = await db.execute(user_stmt)
                user_usage = user_result.scalar_one_or_none()
        
        # Check if adding credits would exceed limit (-1 = unlimited)
        if credits_used > 0 and credit_limit != -1 and (current_usage + credits_used) > credit_limit:
            return (False, f"AI credit limit exceeded ({current_usage}/{credit_limit}). Upgrade for more credits.")

        if (
            credits_used > 0
            and user_metric
            and user_credit_limit != -1
            and (user_current_usage + credits_used) > user_credit_limit
        ):
            return (
                False,
                f"Your Team AI credit limit exceeded ({user_current_usage}/{user_credit_limit}). Each Team seat has 1000 credits/month.",
            )

        # Increment/decrement usage (refunds use negative credits)
        if usage:
            usage.used = max(0, usage.used + credits_used)
        else:
            usage = OrganizationUsage(
                organization_id=organization_id,
                metric='ai_credits',
                used=max(0, credits_used),
                period_start=period_start,
                period_end=period_end
            )
            db.add(usage)

        if user_metric:
            if user_usage:
                user_usage.used = max(0, user_usage.used + credits_used)
            else:
                user_usage = OrganizationUsage(
                    organization_id=organization_id,
                    metric=user_metric,
                    used=max(0, credits_used),
                    period_start=period_start,
                    period_end=period_end,
                )
                db.add(user_usage)
        
        await db.commit()
        
        updated = max(0, current_usage + credits_used)
        updated_user = max(0, user_current_usage + credits_used)
        action = "Used" if credits_used > 0 else "Refunded"
        if user_metric:
            return (
                True,
                f"{action} {abs(credits_used)} credits (team: {updated}/{credit_limit if credit_limit != -1 else '∞'}, you: {updated_user}/{user_credit_limit if user_credit_limit != -1 else '∞'})",
            )
        return (True, f"{action} {abs(credits_used)} credits ({updated}/{credit_limit if credit_limit != -1 else '∞'})")
        
    except Exception as e:
        logger.error(f"Error tracking AI credits for org {organization_id}: {e}")
        await db.rollback()
        return (False, "Error tracking usage")


async def track_ai_credits_idempotent(
    organization_id: str,
    credits_used: int,
    idempotency_key: str,
    db: AsyncSession,
    user_id: Optional[str] = None,
) -> Tuple[bool, bool, str]:
    """
    Idempotent AI credit tracking.

    Returns:
        (success, charged_now, message)
        - charged_now=False means this key was already charged before (safe duplicate).
    """
    try:
        if not idempotency_key:
            ok, msg = await track_ai_credits(
                organization_id=organization_id,
                credits_used=credits_used,
                db=db,
                user_id=user_id,
            )
            return ok, ok, msg

        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        period_end = (
            period_start.replace(year=period_start.year + 1, month=1)
            if period_start.month == 12
            else period_start.replace(month=period_start.month + 1)
        )
        marker_metric = f"ai_credit_charge:{idempotency_key}"

        # Fast path: already charged for this idempotency key in this period.
        marker_stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == organization_id,
                OrganizationUsage.metric == marker_metric,
                OrganizationUsage.period_start == period_start,
            )
        )
        marker_result = await db.execute(marker_stmt)
        if marker_result.scalar_one_or_none():
            return True, False, "Duplicate charge prevented by idempotency key"

        # Charge credits (same logic as track_ai_credits but in this transaction).
        ok, msg = await track_ai_credits(
            organization_id=organization_id,
            credits_used=credits_used,
            db=db,
            user_id=user_id,
        )
        if not ok:
            return False, False, msg

        # Persist charge marker. Unique(org, metric, period_start) prevents races.
        marker_row = OrganizationUsage(
            organization_id=organization_id,
            metric=marker_metric,
            used=1,
            period_start=period_start,
            period_end=period_end,
        )
        db.add(marker_row)
        await db.commit()
        return True, True, "Credits charged with idempotency marker"
    except IntegrityError:
        # Another concurrent worker already created marker for same key.
        await db.rollback()
        return True, False, "Duplicate charge prevented by concurrent idempotency marker"
    except Exception as e:
        logger.error(f"Error in idempotent AI credit tracking for org {organization_id}: {e}")
        await db.rollback()
        return False, False, "Error tracking usage"


async def record_ai_usage_log(
    organization_id: str,
    user_id: Optional[str],
    model: Optional[str],
    analysis_mode: Optional[str],
    prompt_tokens: int,
    completion_tokens: int,
    total_tokens: int,
    dataset_size_mb: float,
    credits_used: int,
    db: AsyncSession,
    request_id: Optional[str] = None,
    estimated_credits: Optional[int] = None,
    real_cost_usd: Optional[object] = None,
    latency_ms: Optional[int] = None,
    project_id: Optional[str] = None,
    data_source_id: Optional[str] = None,
    provider: Optional[str] = None,
) -> None:
    """Persist one request-level AI usage summary for billing analytics and dashboards."""
    from src.modules.ai.observability.request_context import normalize_model_for_storage
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    model = normalize_model_for_storage(model)

    cost_str: Optional[str] = None
    if real_cost_usd is not None:
        try:
            cost_str = str(real_cost_usd)
        except Exception:
            cost_str = None

    project_uuid = None
    if project_id:
        try:
            import uuid

            project_uuid = uuid.UUID(str(project_id))
        except Exception:
            project_uuid = None

    req_id = str(request_id) if request_id else None
    if not req_id:
        # Request summary must always be keyed by request_id.
        return

    attempt_count = 1
    try:
        attempts_stmt = select(func.count()).select_from(LlmAuditLog).where(LlmAuditLog.request_id == req_id)
        attempts_result = await db.execute(attempts_stmt)
        attempt_count = int(attempts_result.scalar_one() or 1)
    except Exception:
        attempt_count = 1

    final_status = "success" if int(total_tokens or 0) > 0 else "failed"

    values = {
        "request_id": req_id,
        "organization_id": str(organization_id),
        "user_id": str(user_id) if user_id else None,
        "project_id": project_uuid,
        "data_source_id": data_source_id,
        "total_prompt_tokens": int(prompt_tokens or 0),
        "total_completion_tokens": int(completion_tokens or 0),
        "total_tokens": int(total_tokens or 0),
        "dataset_size_mb": float(dataset_size_mb or 0.0),
        "estimated_credits": int(estimated_credits) if estimated_credits is not None else None,
        "credits_used": int(credits_used or 0),
        "real_cost_usd": cost_str,
        "final_status": final_status,
        "total_attempts": max(1, attempt_count),
    }

    insert_stmt = pg_insert(LlmRequestSummary).values(**values)
    upsert_stmt = insert_stmt.on_conflict_do_update(
        index_elements=[LlmRequestSummary.request_id],
        set_={
            "organization_id": insert_stmt.excluded.organization_id,
            "user_id": insert_stmt.excluded.user_id,
            "project_id": insert_stmt.excluded.project_id,
            "data_source_id": insert_stmt.excluded.data_source_id,
            "total_prompt_tokens": insert_stmt.excluded.total_prompt_tokens,
            "total_completion_tokens": insert_stmt.excluded.total_completion_tokens,
            "total_tokens": insert_stmt.excluded.total_tokens,
            "dataset_size_mb": insert_stmt.excluded.dataset_size_mb,
            "estimated_credits": insert_stmt.excluded.estimated_credits,
            "credits_used": insert_stmt.excluded.credits_used,
            "real_cost_usd": insert_stmt.excluded.real_cost_usd,
            "final_status": insert_stmt.excluded.final_status,
            "total_attempts": insert_stmt.excluded.total_attempts,
        },
    )
    await db.execute(upsert_stmt)


async def track_api_call(
    organization_id: str,
    db: AsyncSession
) -> Tuple[bool, str]:
    """
    Track API call usage and check if within limit.
    
    Returns:
        (success: bool, message: str)
    """
    try:
        # Get plan limits (active/trialing/canceled-in-period first, fall back to free plan)
        stmt = (
            select(SubscriptionPlan.limits)
            .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(
                and_(
                    OrganizationSubscription.organization_id == organization_id,
                    _active_subscription_filter()
                )
            )
        )
        
        result = await db.execute(stmt)
        limits = result.scalar_one_or_none()
        
        if not limits:
            # No active subscription — use free plan limits
            limits = _get_free_plan_limits()
        
        api_limit = limits.get('api_calls_per_month', 0)
        
        # Get current usage
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == organization_id,
                OrganizationUsage.metric == 'api_calls',
                OrganizationUsage.period_start == period_start
            )
        )
        
        result = await db.execute(stmt)
        usage = result.scalar_one_or_none()
        
        current_usage = usage.used if usage else 0
        
        # Check if adding call would exceed limit (-1 = unlimited)
        if api_limit != -1 and (current_usage + 1) > api_limit:
            return (False, f"API call limit exceeded ({current_usage}/{api_limit}). Upgrade for more API calls.")
        
        # Increment usage
        if usage:
            usage.used += 1
        else:
            # Calculate period end
            if period_start.month == 12:
                period_end = period_start.replace(year=period_start.year + 1, month=1)
            else:
                period_end = period_start.replace(month=period_start.month + 1)
            
            usage = OrganizationUsage(
                organization_id=organization_id,
                metric='api_calls',
                used=1,
                period_start=period_start,
                period_end=period_end
            )
            db.add(usage)
        
        await db.commit()
        
        return (True, f"API call tracked ({current_usage + 1}/{api_limit if api_limit != -1 else '∞'})")
        
    except Exception as e:
        logger.error(f"Error tracking API call for org {organization_id}: {e}")
        await db.rollback()
        return (False, "Error tracking usage")


async def get_usage_summary(
    organization_id: str,
    db: AsyncSession,
    user_id: Optional[str] = None,
) -> dict:
    """
    Get usage summary for an organization.
    
    Returns:
        {
            "ai_credits": {"used": 450, "limit": 900, "percentage": 50},
            "api_calls": {"used": 5000, "limit": 10000, "percentage": 50},
            ...
        }
    """
    try:
        # Get plan limits (active/trialing/canceled-in-period first, fall back to free plan)
        stmt = (
            select(SubscriptionPlan.limits, SubscriptionPlan.slug)
            .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(
                and_(
                    OrganizationSubscription.organization_id == organization_id,
                    _active_subscription_filter()
                )
            )
        )
        
        result = await db.execute(stmt)
        row = result.first()
        
        if not row:
            # No active subscription — use free plan limits
            limits = _get_free_plan_limits()
            plan_slug = 'free'
        else:
            limits, plan_slug = row
            plan_slug = str(plan_slug or 'free').lower()

        limits = _normalized_plan_limits(plan_slug, limits)
        
        # Get current period usage
        now = datetime.now(timezone.utc)
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        
        stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == organization_id,
                OrganizationUsage.period_start == period_start
            )
        )
        
        result = await db.execute(stmt)
        usage_records = result.scalars().all()
        
        # Build summary
        summary = {
            "plan": plan_slug,
            "period_start": period_start.isoformat(),
        }
        
        # Resolve user UUID candidates for user-scoped metrics.
        user_uuid_candidates = await _resolve_user_uuid_candidates(user_id, db)

        # ── Live counts from actual tables ──────────────────────────────
        # Projects: count active, non-deleted projects for the organization
        projects_stmt = select(func.count()).select_from(Project).where(
            and_(
                Project.organization_id == organization_id,
                Project.is_active == True,
                Project.is_deleted == False,
            )
        )
        projects_result = await db.execute(projects_stmt)
        live_projects_count = projects_result.scalar() or 0

        # Data sources: count active NON-sample data sources across all org projects
        data_sources_stmt = (
            select(func.count())
            .select_from(DataSource)
            .join(Project, DataSource.project_id == Project.id)
            .where(
                and_(
                    Project.organization_id == organization_id,
                    Project.is_active == True,
                    Project.is_deleted == False,
                    DataSource.is_active == True,
                    DataSource.type.notin_(SAMPLE_DATA_SOURCE_TYPES),
                )
            )
        )
        ds_result = await db.execute(data_sources_stmt)
        live_data_sources_count = ds_result.scalar() or 0

        # Storage: sum file sizes (bytes) across active NON-sample data sources
        storage_stmt = (
            select(func.coalesce(func.sum(DataSource.size), 0))
            .select_from(DataSource)
            .join(Project, DataSource.project_id == Project.id)
            .where(
                and_(
                    Project.organization_id == organization_id,
                    Project.is_active == True,
                    Project.is_deleted == False,
                    DataSource.is_active == True,
                    DataSource.type.notin_(SAMPLE_DATA_SOURCE_TYPES),
                )
            )
        )
        storage_result = await db.execute(storage_stmt)
        live_storage_bytes = storage_result.scalar() or 0

        # ── Period-based metrics from organization_usage table ──────────
        # (AI credits, API calls are incremental and tracked per-period)
        period_metric_map = {
            'ai_credits': 'ai_credits_limit',
            'api_calls': 'api_calls_per_month',
        }
        
        for metric, limit_key in period_metric_map.items():
            usage_record = next((u for u in usage_records if u.metric == metric), None)
            used = usage_record.used if usage_record else 0
            limit = limits.get(limit_key, 0)
            
            # Calculate percentage (handle unlimited)
            if limit == -1:
                percentage = 0
            elif limit == 0:
                percentage = 100 if used > 0 else 0
            else:
                percentage = min(100, int((used / limit) * 100))
            
            summary[metric] = {
                "used": used,
                "limit": limit,
                "percentage": percentage,
                "unlimited": limit == -1
            }

        # ── Live-counted metrics ────────────────────────────────────────
        # Storage
        storage_limit_gb = limits.get('storage_limit_gb', 0)
        storage_limit_bytes = storage_limit_gb * 1024 * 1024 * 1024 if storage_limit_gb > 0 else storage_limit_gb
        if storage_limit_bytes == -1:
            storage_pct = 0
        elif storage_limit_bytes == 0:
            storage_pct = 100 if live_storage_bytes > 0 else 0
        else:
            storage_pct = min(100, int((live_storage_bytes / storage_limit_bytes) * 100))
        summary['storage_bytes'] = {
            "used": live_storage_bytes,
            "limit": storage_limit_bytes,
            "percentage": storage_pct,
            "unlimited": storage_limit_gb == -1
        }

        # Projects
        projects_limit = limits.get('max_projects', 0)
        if projects_limit == -1:
            projects_pct = 0
        elif projects_limit == 0:
            projects_pct = 100 if live_projects_count > 0 else 0
        else:
            projects_pct = min(100, int((live_projects_count / projects_limit) * 100))
        summary['projects_count'] = {
            "used": live_projects_count,
            "limit": projects_limit,
            "percentage": projects_pct,
            "unlimited": projects_limit == -1
        }

        # Data Sources
        ds_limit = limits.get('max_data_sources', 0)
        if ds_limit == -1:
            ds_pct = 0
        elif ds_limit == 0:
            ds_pct = 100 if live_data_sources_count > 0 else 0
        else:
            ds_pct = min(100, int((live_data_sources_count / ds_limit) * 100))
        summary['data_sources_count'] = {
            "used": live_data_sources_count,
            "limit": ds_limit,
            "percentage": ds_pct,
            "unlimited": ds_limit == -1
        }

        # ── Team/user-scoped AI credits and user ownership counts ───────
        if plan_slug == 'team' and user_id:
            team_ai_limit = limits.get('ai_credits_limit', 0)
            team_ai_usage = next((u for u in usage_records if u.metric == 'ai_credits'), None)
            team_ai_used = team_ai_usage.used if team_ai_usage else 0
            if team_ai_limit == -1:
                team_ai_pct = 0
            elif team_ai_limit == 0:
                team_ai_pct = 100 if team_ai_used > 0 else 0
            else:
                team_ai_pct = min(100, int((team_ai_used / team_ai_limit) * 100))

            summary['ai_credits_team_total'] = {
                "used": team_ai_used,
                "limit": team_ai_limit,
                "percentage": team_ai_pct,
                "unlimited": team_ai_limit == -1,
            }

            per_user_limit = _team_per_user_ai_credit_limit(limits)
            user_metric_keys = await _user_metric_keys(user_id, db)
            user_ai_used = sum(u.used for u in usage_records if u.metric in set(user_metric_keys)) if user_metric_keys else 0
            user_ai_pct = min(100, int((user_ai_used / per_user_limit) * 100)) if per_user_limit > 0 else 0
            summary['ai_credits_user'] = {
                "used": user_ai_used,
                "limit": per_user_limit,
                "percentage": user_ai_pct,
                "unlimited": False,
            }

        if user_uuid_candidates:
            my_projects_stmt = (
                select(func.count(func.distinct(UserRole.project_id)))
                .select_from(UserRole)
                .join(Role, Role.id == UserRole.role_id)
                .join(Project, Project.id == UserRole.project_id)
                .where(
                    and_(
                        UserRole.organization_id == organization_id,
                        UserRole.user_id.in_(user_uuid_candidates),
                        UserRole.assigned_by.in_(user_uuid_candidates),
                        UserRole.project_id != None,
                        UserRole.is_active == True,
                        UserRole.is_deleted == False,
                        Role.name == 'project_owner',
                        Role.is_active == True,
                        Role.is_deleted == False,
                        Project.organization_id == organization_id,
                        Project.is_active == True,
                        Project.is_deleted == False,
                    )
                )
            )
            my_projects_result = await db.execute(my_projects_stmt)
            my_projects_count = my_projects_result.scalar() or 0

            my_data_sources_stmt = (
                select(func.count())
                .select_from(DataSource)
                .join(Project, DataSource.project_id == Project.id)
                .where(
                    and_(
                        Project.organization_id == organization_id,
                        DataSource.is_active == True,
                        DataSource.user_id.in_(user_uuid_candidates),
                        DataSource.type.notin_(SAMPLE_DATA_SOURCE_TYPES),
                        Project.is_active == True,
                        Project.is_deleted == False,
                    )
                )
            )
            my_data_sources_result = await db.execute(my_data_sources_stmt)
            my_data_sources_count = my_data_sources_result.scalar() or 0
        else:
            my_projects_count = 0
            my_data_sources_count = 0

        if projects_limit == -1:
            my_projects_pct = 0
        elif projects_limit == 0:
            my_projects_pct = 100 if my_projects_count > 0 else 0
        else:
            my_projects_pct = min(100, int((my_projects_count / projects_limit) * 100))
        summary['my_projects_count'] = {
            "used": my_projects_count,
            "limit": projects_limit,
            "percentage": my_projects_pct,
            "unlimited": projects_limit == -1,
        }

        if ds_limit == -1:
            my_data_sources_pct = 0
        elif ds_limit == 0:
            my_data_sources_pct = 100 if my_data_sources_count > 0 else 0
        else:
            my_data_sources_pct = min(100, int((my_data_sources_count / ds_limit) * 100))
        summary['my_data_sources_count'] = {
            "used": my_data_sources_count,
            "limit": ds_limit,
            "percentage": my_data_sources_pct,
            "unlimited": ds_limit == -1,
        }
        
        return summary
        
    except Exception as e:
        error_details = traceback.format_exc()
        logger.error(f"Error getting usage summary for org {organization_id}:\n{error_details}")
        
        # In a real system, we'd only return details in dev/debug mode, 
        # but here we'll return them to help the user diagnose the problem.
        return {
            "success": False,
            "error": str(e),
            "debug_trace": error_details.split('\n')[-2] if error_details else "Unknown error"
        }


async def enforce_project_limit(organization_id: str) -> None:
    """
    Check project count against the plan limit for the organization.
    Raises HTTPException(403) with structured detail if the limit is reached.
    """
    from fastapi import HTTPException, status as http_status
    from src.db.session import async_session as _async_session

    try:
        async with _async_session() as db:
            # Count active, non-deleted projects
            proj_count_stmt = (
                select(func.count())
                .select_from(Project)
                .where(
                    and_(
                        Project.organization_id == organization_id,
                        Project.is_active == True,
                        Project.is_deleted == False,
                    )
                )
            )
            result = await db.execute(proj_count_stmt)
            current_count = result.scalar() or 0

            # Get plan limits
            max_projects = PLAN_CONFIGS['free']['max_projects']  # default to free
            now = datetime.now(timezone.utc)
            plan_stmt = (
                select(SubscriptionPlan.limits)
                .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
                .where(
                    and_(
                        OrganizationSubscription.organization_id == organization_id,
                        _active_subscription_filter(),
                    )
                )
            )
            result = await db.execute(plan_stmt)
            limits = result.scalar_one_or_none()
            if limits:
                max_projects = limits.get('max_projects', max_projects)

            # Check limit (-1 = unlimited)
            if max_projects != -1 and current_count >= max_projects:
                logger.warning(
                    f"Project limit reached for org {organization_id}: {current_count}/{max_projects}"
                )
                raise HTTPException(
                    status_code=http_status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "project_limit_reached",
                        "message": f"Project limit reached ({current_count}/{max_projects}). Please upgrade your plan to create more projects.",
                        "current": current_count,
                        "limit": max_projects,
                    }
                )

            logger.info(f"Project limit check passed: {current_count}/{max_projects} for org {organization_id}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking project limit for org {organization_id}: {e}")
