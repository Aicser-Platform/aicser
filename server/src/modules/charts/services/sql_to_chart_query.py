"""Turn a chart's SQL into a table + fields mapping when the two are exactly equivalent.

Charts pinned from AI chat arrive bound to the chat's SQL. A SQL-bound chart can only be
filtered on columns its SQL outputs and can't be edited field by field. Most chat charts are
simple single-table aggregates ("SUM(amount) by region, last 12 months"), which the structured
chart query expresses exactly, so those become ordinary table + fields charts: fully filterable
and editable like any chart built in the designer.

Only shapes with an exact equivalent are converted: one table, no joins/CTEs/subqueries/unions,
plain columns or date buckets as groupings, SUM/AVG/MIN/MAX/COUNT/COUNT(DISTINCT) of plain
columns as measures, a WHERE that is an AND of simple comparisons, and an optional single ORDER
BY and LIMIT. Anything else returns None and the chart keeps running its SQL.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

_GRAINS = {"day", "week", "month", "quarter", "year", "hour"}
_COMPARISONS = {"EQ": "=", "NEQ": "!=", "GT": ">", "GTE": ">=", "LT": "<", "LTE": "<="}


def _schema_table_name(schema: Dict[str, Any], table: str) -> Optional[str]:
    """The table's name as the data source's schema spells it ("banking.loans" for "loans")."""
    bare = table.split(".")[-1].lower()
    for t in (schema or {}).get("tables") or []:
        name = str(t.get("name") or "")
        if name.split(".")[-1].lower() == bare:
            return name
    return None


def _table_columns(schema: Dict[str, Any], table: str) -> Optional[set]:
    bare = table.split(".")[-1].lower()
    for t in (schema or {}).get("tables") or []:
        name = str(t.get("name") or "")
        if name.split(".")[-1].lower() == bare:
            return {str(c.get("name") or c) for c in (t.get("columns") or []) if (c.get("name") if isinstance(c, dict) else c)}
    return None


def _primary_key(schema: Dict[str, Any], table: str) -> Optional[str]:
    bare = table.split(".")[-1].lower()
    for t in (schema or {}).get("tables") or []:
        if str(t.get("name") or "").split(".")[-1].lower() != bare:
            continue
        for c in t.get("columns") or []:
            if isinstance(c, dict) and (c.get("primary_key") or c.get("is_primary_key") or c.get("pk")):
                return str(c.get("name"))
        pks = t.get("primary_key") or t.get("primary_keys")
        if isinstance(pks, list) and len(pks) == 1:
            return str(pks[0])
        if isinstance(pks, str):
            return pks
        # Any NOT NULL column counts every row just like COUNT(*).
        for c in t.get("columns") or []:
            if isinstance(c, dict) and c.get("nullable") is False:
                return str(c.get("name"))
    return None


def _literal(node: Any) -> Tuple[bool, Any]:
    from sqlglot import exp

    if isinstance(node, exp.Paren):
        node = node.this
    if isinstance(node, exp.Boolean):
        return True, bool(node.this)
    if isinstance(node, exp.Literal):
        if node.is_string:
            return True, node.this
        try:
            num = float(node.this)
            return True, int(num) if num.is_integer() else num
        except ValueError:
            return False, None
    if isinstance(node, exp.Neg) and isinstance(node.this, exp.Literal) and not node.this.is_string:
        ok, v = _literal(node.this)
        return (True, -v) if ok and isinstance(v, (int, float)) else (False, None)
    if isinstance(node, exp.Cast):  # DATE '2024-01-01', CAST('2024-01-01' AS DATE)
        return _literal(node.this)
    return False, None


def _date_bucket(node: Any, columns: set) -> Optional[Tuple[str, str]]:
    """DATE_TRUNC('month', col) (any dialect spelling) → (col, 'month')."""
    from sqlglot import exp

    while isinstance(node, exp.Cast):
        node = node.this
    if isinstance(node, (exp.DateTrunc, exp.TimestampTrunc)):
        col = node.this
        unit = node.args.get("unit")
        unit_name = (unit.name if hasattr(unit, "name") else str(unit or "")).strip("'\"").lower()
        if isinstance(col, exp.Column) and col.name in columns and unit_name in _GRAINS:
            return col.name, unit_name
    return None


def _measure(node: Any, columns: set, columns_key: Optional[Dict[str, str]] = None) -> Optional[Dict[str, Any]]:
    from sqlglot import exp

    columns_key = columns_key or {}
    kinds = [(exp.Sum, "sum"), (exp.Avg, "avg"), (exp.Min, "min"), (exp.Max, "max"), (exp.Count, "count")]
    for cls, agg in kinds:
        if isinstance(node, cls):
            arg = node.this
            if agg == "count" and isinstance(arg, exp.Distinct):
                inner = arg.expressions[0] if arg.expressions else None
                if isinstance(inner, exp.Column) and inner.name in columns:
                    return {"field": inner.name, "aggregation": "distinct_count"}
                return None
            if agg == "count" and (arg is None or isinstance(arg, exp.Star)):
                # COUNT(*) == COUNT(primary key) (a key is never null); without a declared key
                # there's no exact field equivalent, so the chart keeps its SQL.
                key = columns_key.get("pk")
                return {"field": key, "aggregation": "count"} if key else None
            if isinstance(arg, exp.Column) and arg.name in columns:
                return {"field": arg.name, "aggregation": agg}
            return None
    return None


def _where_filters(node: Any, columns: set) -> Optional[List[Dict[str, Any]]]:
    from sqlglot import exp

    if node is None:
        return []
    if isinstance(node, exp.Where):
        node = node.this
    parts: List[Any] = []

    def split(n: Any) -> None:
        if isinstance(n, exp.And):
            split(n.left)
            split(n.right)
        elif isinstance(n, exp.Paren):
            split(n.this)
        else:
            parts.append(n)

    split(node)
    out: List[Dict[str, Any]] = []
    for p in parts:
        op = _COMPARISONS.get(type(p).__name__.upper())
        if op and isinstance(p.left, exp.Column) and p.left.name in columns:
            ok, value = _literal(p.right)
            if not ok:
                return None
            out.append({"field": p.left.name, "operator": op, "value": value})
        elif isinstance(p, exp.In) and isinstance(p.this, exp.Column) and p.this.name in columns:
            values = []
            for v in p.expressions:
                ok, lit = _literal(v)
                if not ok:
                    return None
                values.append(lit)
            out.append({"field": p.this.name, "operator": "in", "value": values})
        elif isinstance(p, exp.Is) and isinstance(p.this, exp.Column) and p.this.name in columns and isinstance(p.expression, exp.Null):
            out.append({"field": p.this.name, "operator": "is_null", "value": None})
        elif (
            isinstance(p, exp.Not)
            and isinstance(p.this, exp.Is)
            and isinstance(p.this.this, exp.Column)
            and p.this.this.name in columns
            and isinstance(p.this.expression, exp.Null)
        ):
            out.append({"field": p.this.this.name, "operator": "is_not_null", "value": None})
        elif isinstance(p, exp.Between) and isinstance(p.this, exp.Column) and p.this.name in columns:
            ok_lo, lo = _literal(p.args.get("low"))
            ok_hi, hi = _literal(p.args.get("high"))
            if not (ok_lo and ok_hi):
                return None
            out.append({"field": p.this.name, "operator": ">=", "value": lo})
            out.append({"field": p.this.name, "operator": "<=", "value": hi})
        else:
            return None
    return out


def structure_sql(sql: str, schema: Dict[str, Any], dialect: str = "duckdb") -> Optional[Dict[str, Any]]:
    """The structured chart query equivalent to `sql`, or None when there isn't an exact one."""
    import sqlglot
    from sqlglot import exp

    try:
        tree = sqlglot.parse_one(sql.strip().rstrip(";"), read=dialect)
    except Exception:
        return None
    if not isinstance(tree, exp.Select) or tree.args.get("with") or tree.args.get("joins"):
        return None
    if tree.args.get("having") or tree.args.get("distinct") or tree.find(exp.Window):
        return None
    source = tree.args.get("from")
    table_node = source.this if source is not None else None
    if not isinstance(table_node, exp.Table):
        return None
    table = table_node.name
    columns = _table_columns(schema, table)
    if not columns:
        return None

    dims: List[Tuple[str, Optional[str], str]] = []  # (column, grain, output name)
    metrics: List[Dict[str, Any]] = []
    for proj in tree.expressions:
        alias = proj.alias_or_name
        inner = proj.this if isinstance(proj, exp.Alias) else proj
        if isinstance(inner, exp.Column):
            if inner.name not in columns:
                return None
            dims.append((inner.name, None, alias))
            continue
        bucket = _date_bucket(inner, columns)
        if bucket:
            dims.append((bucket[0], bucket[1], alias))
            continue
        m = _measure(inner, columns, {"pk": _primary_key(schema, table) or ""})
        if m is None:
            return None
        if alias and alias != m["field"]:
            m["label"] = alias.replace("_", " ").strip().title() if alias.islower() else alias
        metrics.append(m)

    if not metrics or len(dims) > 2 or (len(dims) == 2 and len(metrics) > 1):
        return None
    group = tree.args.get("group")
    group_exprs = list(group.expressions) if group else []
    if dims and len(group_exprs) != len(dims):
        return None
    if not dims and group_exprs:
        return None

    filters = _where_filters(tree.args.get("where"), columns)
    if filters is None:
        return None

    query: Dict[str, Any] = {
        "tableName": _schema_table_name(schema, table) or table,
        "yMetrics": metrics,
        "yMetric": metrics[0]["aggregation"],
        "filters": filters,
        "joins": [],
    }
    if dims:
        query["x"], grain, _ = dims[0]
        if grain:
            query["xGrain"] = grain
        if len(dims) == 2:
            query["groupField"] = query["legend"] = dims[1][0]

    order = tree.args.get("order")
    if order and len(order.expressions) == 1:
        o = order.expressions[0]
        key = o.this
        dim_names = {d[2] for d in dims} | {d[0] for d in dims}
        if isinstance(key, exp.Literal) and not key.is_string:
            pos = int(key.this) - 1
            by = "x" if pos < len(dims) else "y"
        elif isinstance(key, exp.Column) and key.name in dim_names:
            by = "x"
        elif _date_bucket(key, columns):
            by = "x"
        else:
            by = "y"
        query["sortBy"] = by
        query["sortOrder"] = "desc" if o.args.get("desc") else "asc"
    else:
        query["sortBy"] = "x"

    limit = tree.args.get("limit")
    if limit is not None:
        ok, n = _literal(limit.expression if hasattr(limit, "expression") else limit)
        if ok and isinstance(n, int) and n > 0:
            query["limit"] = n
    return query


