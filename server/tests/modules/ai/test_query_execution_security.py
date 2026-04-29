import pytest
from src.modules.ai.nodes import query_execution_node as qen
from src.modules.ai.nodes.query_execution_node import _execute_clickhouse_http


@pytest.mark.asyncio
async def test_clickhouse_http_does_not_put_credentials_in_query_params(monkeypatch):
    captured_params = []

    class _FakeResponse:
        status = 403

        async def text(self):
            return "forbidden"

    class _FakeRequestContext:
        async def __aenter__(self):
            return _FakeResponse()

        async def __aexit__(self, exc_type, exc, tb):
            return False

    class _FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        def post(self, _url, **kwargs):
            captured_params.append(dict(kwargs.get("params") or {}))
            return _FakeRequestContext()

    monkeypatch.setattr(qen.aiohttp, "ClientSession", _FakeSession)

    data_source = {
        "connection_config": {
            "host": "localhost",
            "port": 8123,
            "database": "analytics",
            "username": "alice",
            "password": "super-secret",
        }
    }
    _ = await _execute_clickhouse_http(
        sql_query="SELECT 1",
        data_source=data_source,
        user_id="u-1",
    )

    assert captured_params
    for params in captured_params:
        assert "user" not in params
        assert "password" not in params

