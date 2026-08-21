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
