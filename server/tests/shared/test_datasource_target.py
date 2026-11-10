"""Database data sources on SaaS may only reach public hosts (src/shared/datasource_target.py)."""

import socket

import pytest

from src.shared import datasource_target as dt


@pytest.fixture(autouse=True)
def saas(monkeypatch):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    monkeypatch.delenv("AISER_ALLOW_PRIVATE_DATASOURCE_HOSTS", raising=False)


@pytest.fixture
def dns(monkeypatch):
    """Fake resolver: name -> list of IPs (missing name = resolution failure)."""
    table = {}

    class _Loop:
        async def getaddrinfo(self, host, port):
            if host not in table:
                raise socket.gaierror("no such host")
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0)) for ip in table[host]]

    monkeypatch.setattr(dt.asyncio, "get_running_loop", lambda: _Loop())
    return table


@pytest.mark.parametrize("host", [
    "127.0.0.1", "localhost", "10.0.0.5", "172.16.3.4", "192.168.1.10", "169.254.169.254",
    "100.64.0.1", "0.0.0.0", "::1", "fd12:25a0:98ee:1::5", "[fd12::1]", "::ffff:127.0.0.1",
    "postgres", "redis", "clickhouse", "postgres.railway.internal", "db.cluster.local", "x.localhost",
])
async def test_internal_hosts_refused(host):
    assert await dt.datasource_target_refusal({"host": host}, "postgresql") == dt.REFUSED


async def test_empty_host_refused_for_postgres():
    # An empty host used to fall back to the platform's own database (POSTGRES_SERVER).
    assert await dt.datasource_target_refusal({"host": "", "database": "x"}, "postgresql") == dt.MISSING_HOST
    assert await dt.datasource_target_refusal({}, "mysql") == dt.MISSING_HOST


async def test_public_host_allowed(dns):
    dns["db.customer.com"] = ["8.8.8.8"]
    assert await dt.datasource_target_refusal({"host": "db.customer.com"}, "postgresql") is None
    assert await dt.datasource_target_refusal({"host": "8.8.8.8"}, "mysql") is None


async def test_public_name_resolving_inward_refused(dns):
    dns["evil.example.com"] = ["10.1.2.3"]
    assert await dt.datasource_target_refusal({"host": "evil.example.com"}, "postgresql") == dt.REFUSED


async def test_any_inward_address_in_answer_refused(dns):
    dns["mixed.example.com"] = ["8.8.8.8", "127.0.0.1"]
    assert await dt.datasource_target_refusal({"host": "mixed.example.com"}, "postgresql") == dt.REFUSED


async def test_unresolvable_host_refused(dns):
    reason = await dt.datasource_target_refusal({"host": "nope.example.com"}, "postgresql")
    assert reason and reason.startswith("Could not resolve")


@pytest.mark.parametrize("config", [
    {"uri": "postgresql://u:p@postgres.railway.internal:5432/railway"},
    {"connection_string": "postgresql+psycopg2://u:p@10.0.0.9/db"},
    {"connection_string": "jdbc:postgresql://localhost:5432/db"},
    {"uri": "postgresql://u:p@8.8.8.8/db?host=127.0.0.1"},
    {"uri": "mongodb://8.8.8.8:27017,10.0.0.2:27017/db"},
    {"connection_string": "host=postgres dbname=railway user=postgres"},
    {"uri": "postgresql://u:p@[::1]:5432/db"},
    {"custom_fields": {"host": "127.0.0.1"}},
    {"host": "8.8.8.8", "uri": "postgresql://u:p@localhost/db"},
])
async def test_hosts_inside_uris_and_custom_fields_checked(config):
    assert await dt.datasource_target_refusal(config, "postgresql") == dt.REFUSED


async def test_uri_without_host_is_missing_host():
    # postgresql:///db connects to the local socket.
    assert await dt.datasource_target_refusal({"uri": "postgresql:///db"}, "postgresql") == dt.MISSING_HOST


@pytest.mark.parametrize("kind", ["csv", "file", "sample_duckdb", "api", None])  # duckdb: see test_security_hardening
async def test_non_network_sources_not_checked(kind):
    assert await dt.datasource_target_refusal({"host": "localhost"}, kind) is None


async def test_database_source_without_engine_still_checked():
    # Seen in production: type=database, db_type='', host=postgres.
    config, kind = dt.config_of_data_source(
        {"type": "database", "db_type": "", "connection_config": {"host": "postgres"}}
    )
    assert kind == "database"
    assert await dt.datasource_target_refusal(config, kind) == dt.REFUSED
    # No engine and no host: nothing to reach over the network, so not refused here.
    assert await dt.datasource_target_refusal({}, "database") is None


async def test_snowflake_without_host_allowed():
    assert await dt.datasource_target_refusal({"account": "xy12345"}, "snowflake") is None


async def test_self_host_allows_private(monkeypatch):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    assert await dt.datasource_target_refusal({"host": "10.0.0.5"}, "postgresql") is None


async def test_override_allows_private_on_saas(monkeypatch):
    monkeypatch.setenv("AISER_ALLOW_PRIVATE_DATASOURCE_HOSTS", "true")
    assert await dt.datasource_target_refusal({"host": "postgres"}, "postgresql") is None


