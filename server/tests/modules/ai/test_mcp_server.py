"""Aicser MCP server: JSON-RPC protocol handling, API-key auth, origin guard, and tools that
never bypass the caller's own access checks or the pre-execution SQL gate."""

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from ee.modules.mcp_server import router as R
from ee.modules.mcp_server import tools as T

CALLER = T.Caller(user_id="u1", organization_id="o1")


@pytest.fixture()
def app(monkeypatch):
    async def _auth(request):
        return CALLER if request.headers.get("authorization") == "Bearer good" else None

    monkeypatch.setattr(R, "_authenticate", _auth)
    a = FastAPI()
    a.include_router(R.router, prefix="/mcp")
    return a


async def _rpc(app, method, params=None, *, auth="Bearer good", msg_id=1, headers=None):
    body = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if msg_id is not None:
        body["id"] = msg_id
    h = {"authorization": auth, **(headers or {})}
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        return await c.post("/mcp", json=body, headers=h)


@pytest.mark.asyncio
async def test_initialize_negotiates_version_and_advertises_tools(app):
    r = await _rpc(app, "initialize", {"protocolVersion": "2025-03-26"})
    res = r.json()["result"]
    assert res["protocolVersion"] == "2025-03-26"
    assert "tools" in res["capabilities"] and res["serverInfo"]["name"] == "aicser"
    r = await _rpc(app, "initialize", {"protocolVersion": "1999-01-01"})
    assert r.json()["result"]["protocolVersion"] == R.SUPPORTED_VERSIONS[0]


@pytest.mark.asyncio
async def test_tools_list_is_read_only(app):
    tools = (await _rpc(app, "tools/list")).json()["result"]["tools"]
    assert {t["name"] for t in tools} == {
        "list_data_sources", "describe_data_source", "list_metrics", "query_metric", "run_query", "ask",
        "list_models", "score_with_model", "list_decisions", "preview_decision",
    }
    assert all(t["annotations"]["readOnlyHint"] for t in tools)


@pytest.mark.asyncio
async def test_unauthenticated_and_bad_requests(app):
    r = await _rpc(app, "tools/list", auth="Bearer nope")
    assert r.status_code == 401 and "WWW-Authenticate" in r.headers
    assert (await _rpc(app, "notifications/initialized", msg_id=None)).status_code == 202
    assert (await _rpc(app, "no/such")).json()["error"]["code"] == -32601
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.post("/mcp", content=b"{", headers={"content-type": "application/json"})).status_code == 400
        assert (await c.get("/mcp")).status_code == 405


@pytest.mark.asyncio
async def test_cross_site_origin_rejected(app, monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "https://app.aicser.com")
    assert (await _rpc(app, "ping", headers={"origin": "https://evil.example"})).status_code == 403
    assert (await _rpc(app, "ping", headers={"origin": "https://app.aicser.com"})).status_code == 200


@pytest.mark.asyncio
async def test_tool_errors_are_results_not_protocol_errors(app, monkeypatch):
    async def denied(caller, ds_id, *, query):
        raise T.ToolError("You don't have access to this data source.")

    monkeypatch.setattr(T, "_require_access", denied)
    r = await _rpc(app, "tools/call", {"name": "run_query", "arguments": {"data_source_id": "d", "sql": "SELECT 1"}})
    res = r.json()["result"]
    assert res["isError"] and "access" in res["content"][0]["text"]
    r = await _rpc(app, "tools/call", {"name": "drop_everything", "arguments": {}})
    assert r.json()["error"]["code"] == -32602


@pytest.mark.asyncio
async def test_run_query_gated_before_execution(monkeypatch):
    async def ok(caller, ds_id, *, query):
        return {"id": ds_id, "type": "database"}

    monkeypatch.setattr(T, "_require_access", ok)
    import ee.modules.ai.utils.sql_gate as gate

    monkeypatch.setattr(gate, "pre_execution_gate", lambda sql: "placeholder_sql")
    with pytest.raises(T.ToolError, match="refused"):
        await T.run_query(CALLER, {"data_source_id": "d", "sql": "SELECT <col> FROM t"})


@pytest.mark.asyncio
async def test_run_query_executes_as_caller_and_caps_rows(monkeypatch):
    async def ok(caller, ds_id, *, query):
        assert query is True
        return {"id": ds_id, "type": "database"}

    monkeypatch.setattr(T, "_require_access", ok)
    import ee.modules.ai.utils.sql_gate as gate

    monkeypatch.setattr(gate, "pre_execution_gate", lambda sql: None)
    seen = {}

    class _Svc:
        async def execute_query(self, **kw):
            seen.update(kw)
            return {"success": True, "data": [{"x": i} for i in range(5)]}

    import src.modules.data.services.multi_engine_query_service as mq

    monkeypatch.setattr(mq, "get_multi_engine_query_service", lambda: _Svc())
    out = await T.run_query(CALLER, {"data_source_id": "d", "sql": "SELECT x FROM t", "limit": 2})
    assert seen["identity"].user_id == "u1" and seen["identity"].organization_id == "o1"
    assert out["rows"] == [{"x": 0}, {"x": 1}] and out["truncated"] and out["columns"] == ["x"]


@pytest.mark.asyncio
async def test_describe_requires_view_access(monkeypatch):
    import src.modules.data.services.data_source_access_service as acc

    async def no(*a, **k):
        return False

    monkeypatch.setattr(acc.DataSourceAccessService, "can_view", staticmethod(no))
    with pytest.raises(T.ToolError, match="access"):
        await T.describe_data_source(CALLER, {"data_source_id": "d"})


@pytest.mark.asyncio
async def test_ask_is_time_bounded(monkeypatch):
    import asyncio

    import ee.modules.ai.services.analyze_service as svc

    async def slow(*a, **k):
        await asyncio.sleep(5)

    monkeypatch.setattr(svc, "run_analyze_sync", slow)
    monkeypatch.setenv("MCP_ASK_TIMEOUT_S", "0.05")
    with pytest.raises(T.ToolError, match="longer than"):
        await T.ask(CALLER, {"question": "total sales"})
