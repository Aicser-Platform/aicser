import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from unittest.mock import patch

from src.modules.queries import api as queries_api


@pytest.fixture(scope="session")
def app(mock_auth):
    # Ensure mock_auth is applied before routes are registered so the
    # JWTCookieBearer dependency is replaced for the test app.
    app = FastAPI()
    app.include_router(queries_api.router, prefix="/api/queries")
    # Use FastAPI dependency_overrides to ensure the dependency returns a dict
    # for all routes consistently during tests.
    app.dependency_overrides[queries_api.JWTCookieBearer] = lambda: {"id": 1}
    return app


@pytest.fixture(scope="session")
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session", autouse=True)
def mock_auth():
    with patch("app.modules.queries.api.JWTCookieBearer") as m:
        m.return_value = lambda: {"id": 1}
        yield m


@pytest.fixture(scope="session", autouse=True)
def ensure_test_user():
    # Ensure a test integer user exists in the DB for endpoints expecting integer user_id
    import os
    import psycopg2
    # Use the same DB settings as the backend to ensure tests run against the
    # dev DB used by the application container.
    db_url = os.environ.get('DATABASE_URL') or os.environ.get('DATABASE_URI') or 'postgresql://aiser:aiser_password@aiser-postgres-dev:5432/aiser_world'
    conn = None
    try:
        conn = psycopg2.connect(db_url)
        cur = conn.cursor()
        # Ensure a user exists that maps to legacy id 1. If the users table uses
        # UUID primary keys (migration state), attempt to find a user with
        # legacy_id = 1 or by email; otherwise insert a UUID user with legacy_id=1.
        cur.execute("SELECT id FROM users WHERE legacy_id = 1 LIMIT 1;")
        row = cur.fetchone()
        if row:
            user_id = row[0]
        else:
            cur.execute("SELECT id FROM users WHERE email = %s LIMIT 1;", ('test-user@example.com',))
            row2 = cur.fetchone()
            if row2:
                user_id = row2[0]
            else:
                # Insert a new user with legacy_id=1. Omit the `id` column so the
                # database can assign the appropriate primary key type (integer
                # or UUID) depending on migration state. After insert, query the
                # assigned id so we can use it as `created_by` for projects.
                # Insert legacy user id in a DB-agnostic way: perform a conditional
                # insert only if no user with legacy_id=1 or the test email exists.
                cur.execute(
                    "INSERT INTO users (legacy_id, email, username, password, created_at, updated_at)"
                    " SELECT %s, %s, %s, %s, NOW(), NOW()"
                    " WHERE NOT EXISTS (SELECT 1 FROM users WHERE legacy_id = %s OR email = %s);",
                    (1, 'test-user@example.com', 'testuser', 'temp', 1, 'test-user@example.com'),
                )
                # fetch the assigned id (could be int or uuid)
                cur.execute("SELECT id FROM users WHERE legacy_id = %s OR email = %s LIMIT 1;", (1, 'test-user@example.com'))
                row_new = cur.fetchone()
                user_id = row_new[0] if row_new else None

        # Also ensure organization/default project rows used by other code paths
        cur.execute("INSERT INTO organizations (id, name, slug, is_active, created_at, updated_at) VALUES (1, 'Aiser', 'aiser', true, NOW(), NOW()) ON CONFLICT (id) DO NOTHING;")
        # Use parameterized insert for project.created_by but resolve created_by
        # via a subselect so we insert the canonical users.id (UUID or int) that
        # matches our legacy_id/email. This avoids type mismatch during migration.
        try:
            cur.execute(
                "INSERT INTO projects (id, name, description, organization_id, created_by, is_active, created_at, updated_at)"
                " SELECT 1, %s, %s, 1, u.id, true, NOW(), NOW() FROM (SELECT id FROM users WHERE legacy_id = %s OR email = %s LIMIT 1) u"
                " WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = 1);",
                ('Default', 'Default project', 1, 'test-user@example.com'),
            )
        except Exception:
            # If created_by type mismatches (migration states), insert without created_by
            try:
                cur.execute(
                    "INSERT INTO projects (id, name, description, organization_id, is_active, created_at, updated_at)"
                    " SELECT 1, %s, %s, 1, true, NOW(), NOW()"
                    " WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id = 1);",
                    ('Default', 'Default project'),
                )
            except Exception:
                # If even this fails, ignore and continue; tests may create projects as needed
                pass
        conn.commit()
    finally:
        if conn:
            conn.close()


def test_create_and_list_snapshots(client, monkeypatch):
    # Mock data service and multi_engine
    async def fake_get_data_source_by_id(self, ds_id):
        return {"id": ds_id, "type": "file", "file_path": "/tmp/test.csv", "format": "csv", "sample_data": [{"a":1}], "row_count":1}

    async def fake_execute_query(self, query, ds, engine=None, optimization=True):
        return {"success": True, "data": [{"a":1}], "columns": ["a"], "row_count": 1, "engine": "demo", "execution_time": 0.01}

    monkeypatch.setattr("app.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id", fake_get_data_source_by_id, raising=False)
    monkeypatch.setattr("app.modules.data.services.multi_engine_query_service.MultiEngineQueryService.execute_query", fake_execute_query, raising=False)

    # Create snapshot
    res = client.post("/api/queries/snapshots", json={"data_source_id": "demo_ds", "sql": "SELECT 1", "name": "snap1", "preview_rows": 10})
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert "snapshot_id" in body

    # List snapshots
    res2 = client.get("/api/queries/snapshots")
    assert res2.status_code == 200
    j = res2.json()
    assert j["success"] is True
    assert isinstance(j["items"], list)


