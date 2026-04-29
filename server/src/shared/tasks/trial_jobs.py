"""
Trial lifecycle background jobs.

Two asyncio loops registered on startup:
  - revert_expired_trials: daily at ~00:05 UTC — flip expired trialing orgs back to free.
  - notify_expiring_trials: daily at ~09:00 UTC — set trial_expiring_soon=True for
    subscriptions whose trial ends within the next 23-25 hours.
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)


async def revert_expired_trials() -> None:
    """Background loop: daily at 00:05 UTC — revert expired in-app trials to free."""
    while True:
        now = datetime.now(timezone.utc)
        next_run = now.replace(hour=0, minute=5, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        sleep_seconds = (next_run - now).total_seconds()
        logger.info("revert_expired_trials: sleeping %.0fs until %s", sleep_seconds, next_run.isoformat())
        await asyncio.sleep(sleep_seconds)

        try:
            from src.db.session import async_session
            from sqlalchemy import text
            async with async_session() as session:
                # Find the free plan id
                free_plan_row = await session.execute(
                    text("SELECT id FROM subscription_plans WHERE slug = 'free' LIMIT 1")
                )
                free_plan = free_plan_row.fetchone()
                if not free_plan:
                    logger.warning("revert_expired_trials: 'free' plan not found — skipping")
                    continue

                # Revert all expired in-app trialing subscriptions (provider='internal')
                result = await session.execute(
                    text("""
                        UPDATE organization_subscriptions
                        SET plan_id              = :free_plan_id,
                            status               = 'active',
                            trial_ends_at        = NULL,
                            trial_expiring_soon  = false,
                            provider             = NULL
                        WHERE status = 'trialing'
                          AND provider = 'internal'
                          AND trial_ends_at IS NOT NULL
                          AND trial_ends_at <= NOW()
                        RETURNING organization_id
                    """),
                    {"free_plan_id": free_plan.id},
                )
                reverted = result.fetchall()
                await session.commit()
                if reverted:
                    logger.info(
                        "revert_expired_trials: reverted %d org(s) to free: %s",
                        len(reverted),
                        [str(r[0]) for r in reverted],
                    )
                else:
                    logger.info("revert_expired_trials: no expired in-app trials to revert")
        except Exception as exc:
            logger.error("revert_expired_trials: error — %s", exc, exc_info=True)


async def notify_expiring_trials() -> None:
    """Background loop: daily at 09:00 UTC — set trial_expiring_soon for orgs expiring in ~24h."""
    while True:
        now = datetime.now(timezone.utc)
        next_run = now.replace(hour=9, minute=0, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)
        sleep_seconds = (next_run - now).total_seconds()
        logger.info("notify_expiring_trials: sleeping %.0fs until %s", sleep_seconds, next_run.isoformat())
        await asyncio.sleep(sleep_seconds)

        try:
            from src.db.session import async_session
            from sqlalchemy import text
            async with async_session() as session:
                result = await session.execute(
                    text("""
                        UPDATE organization_subscriptions
                        SET trial_expiring_soon = true
                        WHERE status = 'trialing'
                          AND provider = 'internal'
                          AND trial_ends_at IS NOT NULL
                          AND trial_ends_at BETWEEN NOW() + INTERVAL '23 hours'
                                               AND NOW() + INTERVAL '25 hours'
                        RETURNING organization_id
                    """)
                )
                flagged = result.fetchall()
                await session.commit()
                if flagged:
                    logger.info(
                        "notify_expiring_trials: flagged %d org(s): %s",
                        len(flagged),
                        [str(r[0]) for r in flagged],
                    )
                else:
                    logger.info("notify_expiring_trials: no in-app trials expiring in ~24h")
        except Exception as exc:
            logger.error("notify_expiring_trials: error — %s", exc, exc_info=True)
