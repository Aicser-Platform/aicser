"""Regression test: deleting a dashboard in CE must not 500.

DashboardService.delete() used to unconditionally clean up the legacy
``dashboard_widgets`` table. That table is only created by an EE-gated
migration (alembic/versions/2026_05_24_ee_platform_tables.py checks
_is_ee_enabled() before op.create_table), so in a Community Edition
deployment the table never exists and the DELETE raised
asyncpg.exceptions.UndefinedTableError, aborting the whole delete with a 500
before any of the dashboard's real rows (charts, pages, shares) were removed.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from src.modules.charts.services.v2.dashboard_service import DashboardService
from src.modules.dashboards.models import Dashboard


def _make_mock_db():
    db = MagicMock()
    execute_result = MagicMock()
    execute_result.scalars.return_value = []
    db.execute = AsyncMock(return_value=execute_result)
    db.delete = AsyncMock()
    db.commit = AsyncMock()
    return db


def _executed_sql_statements(db) -> list[str]:
    return [str(call.args[0]) for call in db.execute.call_args_list if call.args]


@pytest.mark.asyncio
async def test_delete_skips_legacy_dashboard_widgets_table_in_ce(monkeypatch):
    monkeypatch.delenv("AISER_EDITION", raising=False)
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)

    db = _make_mock_db()
    dashboard = Dashboard(id=uuid4(), name="Test Dashboard")

    await DashboardService(db).delete(dashboard)

    statements = _executed_sql_statements(db)
    assert not any("dashboard_widgets" in sql for sql in statements), (
        "CE must not touch the EE-only dashboard_widgets table: " + repr(statements)
    )
    db.delete.assert_awaited_with(dashboard)
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_delete_still_cleans_legacy_dashboard_widgets_table_in_ee(monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "enterprise")

    db = _make_mock_db()
    dashboard = Dashboard(id=uuid4(), name="Test Dashboard")

    await DashboardService(db).delete(dashboard)

    statements = _executed_sql_statements(db)
    assert any("dashboard_widgets" in sql for sql in statements), (
        "EE still has the table and should clean it up: " + repr(statements)
    )


@pytest.mark.asyncio
async def test_delete_skips_legacy_scheduled_emails_cleanup_in_ce(monkeypatch):
    """Regression: scheduled_emails is also only created on the EE-only
    migration branch (f11a9f2c63b1_ee_tables.py, branch_labels=('ee',)) --
    it never exists in CE. The old code wrapped this in try/except: pass,
    which swallowed the UndefinedTableError but left the DB transaction
    aborted, so every subsequent statement in delete() (including the final
    commit's flush) failed with InFailedSQLTransactionError -- a second,
    previously-masked 500 behind the dashboard_widgets one.
    """
    monkeypatch.delenv("AISER_EDITION", raising=False)
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)

    db = _make_mock_db()
    dashboard = Dashboard(id=uuid4(), name="Test Dashboard")

    await DashboardService(db).delete(dashboard)

    statements = _executed_sql_statements(db)
    assert not any("scheduled_emails" in sql for sql in statements), (
        "CE must not touch the EE-only scheduled_emails table: " + repr(statements)
    )
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_delete_still_cleans_scheduled_emails_in_ee(monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "enterprise")

    db = _make_mock_db()
    dashboard = Dashboard(id=uuid4(), name="Test Dashboard")

    await DashboardService(db).delete(dashboard)

    statements = _executed_sql_statements(db)
    assert any("scheduled_emails" in sql for sql in statements), (
        "EE still has the table and should clean it up: " + repr(statements)
    )
