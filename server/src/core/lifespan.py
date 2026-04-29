"""Application lifespan — startup checks and shutdown cleanup."""
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from src.core.cache import cache
from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)


def _check_predictive_deps() -> dict:
    """Check availability of prophet, pmdarima, statsmodels."""
    out = {}
    for name in ("prophet", "pmdarima", "statsmodels"):
        try:
            __import__(name)
            out[name] = True
        except ImportError:
            out[name] = False
    return out


def _check_ai_capabilities() -> dict:
    """Lightweight check of AI-related capabilities for /health endpoint."""
    caps = {}
    try:
        from ee.modules.data.services.semantic_schema_service import SemanticSchemaService  # noqa: F401
        caps["semantic_schema"] = True
    except ImportError:
        caps["semantic_schema"] = False
    return caps


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """FastAPI lifespan context manager: runs startup, yields, then runs shutdown."""
    # ── Startup ──────────────────────────────────────────────────────────────
    try:
        # Check predictive analytics dependencies
        predictive_ok = _check_predictive_deps()
        missing = [k for k, v in predictive_ok.items() if not v]
        if missing:
            logger.error(
                "Predictive analytics deps missing: %s. "
                "Install with: pip install prophet pmdarima statsmodels.",
                missing,
            )
        else:
            logger.info("Predictive stack OK: prophet, pmdarima, statsmodels")

        # Register models with SQLAlchemy metadata (required for Alembic autogenerate)
        try:
            from src.modules.chats.models import Conversation, Message  # noqa: F401
            from src.modules.data.models import DataSource, FileStorage  # noqa: F401
            from src.modules.knowledge.models import KnowledgeDocument, DocumentChunk  # noqa: F401
            from src.modules.dashboards.models import Dashboard  # noqa: F401
            from src.modules.charts.models import ChatVisualization, DashboardEmbed  # noqa: F401
            logger.info("All database models imported successfully")
        except Exception as e:
            logger.warning("Failed to import some models: %s", e)

        # Enqueue initial retention cleanup via ARQ; fall back to asyncio loop
        try:
            from src.shared.jobs.client import enqueue_job
            job_id = await enqueue_job("run_data_retention_cleanup")
            if job_id:
                logger.info("Queued initial retention cleanup job: %s", job_id)
            else:
                logger.info("ARQ unavailable; starting asyncio fallback for retention cleanup")
                from src.shared.tasks.background import schedule_retention_cleanup
                asyncio.create_task(schedule_retention_cleanup())
        except Exception as e:
            logger.warning("Failed to start retention cleanup: %s", e)

        if is_ee_enabled():
            # Trial lifecycle jobs (EE)
            try:
                from src.shared.tasks.trial_jobs import revert_expired_trials, notify_expiring_trials
                asyncio.create_task(revert_expired_trials())
                asyncio.create_task(notify_expiring_trials())
                logger.info("Trial lifecycle background jobs started")
            except Exception as e:
                logger.warning("Failed to start trial jobs: %s", e)

            # Scheduled email dispatcher (EE)
            try:
                from src.shared.tasks.background import schedule_email_dispatcher
                asyncio.create_task(schedule_email_dispatcher())
                logger.info("Background scheduled-email dispatcher started")
            except Exception as e:
                logger.warning("Failed to start scheduled-email dispatcher: %s", e)

            # Telegram bot (EE)
            try:
                from src.modules.telegram.bot import setup_bot
                await setup_bot()
                logger.info("Telegram bot initialized")
            except Exception as e:
                logger.warning("Failed to initialize Telegram bot: %s", e)

        logger.info(
            "Startup complete. To seed initial data run: python -m app.scripts.seed"
        )

    except Exception as e:
        logger.error("Error during startup: %s", e)

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("Performing cleanup before shutdown...")
    try:
        from src.db.session import async_engine
        await async_engine.dispose()
        logger.info("Database connection pool disposed")
    except Exception as e:
        logger.warning("Error disposing DB engine: %s", e)

    try:
        if getattr(cache, "redis_client", None):
            cache.redis_client.close()
            logger.info("Redis connection closed")
    except Exception as e:
        logger.warning("Error closing Redis: %s", e)

    if is_ee_enabled():
        try:
            from src.modules.telegram.bot import shutdown_bot
            await shutdown_bot()
            logger.info("Telegram bot shutdown successfully")
        except Exception as e:
            logger.warning("Error shutting down Telegram bot: %s", e)
