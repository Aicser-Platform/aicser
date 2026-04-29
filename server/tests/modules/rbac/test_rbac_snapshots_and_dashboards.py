import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock

# Ensure the JWTCookieBearer dependency is replaced before importing routers
from src.modules.authentication.deps import auth_bearer


class _FakeBearer:
    def __init__(self, *args, **kwargs):
        pass

    async def __call__(self, request):
        return "test-token"


auth_bearer.JWTCookieBearer = lambda *a, **k: _FakeBearer()


from src.modules.queries import api as queries_api
from src.modules.charts import api as charts_api
from src.modules.organizations import api as org_api


@pytest.fixture(scope="session")
def app():
    app = FastAPI()
    app.include_router(queries_api.router)
    app.include_router(charts_api.router)
    app.include_router(org_api.router, prefix="/api/organizations")
    return app


@pytest.fixture(scope="session")
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def mock_jwt():
    # Provide a simple fake bearer that returns a token when called to avoid
    # interfering with the JWTCookieBearer class internals (super() calls).
    class FakeBearer:
        def __init__(self):
            pass

        async def __call__(self, request):
            return "test-token"

    with patch("app.modules.authentication.deps.auth_bearer.JWTCookieBearer", return_value=FakeBearer()):
        yield


def test_create_snapshot_forbidden_on_org_mismatch(client):
    # Mock token decode to indicate user in org 1
    with patch("app.modules.authentication.auth.Auth.decodeJWT", return_value={"id": 10, "organization_id": 1}):
        res = client.post("/api/queries/snapshots", json={"data_source_id": "ds1", "sql": "select 1", "organization_id": 2})
        assert res.status_code == 403


def test_create_snapshot_success(client):
    # Provide mocks for data service and multi-engine
    mocked_ds = {"id": "ds1", "type": "database"}

    async def fake_get_ds(ds_id):
        return mocked_ds

    async def fake_execute_query(sql, ds, engine=None, optimization=True):
        return {"success": True, "data": [{"a": 1}, {"a": 2}], "columns": ["a"], "row_count": 2, "engine": "demo", "execution_time": 10}

    with patch("app.modules.authentication.auth.Auth.decodeJWT", return_value={"id": 10, "organization_id": 1}):
        with patch("app.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id", new=AsyncMock(side_effect=fake_get_ds)):
            with patch("app.modules.data.services.multi_engine_query_service.MultiEngineQueryService.execute_query", new=AsyncMock(side_effect=fake_execute_query)):
                res = client.post("/api/queries/snapshots", json={"data_source_id": "ds1", "sql": "select 1", "organization_id": 1})
                assert res.status_code == 200
                j = res.json()
                assert j.get("success") is True
                assert j.get("row_count") == 2


def test_dashboard_create_requires_auth_and_succeeds(client):
    # Mock user token and create dashboard
    with patch("app.modules.authentication.auth.Auth.decodeJWT", return_value={"id": 11, "organization_id": 1}):
        payload = {"name": "Test Dashboard", "project_id": 1}
        res = client.post("/dashboards/", json=payload)
        assert res.status_code in (200, 201)
        # response should contain created dashboard fields (normalize both shapes)
        j = res.json()
        # created payload may be returned directly or under 'dashboard' key
        created = j if j.get('name') else j.get('dashboard') or {}
        assert created.get("name") == payload["name"]


