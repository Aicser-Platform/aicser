import logging
from typing import Optional

from src.core.config import settings
from src.db.session import get_async_session

logger = logging.getLogger(__name__)


async def run_periodic_snapshot_cleanup(retention_days: int = None, organization_id: Optional[str] = None):
    """Run snapshot cleanup once using an async DB session."""
    retention_days = retention_days or settings.CLOUD_STORAGE_RETENTION_DAYS or 30
    async for db in get_async_session():
        from src.modules.queries.router import perform_snapshot_cleanup
        deleted = await perform_snapshot_cleanup(db, retention_days=retention_days, organization_id=organization_id)
        return deleted


# APScheduler integration (optional): if the project uses APScheduler/Celery,
# a job can call run_periodic_snapshot_cleanup on a schedule (daily/weekly).


