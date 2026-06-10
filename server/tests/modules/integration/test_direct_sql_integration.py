"""Integration test: direct SQL execution via the enterprise connection API.

This test requires a **live server** (default: http://localhost:8000) and a
reachable PostgreSQL instance.  It is automatically skipped when the server
is not running, so it never blocks the offline unit-test suite.

To run explicitly::

    pytest tests/modules/integration/test_direct_sql_integration.py -v

Environment variables (all optional — defaults match docker-compose.dev.yml):

    BASE_URL           http://localhost:8000
    POSTGRES_DB        aiser_world
    POSTGRES_USER      aiser
    POSTGRES_PASSWORD  aiser_password
    POSTGRES_PORT      5432
    TEST_DB_HOST       postgres
"""
import os

import pytest
import requests

BASE = os.environ.get("BASE_URL", "http://localhost:8000")

# Connection defaults align with docker-compose services used by CI/dev
CONN_DB = os.environ.get("POSTGRES_DB", os.environ.get("TEST_DB", "aiser_world"))
CONN_USER = os.environ.get("POSTGRES_USER", os.environ.get("TEST_DB_USER", "aiser"))
CONN_PASS = os.environ.get("POSTGRES_PASSWORD", os.environ.get("TEST_DB_PASS", "aiser_password"))
CONN_PORT = int(os.environ.get("POSTGRES_PORT", os.environ.get("TEST_DB_PORT", 5432)))
CONN_HOST = os.environ.get("TEST_DB_HOST", "postgres")


def _require_server() -> None:
    """Skip this test if the server is not reachable.

    Checks a lightweight health endpoint before attempting any data-mutating
    calls so that transient network failures don't leave dangling test data.
    """
    try:
        r = requests.get(f"{BASE}/health", timeout=3)
        if not r.ok:
            pytest.skip(f"Server at {BASE} returned {r.status_code} — skipping integration test")
    except requests.exceptions.ConnectionError:
        pytest.skip(f"Server not reachable at {BASE} — skipping integration test")
    except requests.exceptions.Timeout:
        pytest.skip(f"Server at {BASE} timed out — skipping integration test")


def test_direct_sql_integration():
    _require_server()

    conn_payload = {
        "type": "postgresql",
        "name": "test_postgres",
        "host": CONN_HOST,
        "port": CONN_PORT,
        "database": CONN_DB,
        "username": CONN_USER,
        "password": CONN_PASS,
    }

    # 1. Verify the connection parameters are valid
    r = requests.post(
        f"{BASE}/data/enterprise/connections/test",
        json=conn_payload,
        timeout=10,
    )
    assert r.ok, f"Connection test failed: {r.status_code} {r.text}"

    # 2. Persist the connection
    r2 = requests.post(
        f"{BASE}/data/enterprise/connections",
        json=conn_payload,
        timeout=10,
    )
    assert r2.ok, f"Create connection failed: {r2.status_code} {r2.text}"
    conn_info = r2.json()
    connection_id = (
        conn_info.get("connection_id")
        or conn_info.get("id")
        or conn_info.get("name")
    )
    assert connection_id, f"No connection_id in response: {conn_info}"

    # 3. Execute a trivial query to prove the pipeline works end-to-end
    q = {"query": "SELECT 1 AS v"}
    r3 = requests.post(
        f"{BASE}/data/enterprise/connections/{connection_id}/query",
        json=q,
        timeout=10,
    )
    assert r3.ok, f"Execute query failed: {r3.status_code} {r3.text}"
    j = r3.json()
    assert j.get("success"), f"Query did not succeed: {j}"
    assert j.get("data") is not None, f"Response has no 'data' key: {j}"
