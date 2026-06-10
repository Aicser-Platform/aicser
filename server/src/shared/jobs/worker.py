"""
ARQ Worker settings for Aiser background jobs.

Run with: python -m arq src.shared.jobs.worker.WorkerSettings

ARQ uses Redis as its queue backend (same Redis instance used by the app).
"""
import os
import logging

from arq.cron import cron
from arq.connections import RedisSettings

from src.shared.jobs.tasks import (
    run_data_retention_cleanup,
    run_data_quality_check,
    refresh_schema_cache,
    run_scheduled_report,
    run_bi_sync,
    evaluate_alert_rules,
    refresh_artifact_data,
    sync_artifacts_after_schema_change,
)

try:
    from src.modules.ai.services.ai_job_service import process_ai_analyze_job

    _AI_JOB_FN = process_ai_analyze_job
except Exception:
    _AI_JOB_FN = None

from src.shared.observability.job_tracing import wrap_arq_functions

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
REDIS_SETTINGS = RedisSettings.from_dsn(REDIS_URL)


def get_redis_settings() -> RedisSettings:
    return REDIS_SETTINGS


_JOB_FUNCTIONS = [
    run_data_retention_cleanup,
    run_data_quality_check,
    refresh_schema_cache,
    run_scheduled_report,
    run_bi_sync,
    evaluate_alert_rules,
    refresh_artifact_data,           # on-demand + cron: re-execute widget queries
    sync_artifacts_after_schema_change,  # triggered when data source schema drifts
]
if _AI_JOB_FN is not None:
    _JOB_FUNCTIONS.append(_AI_JOB_FN)

_WRAPPED_FUNCTIONS = wrap_arq_functions(_JOB_FUNCTIONS)
_FUNCTIONS_BY_NAME = {fn.__name__: fn for fn in _WRAPPED_FUNCTIONS}


async def _write_heartbeat() -> None:
    """Write a Redis heartbeat key so the API health endpoint knows the worker is alive."""
    try:
        import redis as _redis
        _r = _redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        _r.setex("aiser:worker:heartbeat", 90, "1")  # TTL 90s; renewed every cron minute
        _r.close()
    except Exception as exc:
        logger.debug("worker heartbeat write failed: %s", exc)


async def startup(ctx: dict) -> None:
    from src.shared.observability.setup import setup_observability

    setup_observability(os.getenv("OTEL_SERVICE_NAME", "aiser-worker"))
    logger.info("ARQ worker starting up")
    await _write_heartbeat()


async def shutdown(ctx: dict) -> None:
    from src.shared.observability.setup import shutdown_observability

    shutdown_observability()
    logger.info("ARQ worker shutting down")


class WorkerSettings:
    """ARQ worker configuration."""
    functions = _WRAPPED_FUNCTIONS

    on_startup = startup
    on_shutdown = shutdown

    redis_settings = REDIS_SETTINGS
    max_jobs = 10
    job_timeout = 300  # 5 minutes max per job
    keep_result = 3600  # Keep results for 1 hour

    cron_jobs = [
        cron(
            _FUNCTIONS_BY_NAME["run_data_retention_cleanup"],
            hour=2,
            minute=0,
            name="daily_retention_cleanup",
        ),
        cron(
            _FUNCTIONS_BY_NAME["evaluate_alert_rules"],
            minute=set(range(60)),
            name="alert_rule_evaluation",
        ),
    ]
