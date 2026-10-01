"""SQLAlchemy URLs for cloud warehouses and enterprise databases.

One place turns a saved connection (host, credentials and the engine's own settings such as a
Databricks HTTP path or an Oracle service name) into the URL every step uses: the connection
test, schema discovery and query execution. Queries then run through the same governed path as
PostgreSQL (row / column security rewrite, read-only gate, statement timeout, pooling).
"""

from __future__ import annotations

import json
from typing import Any, Dict, Mapping, Optional
from urllib.parse import quote, quote_plus, urlencode

# Engines whose URL is built here when the source has no explicit uri / connection_string.
URL_TYPES = frozenset({"databricks", "oracle", "trino", "athena", "snowflake", "bigquery", "redshift"})

DEFAULT_PORTS = {"oracle": 1521, "trino": 443, "redshift": 5439, "databricks": 443, "athena": 443, "snowflake": 443}


def _get(cfg: Mapping[str, Any], *keys: str) -> Optional[str]:
    custom = cfg.get("custom_fields") if isinstance(cfg.get("custom_fields"), dict) else {}
    for key in keys:
        for source in (cfg, custom):
            value = source.get(key)
            if value not in (None, ""):
                return str(value).strip()
    return None


def _auth(user: Optional[str], password: Optional[str]) -> str:
    if not user:
        return ""
    return f"{quote_plus(user)}:{quote_plus(password)}@" if password else f"{quote_plus(user)}@"


def _query(params: Dict[str, Optional[str]]) -> str:
    clean = {k: v for k, v in params.items() if v}
    return f"?{urlencode(clean)}" if clean else ""


def build_url(db_type: str, cfg: Mapping[str, Any]) -> str:
    """The SQLAlchemy URL for this engine. Raises ValueError naming the missing setting."""
    t = (db_type or "").lower()
    host = _get(cfg, "host", "hostname", "server_hostname", "account")
    user = _get(cfg, "username", "user")
    password = _get(cfg, "password")
    database = _get(cfg, "database", "db")
    schema = _get(cfg, "schema", "default_schema")
    port = _get(cfg, "port") or DEFAULT_PORTS.get(t)

    if t == "databricks":
        token = _get(cfg, "token", "access_token", "password")
        http_path = _get(cfg, "http_path")
        if not host or not token or not http_path:
            raise ValueError("Databricks needs the server hostname, HTTP path and an access token.")
        host = host.replace("https://", "").rstrip("/")
        return f"databricks://token:{quote_plus(token)}@{host}" + _query(
            {"http_path": http_path, "catalog": _get(cfg, "catalog") or database, "schema": schema}
        )

    if t == "oracle":
        service = _get(cfg, "service_name") or database
        if not host or not service:
            raise ValueError("Oracle needs a host and a service name.")
        return f"oracle+oracledb://{_auth(user, password)}{host}:{port}/" + _query({"service_name": service})

    if t == "trino":
        catalog = _get(cfg, "catalog") or database
        if not host or not catalog:
            raise ValueError("Trino needs a host and a catalog.")
        path = f"/{quote(catalog)}" + (f"/{quote(schema)}" if schema else "")
        tls = str(_get(cfg, "ssl_mode", "http_scheme") or "").lower() not in ("disable", "http")
        return f"trino://{_auth(user, password)}{host}:{port}{path}" + _query({"http_scheme": None if tls else "http"})

    if t == "athena":
        region = _get(cfg, "region", "aws_region")
        staging = _get(cfg, "s3_staging_dir", "output_location")
        if not region or not staging:
            raise ValueError("Athena needs an AWS region and an S3 location for query results.")
        key = _get(cfg, "access_key_id", "accessKey")
        secret = _get(cfg, "secret_access_key", "secretKey")
        auth = f"{quote_plus(key)}:{quote_plus(secret or '')}@" if key else "@"  # none: the server's IAM role
        return f"awsathena+rest://{auth}athena.{region}.amazonaws.com:443/{quote(schema or database or 'default')}" + _query(
            {"s3_staging_dir": staging, "work_group": _get(cfg, "work_group", "workgroup")}
        )

    if t == "snowflake":
        if not host or not user:
            raise ValueError("Snowflake needs an account identifier and a user.")
        account = host.replace("https://", "").replace(".snowflakecomputing.com", "").rstrip("/")
        path = f"/{quote(database)}" + (f"/{quote(schema)}" if schema and database else "") if database else ""
        return f"snowflake://{_auth(user, password)}{account}{path}" + _query(
            {"warehouse": _get(cfg, "warehouse"), "role": _get(cfg, "role")}
        )

    if t == "bigquery":
        project = _get(cfg, "project_id", "project") or host
        if not project:
            raise ValueError("BigQuery needs a Google Cloud project id.")
        dataset = _get(cfg, "dataset") or database
        return f"bigquery://{quote(project)}" + (f"/{quote(dataset)}" if dataset else "")

    if t == "redshift":
        if not host or not database:
            raise ValueError("Redshift needs a host and a database.")
        return f"redshift+redshift_connector://{_auth(user, password)}{host}:{port}/{quote(database)}"

    raise ValueError(f"No URL builder for {db_type}.")


def engine_kwargs(db_type: str, cfg: Mapping[str, Any]) -> Dict[str, Any]:
    """Settings a URL can't carry: BigQuery's service-account key."""
    if (db_type or "").lower() == "bigquery":
        raw = _get(cfg, "credentials_json", "service_account_json")
        if raw:
            try:
                return {"credentials_info": json.loads(raw)}
            except (TypeError, ValueError) as exc:
                raise ValueError("The BigQuery service-account key is not valid JSON.") from exc
    return {}


def ping_sql(db_type: str) -> str:
    return "SELECT 1 FROM DUAL" if (db_type or "").lower() == "oracle" else "SELECT 1"


def sqlglot_dialect(db_type: str) -> Optional[str]:
    return {
        "oracle": "oracle",
        "databricks": "databricks",
        "trino": "trino",
        "athena": "trino",  # Athena engine v3 is Trino
    }.get((db_type or "").lower())
