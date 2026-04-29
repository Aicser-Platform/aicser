def test_background_tasks_importable():
    from src.shared.tasks.background import schedule_retention_cleanup, schedule_email_dispatcher
    import asyncio
    assert asyncio.iscoroutinefunction(schedule_retention_cleanup)
    assert asyncio.iscoroutinefunction(schedule_email_dispatcher)
