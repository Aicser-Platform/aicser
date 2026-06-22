"""Dialect rules for CE NL2SQL prompts (ported from EE sql_dialect_rules subset)."""

from __future__ import annotations

import json
from typing import Any, Dict, Optional

from src.modules.data.capabilities import uses_duckdb_for_execution


def get_db_type_from_data_source(ds: Optional[Dict[str, Any]]) -> str:
    if not ds or not isinstance(ds, dict):
        return "sql"
    top_type = (ds.get("type") or ds.get("source_type") or "").strip().lower()
    top_db = (ds.get("db_type") or "").strip().lower()
    fmt = (ds.get("format") or "").strip().lower()
    if uses_duckdb_for_execution(top_type, fmt):
        return "duckdb"
    if top_db and top_db not in ("database", "warehouse", "sql", ""):
        return top_db
    if top_type and top_type not in ("database", "warehouse", ""):
        return top_type
    conn = ds.get("connection_config") or ds.get("config") or {}
    if isinstance(conn, str) and conn.strip().startswith("{"):
        try:
            conn = json.loads(conn)
        except Exception:
            conn = {}
    if isinstance(conn, dict):
        conn_type = (conn.get("type") or conn.get("db_type") or "").strip().lower()
        if conn_type and conn_type not in ("database", "warehouse", ""):
            return conn_type
    return top_db or top_type or "sql"


def get_dialect_name_for_prompt(db_type: Optional[str]) -> str:
    if not db_type or not str(db_type).strip():
        return "SQL"
    return str(db_type).strip().upper()


def get_dialect_system_prompt_line(db_type: Optional[str], data_source_type: Optional[str] = None) -> str:
    if not db_type or not str(db_type).strip():
        return "TARGET: Standard SQL. Use only schema table/column names; add LIMIT when appropriate."
    t = str(db_type).strip().lower()
    ds_type = (data_source_type or "").strip().lower()
    if t == "clickhouse":
        return (
            "TARGET DATABASE: ClickHouse only. Generate ONLY ClickHouse-compatible SQL. "
            "Do not add FORMAT clauses. No CTEs (WITH) or window functions. "
            "JOIN ON must use equality (=) only."
        )
    if t == "duckdb":
        if ds_type == "sample_duckdb":
            return "TARGET DATABASE: DuckDB warehouse. Use schema.table from Schema. Double-quote identifiers with spaces."
        return 'TARGET DATABASE: DuckDB. Table "data" for file sources. Double-quote names with spaces.'
    if t in ("postgresql", "postgres"):
        return "TARGET DATABASE: PostgreSQL. Use date_trunc(), COUNT(DISTINCT); add LIMIT when appropriate."
    if t in ("mysql", "mariadb"):
        return "TARGET DATABASE: MySQL. Use DATE_FORMAT; add LIMIT when appropriate."
    if t in ("mssql", "sqlserver", "tsql"):
        return "TARGET DATABASE: SQL Server. Use TOP N instead of LIMIT; bracket identifiers when needed."
    return f"TARGET DATABASE: {get_dialect_name_for_prompt(db_type)}. Use dialect-valid syntax; add LIMIT when appropriate."


_PERF = """
- Select only columns needed for the answer.
- Add LIMIT when the question does not imply a single aggregate.
- Prefer WHERE filters early; use meaningful aggregate aliases.
"""


def get_dialect_rules(db_type: Optional[str], data_source_type: Optional[str] = None) -> str:
    if not db_type:
        db_type = "sql"
    t = str(db_type).strip().lower()
    ds_type = (data_source_type or "").strip().lower()

    if t == "duckdb":
        if ds_type == "sample_duckdb":
            return "TARGET DIALECT: DuckDB warehouse. Use schema.table identifiers.\n" + _PERF
        return (
            "TARGET DIALECT: DuckDB. Quote identifiers with spaces as \"Column Name\". "
            'File sources use FROM "data".\n' + _PERF
        )
    if t == "clickhouse":
        return "TARGET DIALECT: ClickHouse. No WITH/CTE. No window functions. Equi-joins only.\n" + _PERF
    if t in ("postgresql", "postgres"):
        return "TARGET DIALECT: PostgreSQL.\n" + _PERF
    if t in ("mysql", "mariadb"):
        return "TARGET DIALECT: MySQL.\n" + _PERF
    if t in ("mssql", "sqlserver", "tsql"):
        return "TARGET DIALECT: SQL Server (T-SQL). Use TOP instead of LIMIT.\n" + _PERF
    return f"TARGET DIALECT: {get_dialect_name_for_prompt(db_type)}.\n" + _PERF
