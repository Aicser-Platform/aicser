import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

import json
import urllib.parse
from fastapi.testclient import TestClient
from src.main import app
import time


def test_profile_update_and_create_data_source():
    client = TestClient(app)

    # Ensure a user record exists in DB for this demo user (internal dev provision)
    user = {
        "user_id": "6",
        "username": "admin1",
        "email": "admin1@aiser.world",
        "is_verified": False,
        "is_active": True,
        "roles": ["member"],
        "provider": "internal",
    }
    prov_payload = {"id": "6", "email": user["email"], "username": user["username"]}
    prov = client.post('/internal/provision-user', json=prov_payload, headers={'X-Internal-Auth': 'dev-internal-secret'})
    assert prov.status_code == 200

    # Use upgrade-demo helper to obtain a dev JWT (enabled in development)
    demo_token = "demo_token_6_1758623524.282077"
    r = client.post("/auth/upgrade-demo", json={"demo_token": demo_token, "user": urllib.parse.quote(json.dumps(user))})
    assert r.status_code == 200
    body = r.json()
    assert body.get("upgraded") is True
    access = body.get("access_token")
    assert access

    client.cookies.set("c2c_access_token", access, path="/")
    time.sleep(0.1)

    # Use the real access_token returned earlier to authenticate subsequent calls
    client.cookies.set("c2c_access_token", access, path='/')

    getp = client.get("/users/profile")
    assert getp.status_code == 200
    profile = getp.json()

    # Update profile (username and first_name)
    update_payload = {"username": "admin-updated", "first_name": "Admin", "last_name": "User"}
    up = client.put("/users/profile", json=update_payload)
    assert up.status_code == 200
    updated = up.json()
    assert updated.get("username") in ("admin-updated",)

    # Create a simple file data source for project 1 to avoid external DB connections
    ds_payload = {
        "name": "Smoke Test File Source",
        "type": "file",
        "description": "Created by smoke test",
        "config": {},
        "metadata": {"created_via": "smoke_test"},
    }

    create = client.post("/data/api/organizations/1/projects/1/data-sources", json=ds_payload)
    assert create.status_code == 200, f"create failed: {create.status_code} {create.text}"
    cbody = create.json()
    assert cbody.get("success") is True
    assert cbody.get("data_source") and cbody["data_source"].get("id")


