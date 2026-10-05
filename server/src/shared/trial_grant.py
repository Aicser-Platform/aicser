"""One place that decides whether an organization may start its free trial, and grants it.

Rules (onboarding and the plan modal both call this, so they can't drift apart):
  * Only Pro or Team, and only when the user opted in.
  * Once per organization, ever: `trial_used_at` is stamped on grant and never cleared.
    When the trial ends, trial_jobs.revert_expired_trials puts the org on Free.
  * Once per user, too: a user who owns any organization that already used its trial
    can't start another by creating a new organization.
  * Never over a plan the organization actually has: an active/trialing/past-due paid
    subscription, or a canceled one still inside its paid period, is left untouched.
  * The Stripe customer id is kept, so a later checkout reuses the same customer.

Plain SQL on `organization_subscriptions` keeps this importable from CE onboarding.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict

from sqlalchemy import text

logger = logging.getLogger(__name__)

TRIAL_DAYS = 14
TRIAL_PLANS = ("pro", "team")

# Outcomes
GRANTED = "granted"
ALREADY_USED = "already_used"
HAS_PAID_PLAN = "has_paid_plan"
NOT_AVAILABLE = "not_available"


async def user_has_used_trial(db: Any, user_id: Any, exclude_organization_id: Any = None) -> bool:
    """True when the user owns an organization (other than the excluded one) whose trial was used."""
    if not user_id:
        return False
    try:
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        return False
    row = (await db.execute(
        text("""
            SELECT 1
            FROM organization_subscriptions s
            JOIN user_roles ur ON ur.organization_id = s.organization_id
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = :user
              AND r.name = 'org_owner'
              AND s.trial_used_at IS NOT NULL
              AND (CAST(:exclude AS uuid) IS NULL OR s.organization_id <> CAST(:exclude AS uuid))
            LIMIT 1
        """),
        {"user": user_uuid, "exclude": str(exclude_organization_id) if exclude_organization_id else None},
    )).fetchone()
    return row is not None


def _in_effect(status: Any, ends_at: Any, provider: Any, now: datetime) -> bool:
    """Whether a paid subscription row still grants its plan."""
    if ends_at is not None and ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    ended = ends_at is not None and ends_at <= now
    if status == "canceled":
        return ends_at is not None and not ended
    if provider == "khqr" and ended:
        # Prepaid KHQR periods never renew, so a past ends_at means it lapsed. (A Stripe
        # row with a past ends_at may just be awaiting its renewal webhook.)
        return False
    return status in ("active", "trialing", "past_due")


async def grant_trial_once(
    db: Any, organization_id: Any, plan_slug: str, user_id: Any = None
) -> Dict[str, Any]:
    """Grant a one-time trial if allowed. Caller commits. Returns {"outcome", ...}.

    Pass user_id to also enforce the once-per-user rule.
    """
    if plan_slug not in TRIAL_PLANS or not organization_id:
        return {"outcome": NOT_AVAILABLE}

    plan = (await db.execute(
        text("SELECT id FROM subscription_plans WHERE slug = :slug LIMIT 1"), {"slug": plan_slug}
    )).fetchone()
    if not plan:
        logger.warning("grant_trial_once: plan %r not configured", plan_slug)
        return {"outcome": NOT_AVAILABLE}

    current = (await db.execute(
        text("""
            SELECT s.status, s.trial_used_at, s.ends_at, s.provider, p.slug AS plan_slug
            FROM organization_subscriptions s
            LEFT JOIN subscription_plans p ON p.id = s.plan_id
            WHERE s.organization_id = :org
            FOR UPDATE OF s
        """),
        {"org": organization_id},
    )).mappings().first()

    now = datetime.now(timezone.utc)
    if current:
        if current["trial_used_at"] is not None:
            return {"outcome": ALREADY_USED, "trial_used_at": current["trial_used_at"]}
        paid = (current["plan_slug"] or "free") != "free"
        if paid and _in_effect(current["status"], current["ends_at"], current.get("provider"), now):
            return {"outcome": HAS_PAID_PLAN, "plan_slug": current["plan_slug"]}

    if user_id and await user_has_used_trial(db, user_id, exclude_organization_id=organization_id):
        return {"outcome": ALREADY_USED, "reason": "user_already_used"}

    trial_ends = now + timedelta(days=TRIAL_DAYS)
    params = {"org": organization_id, "plan": plan.id, "ends": trial_ends, "now": now}
    if current:
        # ends_at belongs to the previous subscription: left in place, a past value makes
        # the feature gate (_subscription_inactive) treat the new trial as ended.
        await db.execute(
            text("""
                UPDATE organization_subscriptions
                SET plan_id = :plan, status = 'trialing', trial_ends_at = :ends, trial_used_at = :now,
                    trial_expiring_soon = false, provider = 'internal', provider_subscription_id = NULL,
                    ends_at = NULL
                WHERE organization_id = :org
            """),
            params,
        )
    else:
        await db.execute(
            text("""
                INSERT INTO organization_subscriptions
                    (organization_id, plan_id, status, trial_ends_at, trial_used_at, trial_expiring_soon, provider)
                VALUES (:org, :plan, 'trialing', :ends, :now, false, 'internal')
            """),
            params,
        )
    logger.info("Granted one-time %s trial to org %s until %s", plan_slug, organization_id, trial_ends.isoformat())
    return {"outcome": GRANTED, "plan_slug": plan_slug, "trial_ends_at": trial_ends}
