"""One place that decides whether an organization may start its free trial, and grants it.

Rules (onboarding and the plan modal both call this, so they can't drift apart):
  * Only Pro or Team, and only when the user opted in.
  * Once per organization, ever: `trial_used_at` is stamped on grant and never cleared.
    When the trial ends, trial_jobs.revert_expired_trials puts the org on Free.
  * Once per user, too: `users.trial_used_at` is stamped on grant and never cleared, so a
    user can't start another trial in a new (or someone else's) organization. Users from
    before that column are still caught by owning an organization that used its trial.
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
# A Stripe row past its period end may just be awaiting its renewal webhook; past this,
# the webhook isn't coming and the row no longer grants its plan.
STRIPE_RENEWAL_GRACE = timedelta(days=7)

# Outcomes
GRANTED = "granted"
ALREADY_USED = "already_used"
HAS_PAID_PLAN = "has_paid_plan"
NOT_AVAILABLE = "not_available"


# The token may carry users.id, users.user_id or the identity provider's id.
_USER_MATCH = "(u.id = :user OR u.user_id = :user OR u.provider_user_id = :user_str)"


async def user_has_used_trial(db: Any, user_id: Any, exclude_organization_id: Any = None) -> bool:
    """True when the user started a trial anywhere (users.trial_used_at), or owns an
    organization (other than the excluded one) whose trial was used."""
    if not user_id:
        return False
    try:
        user_uuid = uuid.UUID(str(user_id))
    except ValueError:
        return False
    row = (await db.execute(
        text(f"""
            SELECT 1 FROM users u
            WHERE {_USER_MATCH} AND u.trial_used_at IS NOT NULL
            UNION ALL
            SELECT 1
            FROM organization_subscriptions s
            JOIN user_roles ur ON ur.organization_id = s.organization_id
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id IN (
                    SELECT CAST(:user AS uuid)
                    UNION SELECT u.id FROM users u WHERE {_USER_MATCH}
                    UNION SELECT u.user_id FROM users u WHERE {_USER_MATCH} AND u.user_id IS NOT NULL
                  )
              AND r.name = 'org_owner'
              AND s.trial_used_at IS NOT NULL
              AND (CAST(:exclude AS uuid) IS NULL OR s.organization_id <> CAST(:exclude AS uuid))
            LIMIT 1
        """),
        {
            "user": user_uuid,
            "user_str": str(user_id),
            "exclude": str(exclude_organization_id) if exclude_organization_id else None,
        },
    )).fetchone()
    return row is not None


async def _claim_user_trial(db: Any, user_id: Any, now: datetime) -> bool:
    """Stamp users.trial_used_at if it is still empty. False when another request already
    claimed it: the conditional UPDATE re-checks after waiting on the row lock, so two
    concurrent trials for one user can't both pass. A user with no users row (shouldn't
    happen for an authenticated caller) isn't blocked; there is nothing to stamp."""
    params = {"user": uuid.UUID(str(user_id)), "user_str": str(user_id), "now": now}
    claimed = (await db.execute(
        text(f"""
            UPDATE users u SET trial_used_at = :now
            WHERE {_USER_MATCH} AND u.trial_used_at IS NULL
            RETURNING u.id
        """),
        params,
    )).fetchone()
    if claimed:
        return True
    exists = (await db.execute(
        text(f"SELECT 1 FROM users u WHERE {_USER_MATCH} LIMIT 1"), params
    )).fetchone()
    if not exists:
        logger.warning("grant_trial_once: no users row for %s; per-user trial not recorded", user_id)
        return True
    return False


def _in_effect(status: Any, ends_at: Any, provider: Any, now: datetime) -> bool:
    """Whether a paid subscription row still grants its plan.

    The single rule shared by the feature gate (feature_gate._subscription_inactive),
    GET /pricing/subscription and the trial grant, so billing never shows a plan the
    gate refuses (or the reverse). Trial expiry (trial_ends_at) is checked by callers.
    """
    if ends_at is not None and ends_at.tzinfo is None:
        ends_at = ends_at.replace(tzinfo=timezone.utc)
    ended = ends_at is not None and ends_at <= now
    if status == "canceled":
        return ends_at is not None and not ended
    if ended:
        # A Stripe row with a past ends_at may just be awaiting its renewal webhook, for a
        # while. Prepaid KHQR periods and internally assigned plans never renew.
        if provider != "stripe" or ends_at + STRIPE_RENEWAL_GRACE <= now:
            return False
    # past_due: Stripe is still retrying the payment, so the plan stays until it gives up
    # and the webhook cancels the subscription.
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

    if user_id:
        if await user_has_used_trial(db, user_id, exclude_organization_id=organization_id):
            return {"outcome": ALREADY_USED, "reason": "user_already_used"}
        # Claimed before the subscription is touched: callers commit even on a refusal.
        if not await _claim_user_trial(db, user_id, now):
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
                    period_starts_at = :now, ends_at = NULL
                WHERE organization_id = :org
            """),
            params,
        )
    else:
        await db.execute(
            text("""
                INSERT INTO organization_subscriptions
                    (organization_id, plan_id, status, trial_ends_at, trial_used_at, trial_expiring_soon,
                     provider, period_starts_at)
                VALUES (:org, :plan, 'trialing', :ends, :now, false, 'internal', :now)
            """),
            params,
        )
    logger.info("Granted one-time %s trial to org %s until %s", plan_slug, organization_id, trial_ends.isoformat())
    return {"outcome": GRANTED, "plan_slug": plan_slug, "trial_ends_at": trial_ends}