async def structure_pinned_chart(db: Any, chart_payload: Dict[str, Any], project_id: Any = None) -> Dict[str, Any]:
    """For a chart pinned from AI chat: link its data source when missing (the one project source
    that has the chart's table) and, where exactly equivalent, replace its SQL with table + fields.
    Returns the payload, changed or not. Never raises: a pin always succeeds as before."""
    import logging

    log = logging.getLogger(__name__)
    try:
        options = chart_payload.get("chart_options") or {}
        if not isinstance(options, dict) or options.get("__source") != "ai_chat":
            return chart_payload
        query = dict(chart_payload.get("chart_query") or {})
        sql = str(options.get("sample_sql") or "").strip()
        if not sql and query.get("saved_query_id"):
            from src.modules.charts.services.v2.chart_service import ChartService

            sql = str(await ChartService(db)._load_saved_query_sql(str(query["saved_query_id"])) or "").strip()
        if not sql:
            return chart_payload

        source = await _resolve_source(db, chart_payload.get("data_source_id"), sql, project_id)
        if source is None:
            return chart_payload
        schema = source.schema or {}
        if isinstance(schema.get("schema"), dict):
            schema = schema["schema"]
        structured = structure_sql(sql, schema, _dialect_for(source))
        if not structured:
            if not chart_payload.get("data_source_id"):
                chart_payload["data_source_id"] = str(source.id)
            return chart_payload

        structured["origin_sql"] = sql  # kept so the chart can always be traced to its chat answer
        if query.get("saved_query_id"):
            structured["origin_saved_query_id"] = query["saved_query_id"]
        chart_payload["chart_query"] = structured
        chart_payload["data_source_id"] = str(source.id)
        chart_payload["chart_options"] = {k: v for k, v in options.items() if k not in ("sample_sql",)}
        return chart_payload
    except Exception:
        log.debug("Chat pin structuring skipped", exc_info=True)
        return chart_payload