async def test_ensure_raises():
    with pytest.raises(dt.DataSourceTargetRefused):
        await dt.ensure_datasource_target_allowed({"host": "127.0.0.1"}, "postgresql")


def test_config_of_data_source_finds_kind_and_config():
    config, kind = dt.config_of_data_source(
        {"type": "database", "db_type": "postgresql", "connection_config": {"host": "postgres"}}
    )
    assert kind == "postgresql" and config["host"] == "postgres"
    assert dt.config_of_data_source({"type": "file", "format": "csv", "connection_config": {}})[1] is None
    # A Postgres source routed to its lakehouse copy is read from the lake, not the database.
    assert dt.config_of_data_source(
        {"type": "lakehouse_iceberg", "db_type": "postgresql", "connection_config": {"host": "postgres"}}
    )[1] is None


async def test_query_service_refuses_internal_source(monkeypatch):
    from src.modules.data.services.multi_engine_query_service import MultiEngineQueryService

    async def same_source(data_source):
        return data_source

    monkeypatch.setattr("src.modules.data.services.query_routing.resolve_query_source", same_source)
    service = MultiEngineQueryService.__new__(MultiEngineQueryService)  # no engines needed: refused first
    result = await service.execute_query(
        "SELECT 1",
        {"id": "x", "type": "database", "db_type": "postgresql",
         "connection_config": {"host": "postgres.railway.internal", "username": "postgres"}},
    )
    assert result["success"] is False and result["error"] == dt.REFUSED


# ── API data sources ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("url", [
    "http://127.0.0.1:6379/", "http://localhost:8000/admin", "http://169.254.169.254/latest/meta-data",
    "http://10.0.0.5/", "http://postgres:5432/", "http://server.railway.internal/api",
    "http://[::1]/", "file:///etc/passwd", "gopher://8.8.8.8/", "ftp://8.8.8.8/", "not a url",
])
async def test_api_urls_to_internal_targets_refused(url):
    assert await dt.api_url_refusal(url) == dt.REFUSED_URL


async def test_api_url_public_allowed(dns):
    dns["api.example.com"] = ["8.8.8.8"]
    assert await dt.api_url_refusal("https://api.example.com/v1/items?page=2") is None


async def test_api_url_resolving_inward_refused(dns):
    dns["rebind.example.com"] = ["127.0.0.1"]
    assert await dt.api_url_refusal("https://rebind.example.com/") == dt.REFUSED_URL


async def test_api_url_self_host_allowed(monkeypatch):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    assert await dt.api_url_refusal("http://10.0.0.5/") is None


async def test_session_refuses_private_ip_literal():
    async with dt.public_client_session() as session:
        with pytest.raises(dt.DataSourceTargetRefused):
            await session.get("http://127.0.0.1:9/")


async def test_session_resolver_refuses_name_resolving_inward(monkeypatch):
    from aiohttp.resolver import DefaultResolver

    async def inward(self, host, port=0, family=0):
        return [{"hostname": host, "host": "10.1.2.3", "port": port, "family": socket.AF_INET,
                 "proto": 0, "flags": 0}]

    monkeypatch.setattr(DefaultResolver, "resolve", inward)
    async with dt.public_client_session() as session:
        with pytest.raises(Exception) as caught:  # aiohttp may wrap it in ClientConnectorError
            await session.get("http://looks-public.example.com/")
    assert dt.REFUSED_URL in str(caught.value) or isinstance(caught.value, dt.DataSourceTargetRefused)


async def test_session_refuses_redirect_to_metadata_ip(monkeypatch):
    """A public API answering 302 -> http://169.254.169.254/ must not be followed."""
    from aiohttp import web

    async def redirect(_request):
        raise web.HTTPFound("http://169.254.169.254/latest/meta-data/")

    app = web.Application()
    app.router.add_get("/", redirect)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    # Let the test server itself (127.0.0.1) through; everything else keeps the normal rule.
    real = dt._ip_refused
    monkeypatch.setattr(dt, "_ip_refused", lambda ip: str(ip) != "127.0.0.1" and real(ip))
    try:
        async with dt.public_client_session() as session:
            with pytest.raises(dt.DataSourceTargetRefused):
                await session.get(f"http://127.0.0.1:{port}/")
    finally:
        await runner.cleanup()


async def test_create_refuses_postgres_in_type_field():
    # Seen in production: type='postgresql' with no engine in format/db_type (ptest338*).
    from unittest.mock import MagicMock

    from fastapi import HTTPException
    from src.modules.data.services.data_sources_crud import DataSourceCreate, DataSourcesCRUD

    session = MagicMock()  # refused before the session is touched
    request = DataSourceCreate(name="ptest338", type="postgresql", format="",
                               connection_config={"host": "postgres", "username": "postgres"})
    with pytest.raises(HTTPException) as caught:
        await DataSourcesCRUD().create_data_source(request, "u-1", session=session)
    assert caught.value.status_code == 400 and caught.value.detail == dt.REFUSED
    session.add.assert_not_called()
