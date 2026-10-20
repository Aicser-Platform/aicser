"""Org metric definitions are certified semantic metrics: one definition per name, any number of connections."""

import pytest

from ee.modules.ai.services import kpi_memory_service


class _Session:
    def __init__(self, rows):
        self.rows = rows

    async def execute(self, *args, **kwargs):
        rows = self.rows

        class _R:
            def fetchall(self):
                return rows

        return _R()


@pytest.mark.asyncio
async def test_a_metric_certified_on_two_connections_is_one_definition():
    session = _Session([
        ("mrr", "Monthly recurring revenue", ["mrr", "monthly revenue"], "SUM(amount)", "ds-1", 4, None, "m1"),
        ("mrr", "Monthly recurring revenue", ["mrr", "monthly revenue"], "SUM(amount)", "ds-2", 9, None, "m2"),
        ("churn", "churn", [], "COUNT(*)", "ds-1", 0, "Lost customers", "m3"),
    ])
    rows = await kpi_memory_service._certified_metrics(session, "org-1")
    mrr = next(r for r in rows if r["kpi_slug"] == "mrr")
    assert mrr["data_source_ids"] == ["ds-1", "ds-2"]
    assert mrr["usage_count"] == 9
    assert mrr["trigger_keywords"] == "mrr, monthly revenue"
    assert {r["kpi_slug"] for r in rows} == {"mrr", "churn"}


@pytest.mark.asyncio
async def test_synonyms_match_questions_on_the_right_connection(monkeypatch):
    async def raw(_session, _org):
        return [{"kpi_slug": "mrr", "kpi_name": "MRR", "trigger_keywords": "monthly revenue",
                 "sql_expression": "SUM(amount)", "data_source_ids": ["ds-1"], "usage_count": 1}]

    monkeypatch.setattr(kpi_memory_service, "_fetch_raw_org_definitions", raw)
    hit = await kpi_memory_service._query_definitions(None, "org-1", "what was monthly revenue in May", "ds-1", 5)
    other = await kpi_memory_service._query_definitions(None, "org-1", "what was monthly revenue in May", "ds-9", 5)
    assert [d["kpi_slug"] for d in hit] == ["mrr"] and other == []
