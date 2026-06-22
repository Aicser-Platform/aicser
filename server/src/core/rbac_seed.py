"""Seed default RBAC roles/permissions when tables exist (CE + EE)."""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


async def maybe_seed_rbac() -> None:
    """Populate roles/permissions when RBAC tables exist but are empty."""
    try:
        from sqlalchemy import func, select

        from src.db.session import async_session
        from src.modules.authentication.rbac.models import Role
    except ImportError:
        return

    try:
        async with async_session() as db:
            count = (await db.execute(select(func.count()).select_from(Role))).scalar() or 0
        if count == 0:
            logger.info("RBAC roles table is empty — running seed_rbac...")
            from ee.scripts.seed_rbac import seed_permissions, seed_roles

            await seed_permissions()
            await seed_roles()
            logger.info("RBAC seed complete")
        else:
            logger.info("RBAC roles already seeded (%d roles)", count)
    except Exception as exc:
        logger.warning("RBAC auto-seed failed: %s", exc)
