"""One place that decides whether an organization may start its free trial, and grants it.

Rules (onboarding and the plan modal both call this, so they can't drift apart):
  * Only Pro or Team, and only when the user opted in.
  * Once per organization, ever: `trial_used_at` is stamped on grant and never cleared.
    When the trial ends, trial_jobs.revert_expired_trials puts the org on Free.
  * Never over a plan the organization actually has: an active/trialing/past-due paid
    subscription, or a canceled one still inside its paid period, is left untouched.
  * The Stripe customer id is kept, so a later checkout reuses the same customer.

Plain SQL on `organization_subscriptions` keeps this importable from CE onboarding.
"""

from __future__ import annotations

import logging
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


async def grant_trial_once(db: Any, organization_id: Any, plan_slug: str) -> Dict[str, Any]:
    """Grant a one-time trial if allowed. Caller commits. Returns {"outcome", ...}."""
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
            SELECT s.status, s.trial_used_at, s.ends_at, p.slug AS plan_slug
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
        ends_at = current["ends_at"]
        if ends_at is not None and ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=timezone.utc)
        in_effect = current["status"] in ("active", "trialing", "past_due") or (
            current["status"] == "canceled" and ends_at is not None and ends_at > now
        )
        if paid and in_effect:
            return {"outcome": HAS_PAID_PLAN, "plan_slug": current["plan_slug"]}

    trial_ends = now + timedelta(days=TRIAL_DAYS)
    params = {"org": organization_id, "plan": plan.id, "ends": trial_ends, "now": now}
    if current:
        await db.execute(
            text("""
                UPDATE organization_subscriptions
                SET plan_id = :plan, status = 'trialing', trial_ends_at = :ends, trial_used_at = :now,
                    trial_expiring_soon = false, provider = 'internal', provider_subscription_id = NULL
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
