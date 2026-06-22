"""Schema formatting and pruning for CE NL2SQL."""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Set

from src.modules.data.capabilities import is_single_table_source

_STOP_WORDS = frozenset({
    "the", "a", "an", "is", "are", "what", "how", "show", "me", "get",
    "find", "by", "for", "of", "in", "to", "and", "or", "with", "on", "at", "from",
})

_SCHEMA_METADATA_KEYS = frozenset({
    "database", "name", "type", "version", "connection_database", "schemas",
    "columns", "types", "row_count", "rowCount", "inferred_at", "duckdb_tables",
    "duckdb_connection", "statistics", "last_updated",
})

_SCHEMA_SKIP_KEYS = frozenset(_SCHEMA_METADATA_KEYS | {"tables"})


def _extract_tables(schema: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extract tables from normalized, nested, or legacy schema shapes."""
    if not schema:
        return []
    tables: List[Dict[str, Any]] = schema.get("tables") or []
    if isinstance(tables, list) and tables:
        return [t for t in tables if isinstance(t, dict)]

    # Nested: {schema_name: {tables: [...]}}
    for key, value in schema.items():
        if key in _SCHEMA_SKIP_KEYS or not isinstance(value, dict):
            continue
        nested = value.get("tables")
        if isinstance(nested, list):
            for t in nested:
                if isinstance(t, dict):
                    tables.append({**t, "schema": t.get("schema") or key})
            if tables:
                return tables

    # Legacy per-table dict: {table_name: {columns: [...]}}
    for k, v in schema.items():
        if k in _SCHEMA_SKIP_KEYS or not isinstance(v, dict):
            continue
        if "columns" in v or "fields" in v or "rowCount" in v or "row_count" in v:
            tables.append({"name": k, **v})

    # Legacy file upload: root-level columns list (no tables key)
    root_cols = schema.get("columns")
    if isinstance(root_cols, list) and root_cols:
        tables.append({
            "name": "data",
            "columns": root_cols,
            "row_count": schema.get("row_count") or schema.get("rowCount"),
        })

    return tables


def normalize_schema(schema: Any) -> Dict[str, Any]:
    """Parse JSON strings and coerce legacy shapes into {tables: [...]}."""
    if schema is None:
        return {}
    if isinstance(schema, str):
        try:
            schema = json.loads(schema)
        except (json.JSONDecodeError, TypeError):
            return {}
    if not isinstance(schema, dict):
        return {}

    tables = _extract_tables(schema)
    if not tables:
        return dict(schema)

    meta = {k: v for k, v in schema.items() if k in _SCHEMA_METADATA_KEYS and k not in {"columns", "types"}}
    return {**meta, "tables": tables}


def has_usable_schema(schema: Optional[Dict[str, Any]]) -> bool:
    normalized = normalize_schema(schema) if schema else {}
    for t in _extract_tables(normalized):
        if not isinstance(t, dict):
            continue
        cols = t.get("columns", t.get("fields", []))
        if cols:
            return True
    return False


def _score_table(table: Dict[str, Any], query_terms: Set[str]) -> int:
    if not query_terms:
        return 0
    score = 0
    name = (table.get("name") or "").lower()
    if any(term in name for term in query_terms):
        score += 10
    for c in table.get("columns", table.get("fields", [])):
        c_name = (c.get("name", "") if isinstance(c, dict) else str(c)).lower()
        if any(term in c_name for term in query_terms):
            score += 1
    return score


def get_relevant_schema_subset(
    schema: Optional[Dict[str, Any]],
    query: Optional[str],
    *,
    max_tables: int = 12,
    min_tables_to_filter: int = 6,
    data_source_type: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if not schema or not isinstance(schema, dict):
        return schema
    if is_single_table_source(data_source_type):
        return schema

    tables = _extract_tables(schema)
    if not tables:
        return schema
    total_cols = sum(len(t.get("columns", t.get("fields", []))) for t in tables)
    if len(tables) < min_tables_to_filter and total_cols < 60:
        return schema

    query_terms: Set[str] = set()
    if query and query.strip():
        query_terms = {
            t for t in re.split(r"[\s,.\-_?!]+", query.lower())
            if t and len(t) > 2 and t not in _STOP_WORDS
        }

    sorted_tables = sorted(tables, key=lambda t: (-_score_table(t, query_terms), (t.get("name") or "").lower()))
    selected = sorted_tables[:max_tables]
    return {**{k: v for k, v in schema.items() if k in _SCHEMA_METADATA_KEYS}, "tables": selected}


def format_schema_for_llm(
    schema: Optional[Dict[str, Any]],
    *,
    query: Optional[str] = None,
    max_tables: int = 15,
    max_columns_per_table: int = 25,
) -> str:
    if not schema:
        return "Schema: (empty)"

    subset = get_relevant_schema_subset(schema, query, max_tables=max_tables, data_source_type=schema.get("type"))
    tables = _extract_tables(subset or {})
    if not tables:
        return "Schema: (no tables)"

    lines = ["Schema:"]
    conn_db = (schema.get("connection_database") or schema.get("database") or "").strip()
    if conn_db:
        lines.append(f"Database: {conn_db}")

    for table in tables[:max_tables]:
        t_name = table.get("qualified_name") or table.get("name") or "unknown"
        t_schema = (table.get("schema") or "").strip()
        if t_schema and t_schema not in str(t_name):
            t_name = f"{t_schema}.{table.get('name', t_name)}"
        cols = table.get("columns", table.get("fields", []))
        col_parts: List[str] = []
        for c in cols[:max_columns_per_table]:
            if isinstance(c, dict):
                cname = c.get("name", "?")
                ctype = c.get("type") or c.get("data_type") or "unknown"
                col_parts.append(f"{cname} ({ctype})")
            else:
                col_parts.append(str(c))
        lines.append(f"- {t_name}({', '.join(col_parts)})")

    return "\n".join(lines)


def get_schema_for_tables(schema: Optional[Dict[str, Any]], table_names: List[str]) -> Optional[Dict[str, Any]]:
    if not schema or not table_names:
        return schema
    want = {str(n).strip().lower() for n in table_names if str(n).strip()}
    want |= {n.split(".")[-1] for n in want if "." in n}
    selected = []
    for t in _extract_tables(schema):
        name = (t.get("name") or "").strip().lower()
        qual = (t.get("qualified_name") or name).strip().lower()
        if name in want or qual in want:
            selected.append(t)
    if not selected:
        return schema
    return {**{k: v for k, v in schema.items() if k in _SCHEMA_METADATA_KEYS}, "tables": selected}
