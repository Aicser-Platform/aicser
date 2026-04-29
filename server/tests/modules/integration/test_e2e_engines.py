import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

import os
import requests

BASE = os.environ.get('BASE_URL', 'http://localhost:8000')
# Dev auth for integration tests when run via Docker or against live server
AUTH_HEADERS = {"Authorization": "Bearer test-token"}


def test_duckdb_query_with_inline_data():
    # Create a temporary file data source via project API
    ds_payload = {
        'name': 'inline_test_csv',
        'type': 'file',
        'description': 'inline csv for test',
        'config': {},
        'metadata': {},
    }

    # Create project-scoped data source
    r = requests.post(
        f"{BASE}/data/api/organizations/1/projects/1/data-sources",
        json=ds_payload,
        headers=AUTH_HEADERS,
        timeout=10,
    )
    assert r.ok, f"create data source failed: {r.status_code} {r.text}"
    ds = r.json()
    ds_id = ds.get('data_source_id') or ds.get('data_source', {}).get('id') or ds.get('id') or ds.get('name')
    assert ds_id, f"expected data_source id in response: {ds}"

    # Upload inline sample rows to the data source (simulate sample_data persistence)
    sample_rows = [{'id': 1, 'name': 'A', 'value': 10}, {'id': 2, 'name': 'B', 'value': 20}]
    up = requests.put(
        f"{BASE}/data/api/organizations/1/projects/1/data-sources/{ds_id}",
        json={'metadata': {}, 'config': {}, 'sample_data': sample_rows},
        headers=AUTH_HEADERS,
        timeout=10,
    )
    assert up.ok, f"update data source failed: {up.status_code} {up.text}"

    # Run query via multi-engine endpoint (direct SQL preferred for DB, but duckdb should handle file inline)
    payload = {'query': 'SELECT * FROM data', 'data_source_id': ds_id, 'engine': 'duckdb'}
    r2 = requests.post(
        f"{BASE}/data/query/execute",
        json=payload,
        headers=AUTH_HEADERS,
        timeout=20,
    )
    assert r2.ok, f"query execution failed: {r2.status_code} {r2.text}"
    j = r2.json()
    assert j.get('success')
    assert isinstance(j.get('data'), list) and len(j.get('data')) == 2


def test_direct_sql_postgres_integration():
    # Reuse existing test for enterprise connector
    conn_payload = {
        'type': 'postgresql',
        'name': 'test_postgres_auto',
        'host': os.environ.get('TEST_DB_HOST', 'postgres'),
        'port': int(os.environ.get('TEST_DB_PORT', 5432)),
        'database': os.environ.get('TEST_DB', 'aiser_world'),
        'username': os.environ.get('TEST_DB_USER', 'aiser'),
        'password': os.environ.get('TEST_DB_PASS', 'aiser_password'),
    }

    r = requests.post(f"{BASE}/data/enterprise/connections/test", json=conn_payload, timeout=10)
    assert r.ok, f"connection test failed: {r.status_code} {r.text}"

    r2 = requests.post(f"{BASE}/data/enterprise/connections", json=conn_payload, timeout=10)
    assert r2.ok, f"create connection failed: {r2.status_code} {r2.text}"
    conn_info = r2.json()
    connection_id = conn_info.get('connection_id') or conn_info.get('id') or conn_info.get('name')
    assert connection_id

    q = {'query': 'SELECT 1 as v'}
    r3 = requests.post(f"{BASE}/data/enterprise/connections/{connection_id}/query", json=q, timeout=10)
    assert r3.ok, f"execute query failed: {r3.status_code} {r3.text}"
    j = r3.json()
    assert j.get('success')
    assert j.get('data') is not None


