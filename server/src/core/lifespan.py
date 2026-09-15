"""Application lifespan — startup checks and shutdown cleanup."""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from src.core.cache import cache
from src.core.edition import is_ee_enabled
from src.core.licensing import service as licensing_service

logger = logging.getLogger(__name__)


_SINGLETON_LEASE_TTL_SECONDS = 120
_SINGLETON_LEASE_RENEW_SECONDS = 40


def _try_acquire_singleton_lease(name: str) -> bool:
    """First-writer-wins Redis lock so a perpetual startup task (Telegram bot
    polling, trial-lifecycle loops, the scheduled-email dispatcher) runs in
    only one of this container's uvicorn worker processes.

    Horizontal scale-out (SERVER_WORKERS > 1, see docker-compose.ee.yml)
    means N sibling processes all run this same lifespan startup code, and
    each `asyncio.create_task(...)` below was firing once per worker before
    this guard existed -- live-confirmed duplicate "Telegram bot initialized"
    / "Trial lifecycle background jobs started" log lines after enabling
    --workers 2. Harmless for idempotent work, but Telegram's Bot API allows
    only one active getUpdates poller per bot token (a second one errors with
    "Conflict: terminated by other getUpdates request"), and duplicate
    trial-expiry/scheduled-report sends are a real user-facing quality bug,
    not just wasted compute.

    Short TTL + heartbeat (_singleton_lease_heartbeat), not a long-lived
    lock: an earlier version used a single non-renewed 7-day SET NX EX and
    live-tested fine within one container's lifetime -- but a redeploy kills
    the old container (and its lease-holding process) while the *key*
    survives in Redis for days, so the new container's workers all see the
    lease as "already owned" by a PID that no longer exists and the task
    doesn't run anywhere until that stale lease finally expires. A short TTL
    that the winning worker actively renews means a crashed/replaced holder's
    lease goes stale within _SINGLETON_LEASE_TTL_SECONDS, not days. Fails
    OPEN (returns True, i.e. "run it") when Redis is unreachable, so
    single-process/no-redis deployments keep behaving exactly as before this
    guard existed.
    """
    try:
        if not cache or not getattr(cache, "redis_client", None):
            return True
        return bool(
            cache.redis_client.set(
                f"singleton_lease:{name}", os.getpid(), nx=True, ex=_SINGLETON_LEASE_TTL_SECONDS
            )
        )
    except Exception as e:
        logger.debug("Singleton lease check for '%s' failed (%s); running task in this process", name, e)
        return True


async def _singleton_lease_heartbeat(name: str) -> None:
    """Keep a lease held by _try_acquire_singleton_lease() alive for as long
    as this process runs, so it doesn't go stale (and get reclaimed by a
    sibling worker while this one is still the legitimate, live owner)
    before this process actually exits."""
    while True:
        await asyncio.sleep(_SINGLETON_LEASE_RENEW_SECONDS)
        try:
            if cache and getattr(cache, "redis_client", None):
                cache.redis_client.set(
                    f"singleton_lease:{name}", os.getpid(), ex=_SINGLETON_LEASE_TTL_SECONDS
                )
        except Exception as e:
            logger.debug("Singleton lease renewal for '%s' failed (non-fatal): %s", name, e)


def _import_module_quiet(name: str) -> None:
    """Import optional heavy deps without noisy optional-dependency warnings (e.g. Prophet→plotly)."""
    import io
    import sys

    buf_out, buf_err = io.StringIO(), io.StringIO()
    old_out, old_err = sys.stdout, sys.stderr
    sys.stdout, sys.stderr = buf_out, buf_err
    try:
        __import__(name)
    finally:
        sys.stdout, sys.stderr = old_out, old_err


def _check_predictive_deps() -> dict:
    """Check availability of prophet, pmdarima, statsmodels."""
    if not is_ee_enabled():
        return {}

    out = {}
    for name in ("prophet", "pmdarima", "statsmodels"):
        try:
            _import_module_quiet(name)
            out[name] = True
        except ImportError:
            out[name] = False
    return out


