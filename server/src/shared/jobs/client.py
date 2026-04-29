"""
ARQ job client for enqueuing background tasks from FastAPI endpoints.

Usage:
    from src.shared.jobs.client import enqueue_job
    await enqueue_job('run_data_quality_check', data_source_id='abc123')
"""
import os
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


async def enqueue_job(function_name: str, **kwargs: Any) -> Optional[str]:
    """
    Enqueue a background job via ARQ.

    Returns the job ID if successful, None if ARQ/Redis is unavailable.
    Jobs will be processed by the ARQ worker (run: arq app.jobs.worker.WorkerSettings).
    """
    try:
        import arq  # type: ignore
        from arq import create_pool
        from arq.connections import RedisSettings

        redis = await create_pool(RedisSettings.from_dsn(REDIS_URL))
        job = await redis.enqueue_job(function_name, **kwargs)
        await redis.aclose()
        if job:
            logger.info(f"Enqueued job: {function_name} (id={job.job_id})")
            return job.job_id
        return None
    except ImportError:
        logger.warning("ARQ not installed. Run: pip install arq")
        return None
    except Exception as e:
        logger.error(f"Failed to enqueue job {function_name}: {e}")
        return None


async def get_job_status(job_id: str) -> dict:
    """Get the status of a queued job."""
    try:
        import arq  # type: ignore
        from arq import create_pool
        from arq.connections import RedisSettings

        redis = await create_pool(RedisSettings.from_dsn(REDIS_URL))
        job = arq.jobs.Job(job_id=job_id, redis=redis)
        status = await job.status()
        result = None
        if status.value in ("complete", "failed"):
            result = await job.result(timeout=1)
        await redis.aclose()
        return {"job_id": job_id, "status": status.value, "result": result}
    except Exception as e:
        logger.error(f"Failed to get job status for {job_id}: {e}")
        return {"job_id": job_id, "status": "unknown", "error": str(e)}
