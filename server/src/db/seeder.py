"""Database seeders — idempotent, safe to run multiple times.

Run via CLI: python -m app.scripts.seed
These do NOT run automatically on server startup.
"""
import logging
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

logger = logging.getLogger(__name__)


async def seed_subscription_plans(session: AsyncSession) -> int:
    """Insert default subscription plans if the table is empty. Returns count inserted."""
    from src.modules.billing.models import SubscriptionPlan
    from src.modules.pricing.plans import PLAN_CONFIGS

    count_result = await session.execute(
        select(func.count()).select_from(SubscriptionPlan)
    )
    plan_count = count_result.scalar() or 0
    if plan_count > 0:
        logger.info("Subscription plans already seeded (%s plans)", plan_count)
        return 0

    inserted = 0
    for slug, config in PLAN_CONFIGS.items():
        limits = {
            "ai_credits_limit": config.get("ai_credits_limit"),
            "ai_credits_per_user_limit": config.get("ai_credits_per_user_limit"),
            "max_projects": config.get("max_projects"),
            "max_users": config.get("max_users"),
            "max_data_sources": config.get("max_data_sources"),
            "storage_limit_gb": config.get("storage_limit_gb"),
            "data_history_days": config.get("data_history_days"),
            "api_calls_per_month": config.get("api_calls_per_month"),
            "included_seats": config.get("included_seats"),
            "additional_seat_price": config.get("additional_seat_price"),
            "min_seats": config.get("min_seats"),
            "price_per_seat": config.get("price_per_seat"),
        }
        plan = SubscriptionPlan(
            name=config["name"],
            slug=slug,
            description=config.get("description", ""),
            limits=limits,
            features=config.get("features", {}),
        )
        session.add(plan)
        inserted += 1

    await session.commit()
    logger.info("Seeded %s subscription plans", inserted)
    return inserted


async def seed_organization_subscriptions(session: AsyncSession) -> int:
    """Assign the free plan to any organization that has no subscription. Returns count inserted."""
    from src.modules.billing.models import OrganizationSubscription, SubscriptionPlan
    from src.modules.organizations.models import Organization

    free_plan_result = await session.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.slug == "free")
    )
    free_plan = free_plan_result.scalar_one_or_none()
    if free_plan is None:
        logger.warning("Cannot seed org subscriptions: 'free' plan not found")
        return 0

    orgs_result = await session.execute(select(Organization))
    all_orgs = orgs_result.scalars().all()

    subscribed_result = await session.execute(
        select(OrganizationSubscription.organization_id)
    )
    subscribed_ids = set(subscribed_result.scalars().all())
    unsubscribed = [o for o in all_orgs if o.id not in subscribed_ids]

    if not unsubscribed:
        logger.info("All organizations already have a subscription")
        return 0

    for org in unsubscribed:
        session.add(OrganizationSubscription(
            organization_id=org.id,
            plan_id=free_plan.id,
            status="active",
            provider="internal",
            provider_metadata={"created_by": "seed_organization_subscriptions"},
        ))

    await session.commit()
    logger.info("Seeded free-plan subscriptions for %s organization(s)", len(unsubscribed))
    return len(unsubscribed)
