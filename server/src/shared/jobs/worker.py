"""
ARQ Worker settings for Aiser background jobs.

Run with: arq app.jobs.worker.WorkerSettings

ARQ uses Redis as its queue backend (same Redis instance used by the app).
"""
import os
import logging
from typing import Any

from src.shared.jobs.tasks import (
    run_data_retention_cleanup,
    run_data_quality_check,
    refresh_schema_cache,
    run_scheduled_report,
    run_bi_sync,
    evaluate_alert_rules,
)

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def startup(ctx: dict) -> None:
    logger.info("ARQ worker starting up")


async def shutdown(ctx: dict) -> None:
    logger.info("ARQ worker shutting down")


class WorkerSettings:
    """ARQ worker configuration."""
    functions = [
        run_data_retention_cleanup,
        run_data_quality_check,
        refresh_schema_cache,
        run_scheduled_report,
        run_bi_sync,
        evaluate_alert_rules,
    ]

    on_startup = startup
    on_shutdown = shutdown

    redis_settings_from_url = REDIS_URL
    max_jobs = 10
    job_timeout = 300  # 5 minutes max per job
    keep_result = 3600  # Keep results for 1 hour

    # Cron jobs
    cron_jobs = [
        # Run data retention cleanup every day at 2am UTC
        {
            "coroutine": run_data_retention_cleanup,
            "hour": 2,
            "minute": 0,
            "name": "daily_retention_cleanup",
        },
        # Evaluate alert rules every minute
        {
            "coroutine": evaluate_alert_rules,
            "minute": {0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
                       16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29,
                       30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
                       44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57,
                       58, 59},
            "name": "alert_rule_evaluation",
        },
    ]
