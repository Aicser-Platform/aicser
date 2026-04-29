import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

import os
import requests

# When running in Docker, hit the live server (same container). Otherwise use BASE_URL from env.
BASE_URL = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
# Auth: JWTCookieBearer accepts "Bearer test-token" in dev and returns user id 1
AUTH_HEADERS = {"Authorization": "Bearer test-token"}


def test_update_data_source_name(monkeypatch):
    # Use live server (works in Docker and locally when server is up); no TestClient/httpx version skew
    # Conftest sets ALLOW_DEV_AUTH_BYPASS / ALLOW_UNVERIFIED_JWT_IN_DEV

    # Create a data source (project-scoped create; response shape may be data_source or data_source_id)
    payload = {
        "name": "update-test",
        "type": "file",
        "description": "created for update test",
        "config": {},
        "metadata": {},
    }
    r = requests.post(
        f"{BASE_URL}/data/api/organizations/1/projects/1/data-sources",
        json=payload,
        headers=AUTH_HEADERS,
        timeout=10,
    )
    assert r.status_code == 200, f"create failed: {r.status_code} {r.text}"
    j = r.json()
    ds = j.get("data_source") or j
    ds_id = ds.get("id") if isinstance(ds, dict) else j.get("data_source_id") or j.get("id")
    assert ds_id, f"expected data_source.id or data_source_id in response: {j}"

    # Update name via PUT (full replace semantics)
    update_payload = {"name": "updated-name"}
    ur = requests.put(
        f"{BASE_URL}/data/api/organizations/1/projects/1/data-sources/{ds_id}",
        json=update_payload,
        headers=AUTH_HEADERS,
        timeout=10,
    )
    assert ur.status_code == 200
    body = ur.json()
    assert body.get("success") is True
    assert body.get("data_source") and body["data_source"]["name"] == "updated-name"

    # Same update via PATCH (partial update; frontend may use PATCH)
    patch_payload = {"name": "patched-name"}
    pr = requests.patch(
        f"{BASE_URL}/data/api/organizations/1/projects/1/data-sources/{ds_id}",
        json=patch_payload,
        headers=AUTH_HEADERS,
        timeout=10,
    )
    assert pr.status_code == 200
    pbody = pr.json()
    assert pbody.get("success") is True
    assert pbody.get("data_source") and pbody["data_source"]["name"] == "patched-name"

