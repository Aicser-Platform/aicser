"""Locked filters for embedded analytics (Metabase "locked parameters", Looker user attributes,
Power BI effective identity): a host app asks Aicser for a short-lived embed token for one of its
customers, e.g. {tenant_id: "acme"}. Every query made with that token is rewritten, before it
runs, so each table holding those columns is read through the filter — whatever endpoint the
query came from (widget data, batch refresh, filter dropdown values, field statistics). The
browser never sees or controls the filter. A query that touches no table with the column is
refused rather than run unfiltered: failing closed is the only safe default for customer data.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Mapping, Optional

_FIELD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
_MAX_VALUES = 200


class LockedFilterError(Exception):
    """The query can't be filtered for this embed (shown to the viewer as a plain message)."""


def sanitize(raw: Any) -> List[Dict[str, Any]]:
    """[{field, values}] from the token's locked filters; malformed entries raise ValueError."""
    out: List[Dict[str, Any]] = []
    for item in raw or []:
        if not isinstance(item, Mapping):
            raise ValueError("Each locked filter needs a field and a value.")
        field = str(item.get("field") or "").strip()
        if not _FIELD.match(field):
            raise ValueError(f"Locked filter field {field!r} is not a column name.")
        value = item.get("value", item.get("values"))
        values = list(value) if isinstance(value, (list, tuple)) else [value]
        if not values or len(values) > _MAX_VALUES:
            raise ValueError(f"Locked filter on {field} needs between 1 and {_MAX_VALUES} values.")
        for v in values:
            if not isinstance(v, (str, int, float, bool)):
                raise ValueError(f"Locked filter on {field} takes text, numbers or true/false.")
        out.append({"field": field, "values": values})
    return out


def _predicate(filters: List[Dict[str, Any]], dialect: str) -> str:
    import sqlglot
    from sqlglot import exp

    parts = []
    for f in filters:
        col = exp.column(f["field"], quoted=True)
        lits = [exp.Literal.number(v) if isinstance(v, (int, float)) and not isinstance(v, bool)
                else exp.Boolean(this=v) if isinstance(v, bool)
                else exp.Literal.string(str(v)) for v in f["values"]]
        parts.append(col.eq(lits[0]) if len(lits) == 1 else col.isin(*lits))
    cond = parts[0]
    for p in parts[1:]:
        cond = exp.and_(cond, p)
    return cond.sql(dialect=dialect or None)


def _tables_with(schema: Mapping[str, Any], fields: Iterable[str]) -> List[str]:
    """Tables (bare and schema-qualified names) whose columns include every locked field."""
    need = {f.lower() for f in fields}
    names: List[str] = []
    for t in (schema or {}).get("tables") or []:
        if not isinstance(t, Mapping):
            continue
        cols = {str((c or {}).get("name") if isinstance(c, Mapping) else c).lower() for c in t.get("columns") or []}
        if need <= cols:
            name = str(t.get("name") or "").strip()
            if name:
                names.append(name.lower())
                if t.get("schema"):
                    names.append(f"{str(t['schema']).lower()}.{name.lower()}")
    return names


def apply(query: str, data_source: Mapping[str, Any], raw_filters: Any, dialect: str) -> str:
    """Rewrite ``query`` so every table holding the locked columns is filtered; refuse otherwise."""
    filters = sanitize(raw_filters)
    if not filters:
        return query
    try:
        # Loaded only when a locked filter is present; same seam as row security's _apply_sql_rls.
        import importlib

        rewriter = importlib.import_module("ee.modules.data.services.rls_query_rewriter")
        base_table_nodes = rewriter.base_table_nodes
        inject_predicates = rewriter.inject_predicates
        parse_single_read = rewriter.parse_single_read
    except Exception as exc:  # the rewriter ships with the enterprise edition
        raise LockedFilterError("This embed needs row filtering, which this server can't apply.") from exc
    tables = _tables_with(data_source.get("schema") or {}, (f["field"] for f in filters))
    if data_source.get("type") in ("file", "google_sheets") and not tables:
        tables = ["data"]  # single-table uploads are queried as `data`
    if not tables:
        raise LockedFilterError("None of this data has the columns this embed is filtered by.")
    predicate = _predicate(filters, dialect)
    statement = parse_single_read(query, dialect)
    touched = {
        (n.name or "").strip().strip('"').lower() for n in base_table_nodes(statement)
    }
    if not touched & {t.split(".")[-1] for t in tables}:
        raise LockedFilterError("This question reads data that can't be filtered for this embed.")
    return inject_predicates(query, {t: predicate for t in tables}, dialect=dialect, deny_ungoverned=False)
