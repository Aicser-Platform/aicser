"""Background tasks that run as asyncio loops during server lifetime."""
import asyncio
import logging

logger = logging.getLogger(__name__)


async def schedule_retention_cleanup() -> None:
    """Run data retention cleanup daily. Sleeps 24h before each run."""
    from src.modules.data.services.data_retention_service import DataRetentionService
    from src.db.session import get_async_session

    while True:
        try:
            await asyncio.sleep(86400)  # 24 hours
            logger.info("Starting scheduled data retention cleanup...")
            async with get_async_session() as db:
                service = DataRetentionService(db)
                affected = await service.cleanup_expired_file_sources()
                logger.info("Retention cleanup completed: %s data sources affected", affected)
        except Exception as e:
            logger.error("Retention cleanup task failed: %s", e, exc_info=True)
            await asyncio.sleep(3600)  # retry in 1h on error


async def schedule_email_dispatcher() -> None:
    """Send due scheduled emails every 30 seconds."""
    from src.modules.schedule_email.service import process_due_scheduled_emails

    while True:
        try:
            processed = await process_due_scheduled_emails(batch_size=20)
            if processed > 0:
                logger.info("Scheduled-email dispatcher processed %s email job(s)", processed)
            await asyncio.sleep(30)
        except Exception as e:
            logger.error("Scheduled-email dispatcher failed: %s", e, exc_info=True)
            await asyncio.sleep(30)