def _check_ai_capabilities() -> dict:
    """Lightweight check of AI-related capabilities for /health endpoint."""
    if not is_ee_enabled():
        return {}

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
        from src.shared.observability.setup import setup_observability

        setup_observability()

        from src.core.production import require_encryption_key_in_production

        require_encryption_key_in_production()

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

        # Warn when accuracy-critical ("strong"-tier) nodes will silently run on a mini model.
        # model_tiering routes nl2sql / insight_synthesizer / error_correction to the "strong"
        # tier, which falls back to the default (often *-mini) model when no reasoning/strong
        # model is configured — a common cause of low analysis accuracy.
        try:
            _strong = os.getenv("AISER_STRONG_MODEL", "").strip()
            _reasoning = os.getenv("REASONING_MODEL_DEPLOYMENT_NAME", "").strip()
            _default_models = (
                os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME", "")
                + " "
                + os.getenv("OPENAI_MODEL_ID", "")
            ).lower()
            _default_mini = any(
                tok in _default_models for tok in ("mini", "nano", "haiku", "flash")
            )
            if not _strong and not _reasoning and _default_mini:
                logger.warning(
                    "⚠️ No platform-wide strong/reasoning model configured (AISER_STRONG_MODEL / "
                    "REASONING_MODEL_DEPLOYMENT_NAME unset). For users WITHOUT a BYOK key, "
                    "accuracy-critical nodes (nl2sql, insight_synthesizer, error_correction) will "
                    "run on the default mini model — SQL correctness and analysis quality will "
                    "suffer. Users WITH a BYOK key serve the strong tier from their own key "
                    "(get_model_for_tier resolves BYOK before the mini default). For a platform "
                    "default, configure a capable model (e.g. GPT-4o / GPT-4.1 / Claude Sonnet / Gemini)."
                )
        except Exception as _strong_chk_exc:
            logger.debug("Strong-model tier check skipped: %s", _strong_chk_exc)

        # Register models with SQLAlchemy metadata (required for Alembic autogenerate)
        try:
            from src.modules.chats.models import Conversation, Message  # noqa: F401
            from src.modules.data.models import DataSource, FileStorage  # noqa: F401
            from src.modules.knowledge.models import KnowledgeDocument, DocumentChunk  # noqa: F401
            from src.modules.dashboards.models import Dashboard  # noqa: F401
            from src.modules.charts.models import ChatVisualization, DashboardEmbed  # noqa: F401
            from src.core.licensing.models import LicenseStateRecord  # noqa: F401
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

        # Self-hosted EE license-key activation/validation — no-op unless this
        # instance is both self-host and has AISER_EDITION_LICENSE_KEY set.
        try:
            await licensing_service.bootstrap()
            asyncio.create_task(licensing_service.refresh_loop())
        except Exception as e:
            logger.warning("Licensing bootstrap failed: %s", e)

        if is_ee_enabled():
            # Register EE's auth provider so CE's router resolves login/register
            # through it instead of importing ee.modules.auth by name.
            try:
                from ee.modules.auth import EEAuthProviderAdapter
                from src.modules.authentication.provider import register_auth_provider
                register_auth_provider(EEAuthProviderAdapter())
                logger.info("EE auth provider registered")
            except Exception as e:
                logger.warning("Failed to register EE auth provider: %s", e)

            # Auto-seed RBAC roles/permissions on every startup, not just when the
            # table is empty. seed_permissions()/seed_roles() are themselves fully
            # idempotent (each permission/role/role-permission mapping is checked
            # for existence before insert), so this is safe to re-run unconditionally.
            # BUG FIXED: the old `if count == 0` gate meant an environment whose
            # roles table was seeded before a new role was added to seed_rbac.py
            # (e.g. project_owner/project_editor/project_viewer) would NEVER get
            # backfilled on later deploys -- reproduced live: a project's creator
            # got no UserRole at all (create_project's "Role 'project_owner' not
            # found" warning path), so they saw "Access denied: You are not a
            # member of this project" on their own brand-new project, while
            # org-level roles (seeded earlier) kept working fine.
            try:
                from sqlalchemy import select, func
                from src.db.session import async_session
                from src.modules.authentication.rbac.models import Role
                async with async_session() as _db:
                    count = (await _db.execute(select(func.count()).select_from(Role))).scalar() or 0
                logger.info("RBAC roles table has %d role(s) — running seed_rbac to backfill any missing ones...", count)
                from ee.scripts.seed_rbac import seed_permissions, seed_roles
                await seed_permissions()
                await seed_roles()
                logger.info("RBAC seed complete")
            except Exception as e:
                logger.warning("RBAC auto-seed failed: %s", e)

            # Auto-seed (and reconcile) subscription plans on every startup.
            # BUG FIXED: seed_plans() only writes an existing plan row's
            # features/limits when force=True (CLI: --force) -- otherwise it
            # no-ops on a non-empty table. SubscriptionPlan.features is a DB
            # snapshot of PLAN_CONFIGS taken at first seed, and
            # get_merged_plan_features_for_org() ANDs the live PLAN_CONFIGS
            # value with that stored snapshot -- so without force=True here,
            # editing PLAN_CONFIGS (e.g. enabling free.api_access) would
            # never actually reach an already-seeded database. force=True is
            # safe to run unconditionally: it only overwrites plan
            # name/description/limits/features from PLAN_CONFIGS, never
            # touches per-org OrganizationSubscription rows.
            try:
                from sqlalchemy import select, func
                from src.db.session import async_session
                from src.modules.billing.models import SubscriptionPlan

                async with async_session() as _db:
                    plan_count = (
                        await _db.execute(select(func.count()).select_from(SubscriptionPlan))
                    ).scalar() or 0

                logger.info("Subscription plans table has %d plan(s) — reconciling with PLAN_CONFIGS...", plan_count)
                from ee.scripts.seed_subscription_plans import seed_plans

                await seed_plans(force=True)
                logger.info("Subscription plans seed complete")
            except Exception as e:
                logger.warning("Subscription plans auto-seed failed: %s", e)

            # Assign the free plan to existing organizations that do not yet have a subscription.
            try:
                from src.db.session import async_session
                from src.db.seeder import seed_organization_subscriptions

                async with async_session() as _db:
                    inserted = await seed_organization_subscriptions(_db)

                if inserted:
                    logger.info("Seeded free subscriptions for %d organization(s)", inserted)
            except Exception as e:
                logger.warning("Organization subscription auto-seed failed: %s", e)

            # Trial lifecycle jobs (EE) — one container-wide instance; see
            # _try_acquire_singleton_lease's docstring for why this needs a lease.
            if _try_acquire_singleton_lease("trial_jobs"):
                try:
                    from src.shared.tasks.trial_jobs import revert_expired_trials, notify_expiring_trials
                    asyncio.create_task(revert_expired_trials())
                    asyncio.create_task(notify_expiring_trials())
                    asyncio.create_task(_singleton_lease_heartbeat("trial_jobs"))
                    logger.info("Trial lifecycle background jobs started")
                except Exception as e:
                    logger.warning("Failed to start trial jobs: %s", e)
            else:
                logger.info("Trial lifecycle background jobs already owned by another worker process")

            # Scheduled email dispatcher (EE) — one container-wide instance.
            if _try_acquire_singleton_lease("scheduled_email_dispatcher"):
                try:
                    from src.shared.tasks.background import schedule_email_dispatcher
                    asyncio.create_task(schedule_email_dispatcher())
                    asyncio.create_task(_singleton_lease_heartbeat("scheduled_email_dispatcher"))
                    logger.info("Background scheduled-email dispatcher started")
                except Exception as e:
                    logger.warning("Failed to start scheduled-email dispatcher: %s", e)
            else:
                logger.info("Scheduled-email dispatcher already owned by another worker process")

            # Telegram bot (EE) — Bot API allows only one active getUpdates
            # poller per token, so this must be a single container-wide instance.
            if _try_acquire_singleton_lease("telegram_bot"):
                try:
                    from src.modules.telegram.bot import setup_bot
                    await setup_bot()
                    asyncio.create_task(_singleton_lease_heartbeat("telegram_bot"))
                    logger.info("Telegram bot initialized")
                except Exception as e:
                    logger.warning("Failed to initialize Telegram bot: %s", e)
            else:
                logger.info("Telegram bot already owned by another worker process")

        logger.info(
            "Startup complete. To seed initial data run: python -m app.scripts.seed"
        )

    except Exception as e:
        logger.error("Error during startup: %s", e)

    yield

    # ── Shutdown ─────────────────────────────────────────────────────────────
    logger.info("Performing cleanup before shutdown...")
    try:
        from src.shared.observability.setup import shutdown_observability

        shutdown_observability()
    except Exception as e:
        logger.warning("Observability shutdown error: %s", e)
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
