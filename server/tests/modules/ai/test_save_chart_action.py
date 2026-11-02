"""Saving a chart from AI (chat action or Aicser Agent) builds a valid Chart row."""

import pytest

import src.db.registry  # noqa: F401  (every model mapped, as in the app)

from src.modules.charts.models import Chart


@pytest.mark.asyncio
async def test_save_chart_passes_only_chart_columns(monkeypatch):
    from ee.modules.ai.services import action_handlers as AH

    created = {}

    class FakeService:
        def __init__(self, db):
            pass

        async def create(self, data):
            created.update(data)
            return Chart(**data)  # raises on a field Chart does not have

    class FakeSession:
        async def __aenter__(self):
            return object()

        async def __aexit__(self, *a):
            return False

    import src.db.session as session_mod
    import src.modules.charts.services.v2.chart_service as cs

    monkeypatch.setattr(session_mod, "async_session", lambda: FakeSession())
    monkeypatch.setattr(cs, "ChartService", FakeService)
    out = await AH.handle_save_chart({"user_id": "00000000-0000-0000-0000-000000000001", "sql_query": "select 1",
                                      "data_source_id": "ds1", "chart_title": "Revenue", "chart_type": "line"})
    assert out["success"] is True, out
    assert created["title"] == "Revenue" and "description" not in created
