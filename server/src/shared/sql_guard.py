"""What keeps user SQL inside the data it was given, on every engine that takes it.

DuckDB can read files and call out to the network from a plain SELECT, so "read-only" alone says
nothing: read_text('/proc/self/environ') is a read. Two layers, because a blocklist can always miss
a spelling: refuse these calls up front, and turn file access off on the connection itself.
"""

from __future__ import annotations

import re

_REACHES_OUT = (
    "read_text", "read_blob", "read_csv", "read_csv_auto", "read_json", "read_json_auto", "read_json_objects",
    "read_json_objects_auto", "read_ndjson", "read_ndjson_auto", "read_ndjson_objects", "read_parquet",
    "read_xlsx", "parquet_scan", "parquet_metadata", "parquet_schema", "parquet_file_metadata",
    "parquet_kv_metadata", "sniff_csv", "glob", "iceberg_scan", "iceberg_metadata", "iceberg_snapshots",
    "delta_scan", "sqlite_scan", "sqlite_attach", "postgres_scan", "postgres_attach", "postgres_query",
    "postgres_execute", "mysql_scan", "mysql_query", "mysql_execute", "duckdb_secrets", "which_secret",
    "query", "query_table", "pg_read_file", "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "lo_import",
    "lo_export",
)
# Between a name and its bracket: quotes, spaces and whatever is left of a comment.
_CALL = re.compile(r"(?<![\w$])(?:" + "|".join(_REACHES_OUT) + r")(?![\w$])[\s\"`*/]*\(", re.IGNORECASE)
# FROM '/etc/passwd' and FROM "s3://bucket/x.csv": DuckDB treats a quoted path as a table.
_PATH_TABLE = re.compile(r"\b(?:FROM|JOIN)[\s(]+(?:\w+\s*\.\s*)?[\"'][^\"']*[/\\:][^\"']*[\"']", re.IGNORECASE)
_COMMENT = re.compile(r"/\*.*?\*/|--[^\n]*", re.DOTALL)


def reaches_outside(sql: str) -> bool:
    """Whether this SQL calls for files, other databases or secrets rather than its own tables."""
    text = _COMMENT.sub(" ", sql or "")
    return bool(_CALL.search(text) or _PATH_TABLE.search(text))


def lock_duckdb(conn) -> None:
    """After a connection has loaded its data: no files, no network, and no turning that back on."""
    conn.execute("SET enable_external_access = false")
    conn.execute("SET lock_configuration = true")
