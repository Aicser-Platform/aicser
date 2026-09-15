"""Regression tests for dashboard-refine widget data-source binding.

Live-reproduced bug: a chat turn that reached dashboard_refiner_node (the
"refine" lifecycle action - add/remove/update widgets on an existing,
sticky dashboard) with an empty state["data_source_id"] - e.g. because the
turn wasn't really a data question to begin with (a misrouted export
request; see test_dashboard_lifecycle_sticky.py and
test_supervisor_skill_reachability.py for that separate bug) - created any
NEW widget with data_source_id=None. validate_widgets (dashboard_widget_
validator.py) only checks chart_query column names against the schema; it
has no notion of data_source_id at all, so nothing caught this before the
widget was persisted. The dashboard's chat summary said "1 widget added",
but opening the widget showed an error: no data binding / not properly
configured, because it genuinely had none.

Two-part fix, both covered here:
  1. dashboard_refiner_node backfills a missing state data_source_id from
     the dashboard's OWN existing widgets before calling _tool_apply_edits
     (a board that already has widgets already has a data source).
  2. _tool_apply_edits refuses to create a widget when no data_source_id is
     resolvable at all (same "dropped" contract as every other
     validate_widgets guardrail) rather than persisting one with
     data_source_id=None.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ee.modules.ai.nodes.dashboard_lifecycle_node import (
    _tool_apply_edits,
    dashboard_refiner_node,
)


class _FakeAsyncSessionCM:
    """Stands in for `async with async_session() as db:` without a real DB."""

    def __init__(self, db):
        self._db = db

    async def __aenter__(self):
        return self._db

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _patch_db_layer(chart_svc_instance=None, chart_lib_instance=None):
    """Patches _tool_apply_edits' local DB/service imports at their source
    modules (they're imported inside the function body, so patching has to
    target where they're defined, not dashboard_lifecycle_node's namespace)."""
    chart_svc_instance = chart_svc_instance or MagicMock()
    chart_svc_instance.create = AsyncMock(return_value=None)
    chart_svc_instance.detach = AsyncMock(return_value=True)
    chart_svc_instance.get_chart = AsyncMock(return_value=None)

    chart_lib_instance = chart_lib_instance or MagicMock()
    chart_lib_instance.update = AsyncMock(return_value=None)

    fake_db = MagicMock()
    fake_db.commit = AsyncMock()

    return (
        patch(
            "src.db.session.async_session",
            MagicMock(return_value=_FakeAsyncSessionCM(fake_db)),
        ),
        patch(
            "src.modules.charts.services.v2.dashboard_chart_service.DashboardChartService",
            MagicMock(return_value=chart_svc_instance),
        ),
        patch(
            "src.modules.charts.services.v2.chart_service.ChartService",
            MagicMock(return_value=chart_lib_instance),
        ),
        patch(
            "ee.modules.ai.services.semantic_layer_db.semantic_layer_db.list_metrics",
            AsyncMock(return_value=[]),
        ),
        chart_svc_instance,
    )


_ORDERS_SCHEMA = {"tables": [{"name": "orders", "columns": [{"name": "revenue"}, {"name": "id"}]}]}
_ADD_ONE_STAT_WIDGET = {
    "add": [
        {
            "title": "Total Revenue",
            "chart_type": "stat",
            "table_name": "orders",
            "y_metric": "revenue",
            "aggregation": "sum",
        }
    ]
}


@pytest.mark.asyncio
async def test_apply_edits_refuses_to_create_widget_with_no_data_source():
    """The core contract fix: no data_source_id resolvable anywhere -> the
    widget must be dropped, never persisted unbound."""
    p1, p2, p3, p4, chart_svc = _patch_db_layer()
    with p1, p2, p3, p4:
        added, removed, updated = await _tool_apply_edits(
            "11111111-1111-1111-1111-111111111111",
            _ADD_ONE_STAT_WIDGET,
            data_source_id="",
            schema=_ORDERS_SCHEMA,
        )

    assert added == 0
    chart_svc.create.assert_not_awaited()


@pytest.mark.asyncio
async def test_apply_edits_creates_widget_bound_to_the_given_data_source():
    """Sanity check for the happy path: a real data_source_id is threaded
    straight through onto the created widget's payload."""
    p1, p2, p3, p4, chart_svc = _patch_db_layer()
    with p1, p2, p3, p4:
        added, removed, updated = await _tool_apply_edits(
            "11111111-1111-1111-1111-111111111111",
            _ADD_ONE_STAT_WIDGET,
            data_source_id="ds-1",
            schema=_ORDERS_SCHEMA,
        )

    assert added == 1
    chart_svc.create.assert_awaited_once()
    _, kwargs = chart_svc.create.await_args
    assert kwargs["chart_payload"]["data_source_id"] == "ds-1"


