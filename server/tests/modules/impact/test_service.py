"""What-depends-on-this, with a stand-in database keyed by the table each query reads."""

import pytest
from sqlalchemy.exc import ProgrammingError

from src.modules.data.services.governed_sql import Caller
from src.modules.impact import service


class Seq(list):
    """Successive answers for the same table."""


class FakeDB:
    def __init__(self, tables):
        self.tables = tables
        self.queries = []
        self.rolled_back = 0

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.queries.append((sql, params))
        for table, rows in self.tables.items():
            if f"FROM {table}" in sql:
                if rows is None:
                    raise ProgrammingError(sql, params, Exception(f'relation "{table}" does not exist'))
                return _Result(rows.pop(0) if isinstance(rows, Seq) else rows)
        return _Result([])

    async def rollback(self):
        self.rolled_back += 1


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


CALLER = Caller(user_id="u1", organization_id="00000000-0000-0000-0000-000000000001", project_id=None, payload={})


@pytest.mark.asyncio
async def test_connection_lists_what_uses_it_and_tolerates_missing_enterprise_tables(monkeypatch):
    monkeypatch.setattr(service, "is_ee_enabled", lambda: False)
    db = FakeDB({
        "charts": [("c1", "Revenue by month", "p1", "u1"), ("c2", "Someone else's", "p1", "u2")],
        "alert_rules": None,  # not in Community
        "semantic_metrics": [("m1", "total_sales", "p1")],
        "data_pipelines": None,
        "prep_recipes": [("r1", "Clean orders", "p1", "u1")],
    })
    result = (await service.dependents(db, CALLER, "data_source", "ds-1")).as_dict()
    assert [i["kind"] for i in result["items"]] == ["chart", "metric", "recipe"]
    assert result["items"][0]["href"] == "/chart-designer?chart=c1"
    assert result["counts"] == {"chart": 1, "metric": 1, "recipe": 1}
    # Community: another person's chart is counted, never named.
    assert result["hidden"] == 1
    assert db.rolled_back == 2
    # Every query stays inside the caller's organization.
    assert all(params.get("org") == CALLER.organization_id for _sql, params in db.queries)


@pytest.mark.asyncio
async def test_dependents_the_caller_cannot_open_are_counted_not_named(monkeypatch):
    async def can_view(_caller, _permission, project_id):
        return project_id == "mine"

    monkeypatch.setattr(service, "_can_view", can_view)
    db = FakeDB({
        "dashboard_charts": [("d1", "Sales", "mine", "u9"), ("d2", "Board pack", "theirs", "u9")],
        "alert_rules": [],
        "feed_posts": [],
    })
    result = (await service.dependents(db, CALLER, "chart", "11111111-1111-1111-1111-111111111111")).as_dict()
    assert [i["name"] for i in result["items"]] == ["Sales"]
    assert result["hidden"] == 1


@pytest.mark.asyncio
async def test_metric_names_are_matched_literally(monkeypatch):
    monkeypatch.setattr(service, "is_ee_enabled", lambda: False)
    db = FakeDB({"semantic_metrics": Seq([[("total_sales%", "ds-1")], [("m2", "sales_per_order", "p1")]])})
    result = (await service.dependents(db, CALLER, "metric", "m1")).as_dict()
    assert [i["name"] for i in result["items"]] == ["sales_per_order"]
    params = db.queries[-1][1]
    assert params["quoted"] == '%"total\\_sales\\%"%'
    assert params["word"] == r"\mtotal_sales%\M"


@pytest.mark.asyncio
async def test_unknown_kind_and_no_organization():
    with pytest.raises(ValueError):
        await service.dependents(FakeDB({}), CALLER, "spaceship", "x")
    nobody = Caller(user_id="u1", organization_id=None, project_id=None, payload={})
    assert (await service.dependents(FakeDB({}), nobody, "chart", "x")).as_dict()["items"] == []
