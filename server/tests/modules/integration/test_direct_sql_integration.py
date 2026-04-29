import os
import requests


BASE = os.environ.get('BASE_URL', 'http://localhost:8000')

# Connection defaults align with docker-compose services used by CI/dev
CONN_DB = os.environ.get('POSTGRES_DB', os.environ.get('TEST_DB', 'aiser_world'))
CONN_USER = os.environ.get('POSTGRES_USER', os.environ.get('TEST_DB_USER', 'aiser'))
CONN_PASS = os.environ.get('POSTGRES_PASSWORD', os.environ.get('TEST_DB_PASS', 'aiser_password'))
CONN_PORT = int(os.environ.get('POSTGRES_PORT', os.environ.get('TEST_DB_PORT', 5432)))
CONN_HOST = os.environ.get('TEST_DB_HOST', 'postgres')


def test_direct_sql_integration():
    # Create enterprise connection via API
    conn_payload = {
        'type': 'postgresql',
        'name': 'test_postgres',
        'host': CONN_HOST,
        'port': CONN_PORT,
        'database': CONN_DB,
        'username': CONN_USER,
        'password': CONN_PASS,
    }

    r = requests.post(f"{BASE}/data/enterprise/connections/test", json=conn_payload, timeout=10)
    assert r.ok, f"connection test failed: {r.status_code} {r.text}"

    # Create connection
    r2 = requests.post(f"{BASE}/data/enterprise/connections", json=conn_payload, timeout=10)
    assert r2.ok, f"create connection failed: {r2.status_code} {r2.text}"
    conn_info = r2.json()
    connection_id = conn_info.get('connection_id') or conn_info.get('id') or conn_info.get('name')
    assert connection_id

    # Execute a simple query via enterprise connection endpoint
    q = {'query': 'SELECT 1 as v'}
    r3 = requests.post(f"{BASE}/data/enterprise/connections/{connection_id}/query", json=q, timeout=10)
    assert r3.ok, f"execute query failed: {r3.status_code} {r3.text}"
    j = r3.json()
    assert j.get('success')
    assert j.get('data') is not None