@pytest.mark.asyncio
async def test_refiner_node_backfills_missing_data_source_from_existing_widgets():
    """The UX-level half of the fix: when the CURRENT chat turn carries no
    data_source_id at all, dashboard_refiner_node must reuse the sticky
    board's own existing data source rather than passing the empty value
    straight through to _tool_apply_edits (which would otherwise have to
    drop every new widget outright, per the test above)."""
    dashboard = {"title": "Ops Dashboard"}
    existing_widgets = [
        {"id": "w1", "title": "Orders", "chart_type": "bar", "data_source_id": "ds-existing"}
    ]
    apply_mock = AsyncMock(return_value=(1, 0, 0))

    state = {
        "target_dashboard_id": "11111111-1111-1111-1111-111111111111",
        "query": "add a kpi for total revenue",
        "data_source_id": "",  # <-- the live-bug condition: nothing on this turn
        "data_source_schema": _ORDERS_SCHEMA,
        "user_id": "",
    }

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_load_dashboard",
        AsyncMock(return_value=(dashboard, existing_widgets, [])),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_snapshot_version",
        AsyncMock(return_value=None),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_plan_edits",
        AsyncMock(return_value=dict(_ADD_ONE_STAT_WIDGET)),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_apply_edits", apply_mock
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_verify", AsyncMock(return_value=2)
    ):
        out = await dashboard_refiner_node(state)

    apply_mock.assert_awaited_once()
    called_data_source_id = apply_mock.await_args[0][2]
    assert called_data_source_id == "ds-existing"
    assert out["current_stage"] == "dashboard_generation_complete"


@pytest.mark.asyncio
async def test_refiner_node_leaves_a_real_data_source_id_untouched():
    """The backfill must not override a legitimately-present data_source_id
    with the board's own (possibly different, e.g. a multi-source board)
    existing widget data source."""
    dashboard = {"title": "Ops Dashboard"}
    existing_widgets = [
        {"id": "w1", "title": "Orders", "chart_type": "bar", "data_source_id": "ds-existing"}
    ]
    apply_mock = AsyncMock(return_value=(1, 0, 0))

    state = {
        "target_dashboard_id": "11111111-1111-1111-1111-111111111111",
        "query": "add a kpi for total revenue",
        "data_source_id": "ds-from-this-turn",
        "data_source_schema": _ORDERS_SCHEMA,
        "user_id": "",
    }

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_load_dashboard",
        AsyncMock(return_value=(dashboard, existing_widgets, [])),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_snapshot_version",
        AsyncMock(return_value=None),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_plan_edits",
        AsyncMock(return_value=dict(_ADD_ONE_STAT_WIDGET)),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_apply_edits", apply_mock
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_verify", AsyncMock(return_value=2)
    ):
        await dashboard_refiner_node(state)

    called_data_source_id = apply_mock.await_args[0][2]
    assert called_data_source_id == "ds-from-this-turn"


@pytest.mark.asyncio
async def test_refiner_node_with_no_existing_widgets_and_no_data_source_still_refuses_to_bind():
    """End-to-end floor: a brand-new sticky board with zero existing widgets
    AND no data_source_id on this turn has nothing to backfill from -
    _tool_apply_edits' own refusal (tested directly above) is what keeps
    this from ever persisting an unbound widget, and the refiner's summary
    must reflect that honestly (0 added), not claim success."""
    dashboard = {"title": "Empty Dashboard"}
    p1, p2, p3, p4, chart_svc = _patch_db_layer()

    state = {
        "target_dashboard_id": "11111111-1111-1111-1111-111111111111",
        "query": "add a kpi for total revenue",
        "data_source_id": "",
        "data_source_schema": _ORDERS_SCHEMA,
        "user_id": "",
    }

    with patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_load_dashboard",
        AsyncMock(return_value=(dashboard, [], [])),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_snapshot_version",
        AsyncMock(return_value=None),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_plan_edits",
        AsyncMock(return_value=dict(_ADD_ONE_STAT_WIDGET)),
    ), patch(
        "ee.modules.ai.nodes.dashboard_lifecycle_node._tool_verify", AsyncMock(return_value=0)
    ), p1, p2, p3, p4:
        out = await dashboard_refiner_node(state)

    chart_svc.create.assert_not_awaited()
    assert out["dashboard_created"]["widget_count"] == 0
