"""
ARQ Worker settings for Aiser background jobs.

Run with: python -m arq src.shared.jobs.worker.WorkerSettings

ARQ uses Redis as its queue backend (same Redis instance used by the app).
"""
import os
import logging

# `python -m arq src.shared.jobs.worker.WorkerSettings` makes this file the
# first piece of this codebase's own code to run in the worker process -
# installed here (belt-and-suspenders alongside src.core.edition's own
# import doing the same) before any of the task imports below touch a
# shimmed EE module. See src/core/ee_import_alias.py's docstring.
from src.core.ee_import_alias import install as _install_ee_import_alias

_install_ee_import_alias()

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
    refresh_all_active_schemas,
    reindex_stale_knowledge_chunks,
    classify_data_source_columns,
    ingest_knowledge_document,
    sync_salesforce_object,
    sync_hubspot_object,
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
    refresh_all_active_schemas,      # cron: fans out schema refresh + drift detection to every active source
    reindex_stale_knowledge_chunks,  # cron: re-embeds chunks with missing/stale embeddings, bounded batch per run
    classify_data_source_columns,    # on-demand: LLM column classification cache population (see column_semantic_classifier.py)
    ingest_knowledge_document,       # on-demand: parse+chunk+embed one KB upload (see knowledge/router.py's /create, /upload)
    sync_salesforce_object,          # on-demand: pull one Salesforce object into a connected Postgres data source
    sync_hubspot_object,             # on-demand: pull one HubSpot object into a connected Postgres data source
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
    # Task functions now re-raise on failure (instead of swallowing exceptions
    # into a {"success": False} dict) so ARQ's retry mechanism and
    # job_tracing's error capture actually engage. Bound the retries so a
    # persistently-failing job doesn't retry forever.
    max_tries = 3

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
            _FUNCTIONS_BY_NAME["refresh_all_active_schemas"],
            hour=set(range(0, 24, 6)),
            minute=15,
            name="schema_refresh_and_drift_check",
        ),
        cron(
            _FUNCTIONS_BY_NAME["reindex_stale_knowledge_chunks"],
            minute={0, 15, 30, 45},
            name="knowledge_chunk_reindex",
        ),
    ]
