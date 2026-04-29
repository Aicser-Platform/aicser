import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

import json
import urllib.parse
from fastapi.testclient import TestClient
from src.main import app
import time


def test_upgrade_and_dashboard_crud():
    # Use FastAPI TestClient (in-process) to avoid network/uvicorn/h11 hangs
    client = TestClient(app)

    # Simulate demo cookie on frontend origin
    user = {"user_id": "6", "username": "admin1", "email": "admin1@aiser.world", "is_verified": False, "is_active": True, "roles": ["member"], "provider": "internal"}
    demo_token = 'demo_token_6_1758623524.282077'
    # Try server-side upgrade via body (handles frontend-scoped cookies)
    r = client.post('/auth/upgrade-demo', json={'demo_token': demo_token, 'user': urllib.parse.quote(json.dumps(user))})
    assert r.status_code == 200, f"upgrade-demo failed: {r.status_code} {r.text}"
    body = r.json()
    assert body.get('upgraded') is True
    access = body.get('access_token')
    assert access, 'no access token returned by upgrade-demo'

    # Set cookie on session to simulate browser
    # TestClient manages cookies automatically
    client.cookies.set('c2c_access_token', access, path='/')
    # Small pause to allow any background tasks (e.g. refresh token persist) to complete
    time.sleep(0.2)

    # Verify whoami
    who = client.get('/auth/whoami')
    assert who.status_code == 200
    whoj = who.json()
    assert whoj.get('authenticated') is True

    # Create dashboard
    dash_payload = {
        "name": "Integration Test Dashboard",
        "description": "Created by automated test",
        "project_id": 1,
        "layout_config": {},
        "theme_config": {"theme": "light"},
        "global_filters": {},
        "refresh_interval": 300,
        "is_public": False,
        "is_template": False,
    }
    create = client.post('/charts/dashboards/', json=dash_payload)
    assert create.status_code == 200, f"create failed: {create.status_code} {create.text}"
    created = create.json()
    dashboard_id = created.get('id')
    assert dashboard_id

    # Get dashboard
    getd = client.get(f'/charts/dashboards/{dashboard_id}')
    assert getd.status_code == 200
    gd = getd.json()
    assert gd.get('id') == dashboard_id

    # Update dashboard
    update_payload = {"name": "Integration Test Dashboard - Updated"}
    upd = client.put(f'/charts/dashboards/{dashboard_id}', json=update_payload)
    assert upd.status_code == 200
    upj = upd.json()
    assert upj.get('name') == update_payload['name']

    # Delete dashboard
    delt = client.delete(f'/charts/dashboards/{dashboard_id}')
    assert delt.status_code == 200
    assert delt.json().get('success') is True

    # Confirm deletion
    confirm = client.get(f'/charts/dashboards/{dashboard_id}')
    assert confirm.status_code == 404


