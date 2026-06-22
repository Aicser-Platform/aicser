"""
Canonical data source type and capability definitions (CE).

Used by multi_engine_query_service, NL2SQL, and schema formatting.
Ported from ee/modules/ai/data_source_capabilities.py for AGPL CE builds.
"""

from typing import Optional, Set, Tuple

DATA_SOURCE_TYPES_SINGLE_TABLE: Set[str] = frozenset({
    "file", "csv", "excel", "xlsx", "xls", "parquet", "json", "tsv",
    "api", "rest_api", "graphql_api",
    "file_storage", "streaming",
    "google_sheets",
})

DATA_SOURCE_TYPES_MULTI_TABLE: Set[str] = frozenset({
    "database", "warehouse",
    "postgresql", "mysql", "clickhouse", "snowflake", "bigquery", "redshift",
    "databricks", "sqlite", "sqlserver", "mssql", "tsql",
    "influxdb", "prometheus_source", "opensearch", "elasticsearch",
})

DATA_SOURCE_TYPES_TIMESERIES: Set[str] = frozenset({
    "influxdb", "prometheus_source",
})

DATA_SOURCE_TYPES_STREAMING: Set[str] = frozenset({
    "kafka_stream", "streaming",
})

DATA_SOURCE_TYPES_SPARK: Set[str] = frozenset({
    "spark_connect", "databricks_connect",
})

DATA_SOURCE_TYPES_LIVE_SCHEMA_FETCH: Set[str] = frozenset({
    "database", "warehouse", "api",
})

DATA_SOURCE_TYPES_DUCKDB_EXECUTION: Set[str] = frozenset({
    "file", "csv", "excel", "xlsx", "xls", "parquet", "json", "tsv",
    "sample_duckdb", "google_sheets",
})

DATA_SOURCE_TYPES_NO_SQL_SCHEMA: Set[str] = frozenset({
    "knowledge_base",
})

DATA_SOURCE_TYPES_CUBE: Set[str] = frozenset({
    "cube", "cubejs", "cube_js",
})

DIALECT_NAMES_SIMPLE: Set[str] = frozenset({"file", "duckdb", "sql"})


def normalize_data_source_type(
    data_source_type: Optional[str],
    db_type: Optional[str] = None,
    format: Optional[str] = None,
) -> Tuple[str, str]:
    t = (data_source_type or "").strip().lower()
    d = (db_type or "").strip().lower()
    f = (format or "").strip().lower()

    if t in DATA_SOURCE_TYPES_DUCKDB_EXECUTION or f in ("csv", "xlsx", "xls", "parquet", "json", "tsv"):
        return (t or "file", "duckdb")

    if t in DATA_SOURCE_TYPES_TIMESERIES or d in DATA_SOURCE_TYPES_TIMESERIES:
        effective = d or t
        return (t or effective, effective)

    if t in DATA_SOURCE_TYPES_STREAMING:
        return (t, d or "clickhouse")

    if t in DATA_SOURCE_TYPES_SPARK:
        return (t, "spark")

    if t in DATA_SOURCE_TYPES_MULTI_TABLE or t in DATA_SOURCE_TYPES_LIVE_SCHEMA_FETCH:
        effective = d or t
        if effective in ("database", "warehouse", ""):
            effective = "postgres"
        return (t, effective)

    if t in DATA_SOURCE_TYPES_SINGLE_TABLE:
        return (t, d or "sql")

    return (t or "sql", d or t or "sql")


def is_single_table_source(data_source_type: Optional[str], db_type: Optional[str] = None) -> bool:
    if not data_source_type and not db_type:
        return False
    t = (data_source_type or "").strip().lower()
    d = (db_type or "").strip().lower()
    if t == "sample_duckdb":
        return False
    if t in DATA_SOURCE_TYPES_SINGLE_TABLE:
        return True
    if d in DIALECT_NAMES_SIMPLE:
        return True
    return False


def is_multi_table_source(data_source_type: Optional[str]) -> bool:
    if not data_source_type:
        return False
    return str(data_source_type).strip().lower() in DATA_SOURCE_TYPES_MULTI_TABLE


def supports_live_schema_fetch(data_source_type: Optional[str]) -> bool:
    if not data_source_type:
        return False
    return str(data_source_type).strip().lower() in DATA_SOURCE_TYPES_LIVE_SCHEMA_FETCH


def uses_duckdb_for_execution(data_source_type: Optional[str], format: Optional[str] = None) -> bool:
    t = (data_source_type or "").strip().lower()
    f = (format or "").strip().lower()
    if t in DATA_SOURCE_TYPES_STREAMING or t in DATA_SOURCE_TYPES_TIMESERIES or t in DATA_SOURCE_TYPES_SPARK:
        return False
    return t in DATA_SOURCE_TYPES_DUCKDB_EXECUTION or f in ("csv", "xlsx", "xls", "parquet", "json", "tsv")


def is_timeseries_source(data_source_type: Optional[str], db_type: Optional[str] = None) -> bool:
    t = (data_source_type or "").strip().lower()
    d = (db_type or "").strip().lower()
    return t in DATA_SOURCE_TYPES_TIMESERIES or d in DATA_SOURCE_TYPES_TIMESERIES


def is_streaming_source(data_source_type: Optional[str]) -> bool:
    return (data_source_type or "").strip().lower() in DATA_SOURCE_TYPES_STREAMING


def is_spark_source(data_source_type: Optional[str]) -> bool:
    return (data_source_type or "").strip().lower() in DATA_SOURCE_TYPES_SPARK


def is_sample_duckdb_warehouse(data_source_type: Optional[str]) -> bool:
    return (data_source_type or "").strip().lower() == "sample_duckdb"


def is_file_upload_duckdb(data_source_type: Optional[str], format: Optional[str] = None) -> bool:
    if is_sample_duckdb_warehouse(data_source_type):
        return False
    return uses_duckdb_for_execution(data_source_type, format)


def has_sql_schema(data_source_type: Optional[str]) -> bool:
    if not data_source_type:
        return True
    return str(data_source_type).strip().lower() not in DATA_SOURCE_TYPES_NO_SQL_SCHEMA


def is_cube_source(data_source_type: Optional[str]) -> bool:
    if not data_source_type:
        return False
    return str(data_source_type).strip().lower() in DATA_SOURCE_TYPES_CUBE


def is_duckdb_or_file_dialect(db_type: Optional[str]) -> bool:
    if not db_type or not str(db_type).strip():
        return True
    return str(db_type).strip().lower() in DIALECT_NAMES_SIMPLE


def needs_schema_qualification(db_type: Optional[str], data_source_type: Optional[str] = None) -> bool:
    t = (data_source_type or "").strip().lower()
    if t == "sample_duckdb":
        return True
    if t in DATA_SOURCE_TYPES_TIMESERIES or t in DATA_SOURCE_TYPES_STREAMING:
        return False
    return not is_duckdb_or_file_dialect(db_type)
