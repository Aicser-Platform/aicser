def test_seeder_importable():
    from src.db.seeder import seed_subscription_plans, seed_organization_subscriptions
    import asyncio
    assert asyncio.iscoroutinefunction(seed_subscription_plans)
    assert asyncio.iscoroutinefunction(seed_organization_subscriptions)
