"""Chart SQL is emitted in the data source's own dialect.

The builder used to quote every identifier with ANSI double quotes and to
default the schema to ``public``. Both are PostgreSQL spellings: MySQL reads
``"user"`` as a string literal and has no ``public`` schema, so every chart
against a MySQL source failed with a syntax error before the query reached the
row-security rewriter.
"""

import os
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

import src.db.registry  # noqa: F401


class _Scalars:
    def all(self):
        return []


class _ExecuteResult:
    def __init__(self, row):
        self._row = row

    def scalar_one_or_none(self):
        return self._row

    def scalars(self):
        # Relationship/modeled-join lookups; no modeled joins in these fixtures.
        return _Scalars()


class _Session:
    def __init__(self, row):
        self._row = row

    async def execute(self, _query):
        return _ExecuteResult(self._row)


def _source(db_type: str, **overrides):
    base = dict(
        id="ds-1",
        type="database",
        db_type=db_type,
        format=None,
        schema={"tables": [{"name": "user", "columns": [{"name": "id"}]}]},
        connection_config={},
        project_id="project-1",
        user_id="owner-7",
        file_path=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


class _CapturingEngine:
    def __init__(self):
        self.queries = []

    async def execute_query(self, query, _data_source, **_kwargs):
        self.queries.append(query)
        return {"success": True, "data": [], "columns": []}


async def _run(monkeypatch, data_source, chart_query, chart_type="bar"):
    from src.modules.charts.services.v2 import chart_service as cs

    engine = _CapturingEngine()
    monkeypatch.setattr(cs, "get_multi_engine_query_service", lambda: engine)
    chart = SimpleNamespace(
        chart_type=chart_type,
        chart_query=chart_query,
        chart_options={},
        data_source_id="ds-1",
        user_id="author-9",
    )
    await cs.ChartService(_Session(data_source)).execute(chart)
    assert engine.queries, "no SQL was executed"
    return engine.queries[0]


@pytest.mark.asyncio
async def test_mysql_chart_quotes_identifiers_with_backticks(monkeypatch):
    sql = await _run(
        monkeypatch,
        _source("mysql"),
        {
            "tableName": "user",
            "x": "name",
            "yMetrics": [{"field": "id", "aggregation": "count"}],
        },
    )

    assert '"' not in sql, f"ANSI quotes are a syntax error on MySQL: {sql}"
    assert "`name`" in sql
    assert "COUNT(`user`.`id`)" in sql


@pytest.mark.asyncio
async def test_mysql_chart_omits_the_postgres_public_schema(monkeypatch):
    sql = await _run(
        monkeypatch,
        _source("mysql"),
        {"tableName": "user", "yMetrics": [{"field": "id", "aggregation": "count"}]},
    )

    assert "public" not in sql, f"MySQL has no public schema: {sql}"
    assert "`user`" in sql


@pytest.mark.asyncio
async def test_mysql_chart_keeps_an_explicit_schema_qualifier(monkeypatch):
    """An explicit database name is real; only the ``public`` fallback is not."""
    sql = await _run(
        monkeypatch,
        _source("mysql"),
        {
            "tableName": "railway.user",
            "yMetrics": [{"field": "id", "aggregation": "count"}],
        },
    )

    assert "`railway`.`user`" in sql


@pytest.mark.asyncio
async def test_sqlserver_chart_quotes_identifiers_with_brackets(monkeypatch):
    sql = await _run(
        monkeypatch,
        _source("sqlserver"),
        {
            "tableName": "user",
            "x": "name",
            "yMetrics": [{"field": "id", "aggregation": "count"}],
        },
    )

    assert '"' not in sql, f"ANSI quotes are not T-SQL: {sql}"
    assert "[name]" in sql
    assert "COUNT([user].[id])" in sql


@pytest.mark.asyncio
async def test_postgres_chart_keeps_ansi_quoting_and_public_schema(monkeypatch):
    sql = await _run(
        monkeypatch,
        _source("postgresql"),
        {
            "tableName": "user",
            "x": "name",
            "yMetrics": [{"field": "id", "aggregation": "count"}],
        },
    )

    assert '"public"."user"' in sql
    assert '"name"' in sql
    assert 'COUNT("user"."id")' in sql


@pytest.mark.asyncio
async def test_scatter_chart_uses_the_source_dialect(monkeypatch):
    sql = await _run(
        monkeypatch,
        _source("mysql"),
        {
            "tableName": "user",
            "xMetrics": [{"field": "age", "aggregation": "none"}],
            "yMetrics": [{"field": "score", "aggregation": "none"}],
        },
        chart_type="scatter",
    )

    assert '"' not in sql, f"ANSI quotes are a syntax error on MySQL: {sql}"
    assert "`age`" in sql


def test_backtick_in_an_identifier_is_escaped_not_dropped():
    from src.modules.charts.services.v2.chart_service import ChartService

    service = ChartService(None)
    with service._sql_dialect("mysql"):
        # `_is_valid_field_name` rejects this today, but the quoting primitive
        # must not be the thing standing between a backtick and the engine.
        assert service._quote_raw_identifier("we`ird") == "`we``ird`"


@pytest.mark.asyncio
async def test_the_builder_binds_the_dialect_itself_not_only_its_caller(monkeypatch):
    """`_execute_db_source` is also reached directly (saved-query charts)."""
    from src.modules.charts.services.v2 import chart_service as cs

    engine = _CapturingEngine()
    monkeypatch.setattr(cs, "get_multi_engine_query_service", lambda: engine)

    service = cs.ChartService(_Session(None))
    # Enter with a stale PostgreSQL dialect bound, as a previous chart would leave it.
    with service._sql_dialect("postgres"):
        await service._execute_db_source(
            _source("mysql"),
            "name",
            "count",
            "id",
            [],
            False,
            None,
            "",
            chart_query={"tableName": "user"},
        )

    assert engine.queries
    assert '"' not in engine.queries[0], engine.queries[0]


@pytest.mark.asyncio
async def test_scatter_reads_the_charts_own_table(monkeypatch):
    """Scatter used the schema's first table; on a multi-table source that was the wrong one."""
    source = _source(
        "postgresql",
        schema={"tables": [
            {"name": "inventory", "columns": [{"name": "sku"}]},
            {"name": "orders", "columns": [{"name": "order_total"}, {"name": "quantity"}]},
        ]},
    )
    sql = await _run(
        monkeypatch,
        source,
        {
            "tableName": "orders",
            "xMetrics": [{"field": "quantity", "aggregation": "none"}],
            "yMetrics": [{"field": "order_total", "aggregation": "none"}],
        },
        chart_type="scatter",
    )

    assert "orders" in sql and "inventory" not in sql, sql


@pytest.mark.asyncio
async def test_map_points_group_by_place_with_average_position(monkeypatch):
    source = _source(
        "postgresql",
        schema={"tables": [{"name": "shops", "columns": [{"name": "town"}, {"name": "lat"}, {"name": "lng"}, {"name": "sales"}]}]},
    )
    sql = await _run(
        monkeypatch,
        source,
        {
            "tableName": "shops",
            "x": "town",
            "latitude": "lat",
            "longitude": "lng",
            "yMetrics": [{"field": "sales", "aggregation": "sum"}],
        },
        chart_type="geo",
    )
    assert 'AVG("lat") as lat' in sql and 'AVG("lng") as lon' in sql
    assert 'GROUP BY "town"' in sql
    assert '"lat" IS NOT NULL' in sql and '"shops"' in sql


def test_kpi_compares_periods_only_for_rows_over_time():
    from src.modules.charts.services.v2 import chart_service as cs

    svc = cs.ChartService(_Session(None))
    by_province = SimpleNamespace(chart_query={"x": "province", "yMetrics": [{"field": "sales", "aggregation": "sum"}]})
    out = svc._normalize_stat_timeseries_result(by_province, {"x": ["Kep", "Pailin"], "y": [10, 20]})
    assert out["value"] == 30 and "comparisonValue" not in out

    by_month = SimpleNamespace(chart_query={"x": "order_date", "xGrain": "month", "yMetrics": [{"field": "sales", "aggregation": "sum"}]})
    out = svc._normalize_stat_timeseries_result(by_month, {"x": ["2024-01-01", "2024-02-01"], "y": [10, 20]})
    assert out["comparisonValue"] == 10 and out["currentPeriodValue"] == 20


# ── Histogram and scatter "Dot for each" ─────────────────────────────────────

def test_histogram_bins_are_round_and_cover_the_range():
    from src.modules.charts.services.v2.chart_service import ChartService

    start, width, count = ChartService.histogram_bins(12.0, 4819.76, 178)
    assert (start, width) == (0, 500)
    assert start + count * width > 4819.76 and start + (count - 1) * width <= 4819.76
    # The author's bin count wins; a maximum sitting on an edge gets its own bin.
    s, w, c = ChartService.histogram_bins(0, 100, 50, requested=4)
    assert (s, w) == (0, 25) and s + c * w > 100
    # One distinct value still draws one bar around it.
    assert ChartService.histogram_bins(7, 7, 3)[2] == 1


class _HistogramEngine:
    def __init__(self):
        self.queries = []

    async def execute_query(self, query, _data_source, **_kwargs):
        self.queries.append(query)
        if "MIN(" in query:
            return {"success": True, "data": [{"lo": 0, "hi": 95, "n": 6}]}
        return {"success": True, "data": [{"b": 0, "n": 3}, {"b": 9, "n": 2}, {"b": 10, "n": 1}]}


@pytest.mark.asyncio
async def test_histogram_counts_every_row_in_sql_and_keeps_empty_ranges(monkeypatch):
    from src.modules.charts.services.v2 import chart_service as cs

    engine = _HistogramEngine()
    monkeypatch.setattr(cs, "get_multi_engine_query_service", lambda: engine)
    source = _source("postgresql", schema={"tables": [{"name": "bills", "columns": [{"name": "total"}]}]})
    chart = SimpleNamespace(
        chart_type="histogram",
        chart_query={"tableName": "bills", "yMetrics": [{"field": "total", "aggregation": "sum"}], "bins": 10},
        chart_options={},
        data_source_id="ds-1",
        user_id="author-9",
    )
    out = await cs.ChartService(_Session(source)).execute(chart)

    stats_sql, bucket_sql = engine.queries
    assert '"total" IS NOT NULL' in stats_sql and "LIMIT" not in bucket_sql
    assert "FLOOR" in bucket_sql and "GROUP BY" in bucket_sql
    assert out["bins"][0] == [0, 10] and len(out["y"]) == len(out["bins"])
    assert out["y"][0] == 3 and 0 in out["y"]  # gaps are part of the shape
    assert sum(out["y"]) == 6  # the maximum lands in the last range, not outside


@pytest.mark.asyncio
async def test_scatter_dot_for_each_groups_by_that_column(monkeypatch):
    source = _source(
        "postgresql",
        schema={"tables": [{"name": "bills", "columns": [{"name": "vendor"}, {"name": "total"}, {"name": "days"}]}]},
    )
    sql = await _run(
        monkeypatch,
        source,
        {
            "tableName": "bills",
            "detail": "vendor",
            "xMetrics": [{"field": "total", "aggregation": "none"}],
            "yMetrics": [{"field": "days", "aggregation": "avg"}],
        },
        chart_type="scatter",
    )
    assert '"vendor" as name' in sql and 'GROUP BY "vendor"' in sql, sql
    assert 'SUM("total")' in sql, sql  # a raw axis is summed per dot
