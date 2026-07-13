"""Application lifespan — startup checks and shutdown cleanup."""
import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI

from src.core.cache import cache
from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)


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
            # Register EE's auth provider so CE's router resolves login/register
            # through it instead of importing ee.modules.auth by name.
            try:
                from ee.modules.auth import EEAuthProviderAdapter
                from src.modules.authentication.provider import register_auth_provider
                register_auth_provider(EEAuthProviderAdapter())
                logger.info("EE auth provider registered")
            except Exception as e:
                logger.warning("Failed to register EE auth provider: %s", e)

            # Auto-seed RBAC roles/permissions if table is empty
            try:
                from sqlalchemy import select, func
                from src.db.session import async_session
                from src.modules.authentication.rbac.models import Role
                async with async_session() as _db:
                    count = (await _db.execute(select(func.count()).select_from(Role))).scalar() or 0
                if count == 0:
                    logger.info("RBAC roles table is empty — running seed_rbac...")
                    from ee.scripts.seed_rbac import seed_permissions, seed_roles
                    await seed_permissions()
                    await seed_roles()
                    logger.info("RBAC seed complete")
                else:
                    logger.info("RBAC roles already seeded (%d roles)", count)
            except Exception as e:
                logger.warning("RBAC auto-seed failed: %s", e)

            # Auto-seed subscription plans if table is empty
            try:
                from sqlalchemy import select, func
                from src.db.session import async_session
                from src.modules.billing.models import SubscriptionPlan

                async with async_session() as _db:
                    plan_count = (
                        await _db.execute(select(func.count()).select_from(SubscriptionPlan))
                    ).scalar() or 0

                if plan_count == 0:
                    logger.info("Subscription plans table is empty — running seed_subscription_plans...")
                    from ee.scripts.seed_subscription_plans import seed_plans

                    await seed_plans()
                    logger.info("Subscription plans seed complete")
                else:
                    logger.info("Subscription plans already seeded (%d plans)", plan_count)
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