def _dialect_for(source: Any) -> str:
    db_type = str(getattr(source, "db_type", "") or getattr(source, "type", "") or "").lower()
    for key, dialect in (
        ("postgres", "postgres"), ("mysql", "mysql"), ("mariadb", "mysql"), ("snowflake", "snowflake"),
        ("bigquery", "bigquery"), ("redshift", "redshift"), ("clickhouse", "clickhouse"),
        ("mssql", "tsql"), ("sqlserver", "tsql"),
    ):
        if key in db_type:
            return dialect
    return "duckdb"


async def _resolve_source(db: Any, data_source_id: Any, sql: str, project_id: Any) -> Any:
    """The chart's data source, or — when the pin didn't carry one — the single source in the
    project whose schema has the table the SQL reads."""
    import sqlglot
    from sqlalchemy import select
    from sqlglot import exp

    from src.modules.data.models import DataSource

    if data_source_id:
        return (await db.execute(select(DataSource).where(DataSource.id == str(data_source_id)))).scalar_one_or_none()
    try:
        tables = {t.name.lower() for t in sqlglot.parse_one(sql).find_all(exp.Table)}
    except Exception:
        return None
    if len(tables) != 1 or not project_id:
        return None
    rows = (await db.execute(select(DataSource).where(DataSource.project_id == project_id, DataSource.is_active.isnot(False)))).scalars().all()
    matches = [
        s for s in rows
        if _table_columns((s.schema or {}).get("schema", s.schema or {}) if isinstance(s.schema, dict) else {}, next(iter(tables)))
    ]
    return matches[0] if len(matches) == 1 else None
