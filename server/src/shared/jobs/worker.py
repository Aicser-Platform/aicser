"""
ARQ Worker settings for Aiser background jobs.

Run with: python -m arq src.shared.jobs.worker.WorkerSettings

ARQ uses Redis as its queue backend (same Redis instance used by the app).
"""
import logging
import os

from arq.connections import RedisSettings
from arq.cron import cron
from arq.worker import func as arq_func

# The worker process only imports task functions and their direct dependencies,
# unlike the FastAPI app, which incidentally imports every model by importing
# every router. Without this, SQLAlchemy configures mappers on first DB use
# with an incomplete model graph and raises NoReferencedTableError for any FK
# whose target model (e.g. Organization) nothing else in the worker imports.
import src.db.registry  # noqa: F401
from src.shared.jobs.tasks import (
    dispatch_due_pipelines_job,
    evaluate_alert_rules,
    ingest_staged_asset,
    profile_staged_asset,
    refresh_artifact_data,
    refresh_schema_cache,
    run_bi_sync,
    run_data_quality_check,
    run_data_retention_cleanup,
    run_pipeline,
    run_scheduled_report,
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

# Pipeline runs stream large tables; the global job_timeout (300s) is far too short.
PIPELINE_JOB_TIMEOUT = 3600


def get_redis_settings() -> RedisSettings:
    return REDIS_SETTINGS


_JOB_FUNCTIONS = [
    run_data_retention_cleanup,
    run_data_quality_check,
    refresh_schema_cache,
    run_scheduled_report,
    run_bi_sync,
    evaluate_alert_rules,
    refresh_artifact_data,  # on-demand + cron: re-execute widget queries
    sync_artifacts_after_schema_change,  # triggered when data source schema drifts
    dispatch_due_pipelines_job,
]
if _AI_JOB_FN is not None:
    _JOB_FUNCTIONS.append(_AI_JOB_FN)

_WRAPPED_FUNCTIONS = wrap_arq_functions(_JOB_FUNCTIONS)
_PIPELINE_RUN_FUNCTION = arq_func(
    wrap_arq_functions([run_pipeline])[0],
    name="run_pipeline",
    timeout=PIPELINE_JOB_TIMEOUT,
)
# Profiling a large file and streaming it to Bronze both outlive the 300s default.
_ONBOARDING_FUNCTIONS = [
    arq_func(
        wrap_arq_functions([profile_staged_asset])[0],
        name="profile_staged_asset",
        timeout=PIPELINE_JOB_TIMEOUT,
    ),
    arq_func(
        wrap_arq_functions([ingest_staged_asset])[0],
        name="ingest_staged_asset",
        timeout=PIPELINE_JOB_TIMEOUT,
    ),
]
_ARQ_FUNCTIONS = [*_WRAPPED_FUNCTIONS, _PIPELINE_RUN_FUNCTION, *_ONBOARDING_FUNCTIONS]
_FUNCTIONS_BY_NAME = {fn.__name__: fn for fn in _WRAPPED_FUNCTIONS}


async def _write_heartbeat() -> None:
    """Write a Redis heartbeat key so the API health endpoint knows the worker is alive."""
    try:
        import redis as _redis

        _r = _redis.from_url(REDIS_URL, socket_connect_timeout=2, socket_timeout=2)
        _r.setex(
            "aiser:worker:heartbeat", 90, "1"
        )  # TTL 90s; renewed every cron minute
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

    functions = _ARQ_FUNCTIONS

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
        cron(
            _FUNCTIONS_BY_NAME["dispatch_due_pipelines_job"],
            minute=set(range(60)),
            name="pipeline_schedule_dispatch",
        ),
    ]
