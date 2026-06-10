"""Database seed script.

Run via CLI::

    python -m app.scripts.seed

or directly::

    python app/scripts/seed.py

Seeds are idempotent — safe to run multiple times against the same database.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


async def _run_all_seeders() -> None:
    """Execute every registered seeder in dependency order."""
    from src.db.session import async_session
    from src.db.seeder import (
        seed_subscription_plans,
        seed_organization_subscriptions,
    )

    async with async_session() as session:
        plans_inserted = await seed_subscription_plans(session)
        logger.info("seed_subscription_plans: %d inserted", plans_inserted)

        subs_inserted = await seed_organization_subscriptions(session)
        logger.info("seed_organization_subscriptions: %d inserted", subs_inserted)

    logger.info("All seeders completed successfully.")

    if os.getenv("AISER_SEED_DEMO_TEAM", "").strip().lower() in ("1", "true", "yes"):
        try:
            import importlib.util
            from pathlib import Path

            script_path = Path(__file__).resolve().parents[1] / "ee" / "scripts" / "seed_demo_team_plan.py"
            spec = importlib.util.spec_from_file_location("seed_demo_team_plan", script_path)
            mod = importlib.util.module_from_spec(spec)
            assert spec.loader is not None
            spec.loader.exec_module(mod)

            email = os.getenv("AISER_DEMO_TEAM_EMAIL", "demo@dataticon.com")
            async with async_session() as session:
                ok = await mod.provision_demo_team_plan(session, email=email)
            logger.info("seed_demo_team_plan (%s): %s", email, "ok" if ok else "skipped/failed")
        except Exception as exc:
            logger.warning("seed_demo_team_plan failed: %s", exc)


def main() -> None:
    """Entry point — runs all seeders synchronously via asyncio."""
    try:
        asyncio.run(_run_all_seeders())
    except Exception as exc:  # noqa: BLE001
        logger.error("Seed failed: %s", exc, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
