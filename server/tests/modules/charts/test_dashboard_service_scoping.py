"""Regression test: CE dashboard listing must be scoped per user.

GET /api/dashboards in CE called DashboardService.list_all(), a bare
`SELECT * FROM dashboards` with no owner filter at all -- any authenticated
CE user could list (and, via the id, open) every other user's dashboards.
`dashboards` had no owner column at all, so this also required a migration
(alembic/versions/2026_07_06_dashboard_created_by.py) adding created_by.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from src.modules.charts.services.v2.dashboard_service import DashboardService


def _make_mock_db():
    db = MagicMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value = []
    db.execute = AsyncMock(return_value=execute_result)
    return db


@pytest.mark.asyncio
async def test_list_by_user_filters_to_owner_or_legacy_null():
    db = _make_mock_db()
    user_id = uuid4()

    await DashboardService(db).list_by_user(user_id)

    stmt = db.execute.call_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": False}))
    assert "dashboards.created_by" in compiled
    assert "OR" in compiled.upper()
    assert "IS NULL" in compiled.upper()


@pytest.mark.asyncio
async def test_list_all_has_no_owner_filter_documenting_the_old_unscoped_path():
    # list_all() itself is intentionally kept (EE's list_by_project path and
    # any admin tooling may still want it) -- this test just documents that
    # it is NOT what CE listing should call anymore; see router wiring test.
    db = _make_mock_db()
    await DashboardService(db).list_all()
    stmt = db.execute.call_args.args[0]
    compiled = str(stmt.compile(compile_kwargs={"literal_binds": False}))
    assert "WHERE" not in compiled.upper()
