"""_create_kpi_alerts persists condition_sql that a later, unattended alert
evaluator executes - unlike this function's own parameterized INSERT, any
untrusted text baked into that SQL string is a stored SQL injection. KPIs can
originate from LLM-authored plan text (plan_action_node's free-text "metric"
field), not just schema introspection, so the function must validate every
identifier against the real, introspected schema before interpolating it."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ee.modules.ai.nodes.business_journey_nodes import _create_kpi_alerts

SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "id", "type": "integer"},
                {"name": "revenue", "type": "numeric"},
                {"name": "quantity", "type": "integer"},
            ],
        }
    ]
}


def _mock_db():
    db = MagicMock()
    db.execute = AsyncMock()
    db.commit = AsyncMock()
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=db)
    cm.__aexit__ = AsyncMock(return_value=False)
    return db, cm


@pytest.mark.asyncio
async def test_rejects_kpi_not_in_schema():
    db, cm = _mock_db()
    with patch("src.db.session.async_session", return_value=cm):
        created = await _create_kpi_alerts(
            data_source_id="ds1",
            user_id="u1",
            kpis=["revenue); DROP TABLE users; --"],
            schema=SCHEMA,
        )
    assert created == 0
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_rejects_malicious_table_identifier():
    db, cm = _mock_db()
    malicious_schema = {"tables": [{"name": 'orders"; DROP TABLE users; --', "columns": []}]}
    with patch("src.db.session.async_session", return_value=cm):
        created = await _create_kpi_alerts(
            data_source_id="ds1",
            user_id="u1",
            kpis=["revenue"],
            schema=malicious_schema,
        )
    assert created == 0
    db.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_accepts_real_schema_column_case_insensitively():
    db, cm = _mock_db()
    with patch("src.db.session.async_session", return_value=cm):
        created = await _create_kpi_alerts(
            data_source_id="ds1",
            user_id="u1",
            kpis=["Revenue"],  # LLM-authored casing, not the schema's exact "revenue"
            schema=SCHEMA,
        )
    assert created == 1
    db.execute.assert_awaited_once()
    params = db.execute.call_args.args[1]
    assert params["sql"] == 'SELECT SUM("revenue") as value FROM "orders"'


@pytest.mark.asyncio
async def test_no_schema_yields_no_alerts():
    db, cm = _mock_db()
    with patch("src.db.session.async_session", return_value=cm):
        created = await _create_kpi_alerts(
            data_source_id="ds1",
            user_id="u1",
            kpis=["revenue"],
            schema=None,
        )
    assert created == 0
    db.execute.assert_not_awaited()
