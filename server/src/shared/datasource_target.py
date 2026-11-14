"""Where a database data source may connect.

On hosted Aicser (SaaS) the server sits on a private network next to its own database, cache and
services. A data source is someone else's database reached over the internet, so its host must
resolve to a public address: an empty host, ``localhost``, a private or link-local IP, or an
internal service name (``postgres``, ``*.railway.internal``) would let a tenant use this server to
reach the platform's own systems. Self-hosted installs connect to databases on their own network,
so they are not restricted (``AISER_ALLOW_PRIVATE_DATASOURCE_HOSTS=true`` lifts it on SaaS too).

Checked when a source is tested, saved or updated, and again before every query, so a name that
later resolves inward is still refused.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import os
import re
from typing import Any, Iterable, List, Mapping, Optional, Tuple
from urllib.parse import parse_qs, urlsplit

# Engines reached over the network. Anything else (files, uploads, sample DuckDB, APIs) is not
# checked here.
NETWORK_DB_TYPES = frozenset({
    "postgresql", "postgres", "redshift", "mysql", "mariadb", "mssql", "sqlserver", "oracle",
    "clickhouse", "snowflake", "databricks", "trino", "presto", "mongodb", "cockroachdb",
    "timescaledb", "greenplum", "vertica", "elasticsearch", "opensearch", "cassandra", "redis",
    "db2", "teradata", "singlestore", "starrocks", "doris", "druid", "pinot", "hive", "impala",
    "exasol", "questdb", "influxdb", "couchbase", "neo4j",
})
# Engines addressed by host. Others above (snowflake account, databricks workspace) may omit it.
HOST_REQUIRED_TYPES = NETWORK_DB_TYPES - {"snowflake", "databricks"}
# Engines that open a file on this server. On SaaS a tenant has no files here, so a path they type
# can only point at the platform's own files. MotherDuck ("md:…") is a hosted service, not a file.
LOCAL_FILE_DB_TYPES = frozenset({"duckdb", "sqlite"})
LOCAL_FILE_REFUSED = "DuckDB and SQLite files on the server can't be used on hosted Aicser. Upload the file instead."
# data_sources.type values for sources that connect to a database (others: file, lakehouse, api…).
_DATABASE_SOURCE_TYPES = frozenset({"database", "warehouse", "enterprise_connector", "db"})

_HOST_KEYS = ("host", "hostname", "server", "server_hostname", "address", "endpoint", "hosts")
_URI_KEYS = ("uri", "url", "connection_string", "connection_url", "dsn", "jdbc_url", "sqlalchemy_url")
_INTERNAL_SUFFIXES = (".internal", ".local", ".localhost", ".localdomain", ".svc", ".cluster.local", ".lan", ".home.arpa")
_DSN_HOST = re.compile(r"(?:^|\s)host\s*=\s*'?([^\s']+)", re.IGNORECASE)
_RESOLVE_TIMEOUT_SECONDS = 3.0

REFUSED = "This data source must connect to a public database host. Internal and private addresses are not allowed."
MISSING_HOST = "Enter the database host."


class DataSourceTargetRefused(ValueError):
    """Raised by ensure_datasource_target_allowed; the message is safe to show the user."""


def private_targets_allowed() -> bool:
    if os.getenv("AISER_ALLOW_PRIVATE_DATASOURCE_HOSTS", "").strip().lower() in ("1", "true", "yes"):
        return True
    from src.core.deployment_mode import is_saas_deployment

    return not is_saas_deployment()


def _uri_hosts(raw: str) -> List[str]:
    text = raw.strip()
    if not text:
        return []
    if "://" not in text:  # libpq "host=… dbname=…" DSN
        return [m.group(1) for m in _DSN_HOST.finditer(text)]
    if text.lower().startswith("jdbc:"):
        text = text[5:]
    parts = urlsplit(text)
    netloc = parts.netloc.rsplit("@", 1)[-1]
    hosts: List[str] = []
    for item in netloc.split(","):  # mongodb://a:1,b:2
        item = item.strip()
        if not item:
            continue
        if item.startswith("["):  # [ipv6]:port
            hosts.append(item[1:item.find("]")] if "]" in item else item[1:])
        else:
            hosts.append(item.rsplit(":", 1)[0] if item.count(":") == 1 else item)
    query = parse_qs(parts.query)
    for key in ("host", "hostaddr", "server"):  # postgresql://…/db?host=10.0.0.5
        hosts.extend(query.get(key, []))
    return hosts


def _collect_hosts(config: Mapping[str, Any]) -> List[str]:
    hosts: List[str] = []
    for source in (config, config.get("custom_fields") if isinstance(config.get("custom_fields"), Mapping) else {}):
        for key in _HOST_KEYS:
            value = source.get(key)
            if isinstance(value, str) and value.strip():
                hosts.extend(h.strip() for h in value.split(","))
            elif isinstance(value, (list, tuple)):
                hosts.extend(str(h).strip() for h in value if str(h).strip())
        for key in _URI_KEYS:
            value = source.get(key)
            if isinstance(value, str):
                hosts.extend(_uri_hosts(value))
    return [h for h in hosts if h]


def _ip_refused(ip: ipaddress._BaseAddress) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        ip = mapped
    return not ip.is_global or ip.is_multicast


async def _host_refusal(host: str) -> Optional[str]:
    name = host.strip().strip("[]").rstrip(".").lower()
    if not name:
        return MISSING_HOST
    try:
        return REFUSED if _ip_refused(ipaddress.ip_address(name)) else None
    except ValueError:
        pass
    # Public names have a dot; a bare name (postgres, redis, server) is a private network service.
    if "." not in name or name == "localhost" or name.endswith(_INTERNAL_SUFFIXES):
        return REFUSED
    try:
        infos = await asyncio.wait_for(
            asyncio.get_running_loop().getaddrinfo(name, None), timeout=_RESOLVE_TIMEOUT_SECONDS
        )
    except Exception:  # noqa: BLE001 - unresolvable: the connection would fail anyway
        return f"Could not resolve the database host {host!r}."
    if not infos or any(_ip_refused(ipaddress.ip_address(info[4][0].split("%", 1)[0])) for info in infos):
        return REFUSED
    return None


async def datasource_target_refusal(config: Optional[Mapping[str, Any]], db_type: Optional[str] = None) -> Optional[str]:
    """A user-facing reason this connection is not allowed, or None when it may proceed."""
    if private_targets_allowed():
        return None
    config = config or {}
    kind = str(db_type or config.get("db_type") or config.get("type") or "").strip().lower()
    if kind in LOCAL_FILE_DB_TYPES:
        paths = [str(config.get(k) or "").strip() for k in ("database", "path", "file_path", "host")]
        if any(p and not p.lower().startswith("md:") for p in paths) or not any(paths):
            return LOCAL_FILE_REFUSED
        return None
    # A generic database source with no engine recorded is still checked by whatever host it names.
    if kind not in NETWORK_DB_TYPES and kind not in _DATABASE_SOURCE_TYPES:
        return None
    hosts = _collect_hosts(config)
    if not hosts:
        return MISSING_HOST if kind in HOST_REQUIRED_TYPES else None
    for host in hosts:
        reason = await _host_refusal(host)
        if reason:
            return reason
    return None


async def ensure_datasource_target_allowed(config: Optional[Mapping[str, Any]], db_type: Optional[str] = None) -> None:
    reason = await datasource_target_refusal(config, db_type)
    if reason:
        raise DataSourceTargetRefused(reason)


# ── API data sources (HTTP) ──────────────────────────────────────────────────
# The URL is checked before the request; on SaaS the aiohttp session also refuses private addresses
# while connecting (catches DNS that changes after the check) and checks every request it makes,
# which covers redirects and pagination "next" links.


def _http_url_name_refusal(url: str) -> Tuple[Optional[str], Optional[str]]:
    """(reason, hostname) without DNS: scheme, IP literals and internal names."""
    try:
        parts = urlsplit(str(url).strip())
    except ValueError:
        return REFUSED_URL, None
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return REFUSED_URL, None
    name = parts.hostname.rstrip(".").lower()
    try:
        return (REFUSED_URL if _ip_refused(ipaddress.ip_address(name)) else None), None
    except ValueError:
        pass
    if "." not in name or name == "localhost" or name.endswith(_INTERNAL_SUFFIXES):
        return REFUSED_URL, None
    return None, name


REFUSED_URL = "This API source must use a public http(s) address. Internal and private addresses are not allowed."


async def api_url_refusal(url: str) -> Optional[str]:
    """A user-facing reason this API URL may not be fetched (SaaS), or None."""
    if private_targets_allowed():
        return None
    reason, name = _http_url_name_refusal(url)
    if reason or not name:
        return reason
    host_reason = await _host_refusal(name)
    return REFUSED_URL if host_reason == REFUSED else host_reason


async def ensure_api_url_allowed(url: str) -> None:
    reason = await api_url_refusal(url)
    if reason:
        raise DataSourceTargetRefused(reason)


def public_client_session(**kwargs: Any):
    """aiohttp.ClientSession for user-configured URLs. On SaaS it cannot reach private addresses."""
    import aiohttp

    if private_targets_allowed():
        return aiohttp.ClientSession(**kwargs)

    from aiohttp.abc import AbstractResolver
    from aiohttp.resolver import DefaultResolver

    class _PublicOnlyResolver(AbstractResolver):
        def __init__(self) -> None:
            self._inner = DefaultResolver()

        async def resolve(self, host: str, port: int = 0, family: int = 0):
            results = await self._inner.resolve(host, port, family)
            if not results or any(_ip_refused(ipaddress.ip_address(str(r["host"]).split("%", 1)[0])) for r in results):
                raise DataSourceTargetRefused(REFUSED_URL)
            return results

        async def close(self) -> None:
            await self._inner.close()

    async def _check_request(_session, _ctx, params) -> None:
        reason, _ = _http_url_name_refusal(str(params.url))
        if reason:
            raise DataSourceTargetRefused(reason)

    async def _check_redirect(_session, _ctx, params) -> None:
        # on_request_start fires once per request, not per hop: check where each redirect points.
        from yarl import URL

        location = params.response.headers.get("Location") or params.response.headers.get("URI")
        if location:
            reason, _ = _http_url_name_refusal(str(params.response.url.join(URL(location))))
            if reason:
                raise DataSourceTargetRefused(reason)

    trace = aiohttp.TraceConfig()
    trace.on_request_start.append(_check_request)
    trace.on_request_redirect.append(_check_redirect)
    kwargs.setdefault("connector", aiohttp.TCPConnector(resolver=_PublicOnlyResolver()))
    kwargs["trace_configs"] = [*kwargs.get("trace_configs", []), trace]
    return aiohttp.ClientSession(**kwargs)


def config_of_data_source(data_source: Mapping[str, Any]) -> Tuple[dict, Optional[str]]:
    """Decrypted connection settings and engine type of a stored data source (dict form)."""
    raw: Any = None
    for key in ("connection_info", "connection_config", "config", "metadata"):
        if data_source.get(key):
            raw = data_source.get(key)
            break
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    config = dict(raw) if isinstance(raw, Mapping) else {}
    try:
        from src.modules.data.utils.credentials import decrypt_credentials

        config = decrypt_credentials(config)
    except Exception:  # noqa: BLE001 - plain config already
        pass
    # A source routed elsewhere keeps its original db_type (a lakehouse copy of a Postgres source is
    # still db_type=postgresql), so its own type decides whether it is a network database at all.
    source_type = str(data_source.get("type") or "").strip().lower()
    if source_type and source_type not in _DATABASE_SOURCE_TYPES and source_type not in NETWORK_DB_TYPES:
        return config, None
    kinds: Iterable[Any] = (data_source.get("db_type"), config.get("db_type"), config.get("type"),
                            data_source.get("format"), data_source.get("type"))
    kind = next((str(k).lower() for k in kinds
                 if k and (str(k).lower() in NETWORK_DB_TYPES or str(k).lower() in LOCAL_FILE_DB_TYPES)), None)
    if kind is None and source_type in _DATABASE_SOURCE_TYPES:
        kind = source_type  # engine unrecorded: check the hosts it names (dbprobe1 had db_type '')
    return config, kind
