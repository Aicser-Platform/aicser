"""Shared health/readiness check logic.

Used by the primary /health and /ready endpoints in src/main.py, and by the
secondary health endpoints in ee/modules/ai/router.py and
src/modules/data/router.py, so all three report consistent, real status
instead of each duplicating (or hardcoding) their own logic.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

DB_HEALTH_TIMEOUT_SECONDS = 2.0


async def _check_database() -> str:
    """Lightweight `SELECT 1` against the primary Postgres database.

    Bounded by a short timeout so a hung/unreachable database can't stall
    the health endpoint indefinitely.
    """
    try:
        from sqlalchemy import text

        from src.db.session import async_engine

        async def _ping() -> None:
            async with async_engine.connect() as conn:
                await conn.execute(text("SELECT 1"))

        await asyncio.wait_for(_ping(), timeout=DB_HEALTH_TIMEOUT_SECONDS)
        return "up"
    except asyncio.TimeoutError:
        logger.warning("Database health check timed out after %ss", DB_HEALTH_TIMEOUT_SECONDS)
        return "timeout"
    except Exception as exc:
        logger.warning("Database health check failed: %s", exc)
        return "down"


async def collect_health_payload() -> tuple[dict, int]:
    """Build health JSON and suggested HTTP status (200 vs 503)."""
    from src.core.cache import cache
    from src.core.lifespan import _check_ai_capabilities, _check_predictive_deps
    from src.core.production import is_production

    out: dict = {"status": "healthy"}
    critical_down = False

    # Postgres (primary database) — critical dependency, same treatment as Redis below.
    db_status = await _check_database()
    out["database"] = db_status
    if db_status != "up" and is_production():
        critical_down = True

    # Redis
    try:
        if cache and getattr(cache, "redis_client", None):
            cache.redis_client.ping()
            out["redis"] = "up"
        elif cache:
            out["redis"] = "fallback"
        else:
            out["redis"] = "unavailable"
            if is_production():
                critical_down = True
    except Exception:
        out["redis"] = "down"
        if is_production():
            critical_down = True

    # ARQ worker — check if Redis queue is reachable and worker appears active.
    worker_status = "unknown"
    try:
        import redis as _redis

        _redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _r = _redis.from_url(_redis_url, socket_connect_timeout=1, socket_timeout=1)
        hb = _r.get("aiser:worker:heartbeat")
        if hb:
            worker_status = "up"
        else:
            result_keys = _r.keys("arq:result:*")
            worker_status = "degraded" if result_keys else "down"
        _r.close()
    except Exception:
        worker_status = "unavailable"
    out["worker"] = worker_status
    if is_production() and worker_status in ("down", "unavailable"):
        critical_down = True

    out["predictive"] = _check_predictive_deps()
    out["capabilities"] = _check_ai_capabilities()

    if critical_down:
        out["status"] = "degraded"
    status_code = 503 if critical_down else 200
    return out, status_code
