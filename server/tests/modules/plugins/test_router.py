"""Integration tests for `/api/plugins` endpoints and asset serving (Issues 03 & 04)."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.db.session import get_async_session
from src.modules.plugins.models import PluginEnablement
from src.modules.plugins.registry import registry
from src.modules.plugins.router import auth_scheme, router as plugins_router


@pytest.fixture
def plugin_test_app(tmp_path: Path):
    registry.reset()
    registry._discovered = True

    static_dir = tmp_path / "static"
    static_dir.mkdir(parents=True, exist_ok=True)
    (static_dir / "index.js").write_text("export default { mount() {} };", encoding="utf-8")

    # Outside file for symlink/traversal tests
    secret_file = tmp_path / "outside_secret.txt"
    secret_file.write_text("TOP_SECRET", encoding="utf-8")
    try:
        (static_dir / "escape_link.js").symlink_to(secret_file)
    except OSError:
        pass

    registry.register_manifest_dict(
        {
            "id": "sankey",
            "name": "Sankey Diagram",
            "version": "1.0.0",
            "api_version": "1",
            "default_enabled": True,
            "assets_dir": "static",
            "contributions": [
                {
                    "kind": "visual",
                    "chart_type": "sankey",
                    "label": "Sankey Diagram",
                    "bundle": "index.js",
                }
            ],
        },
        package_dir=tmp_path,
    )

    app = FastAPI()
    app.include_router(plugins_router, prefix="/api/plugins")
    yield app
    registry.reset()


def test_serve_valid_js_asset_with_immutable_cache(plugin_test_app: FastAPI):
    client = TestClient(plugin_test_app)
    resp = client.get("/api/plugins/sankey/assets/1.0.0/index.js")
    assert resp.status_code == 200
    assert "text/javascript" in resp.headers.get("content-type", "")
    assert resp.headers.get("cache-control") == "public, max-age=31536000, immutable"
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert "mount()" in resp.text


def test_serve_asset_version_mismatch_returns_404(plugin_test_app: FastAPI):
    client = TestClient(plugin_test_app)
    resp = client.get("/api/plugins/sankey/assets/9.9.9/index.js")
    assert resp.status_code == 404


def test_serve_asset_path_traversal_and_symlink_blocked(plugin_test_app: FastAPI):
    client = TestClient(plugin_test_app)
    # Encoded traversal attempt
    resp = client.get("/api/plugins/sankey/assets/1.0.0/%2e%2e/outside_secret.txt")
    assert resp.status_code in (403, 404)

    # Symlink escaping root
    resp_link = client.get("/api/plugins/sankey/assets/1.0.0/escape_link.js")
    assert resp_link.status_code in (403, 404)


def test_admin_endpoints_reject_unauthorized_viewer(plugin_test_app: FastAPI):
    mock_db = AsyncMock()
    plugin_test_app.dependency_overrides[get_async_session] = lambda: mock_db
    plugin_test_app.dependency_overrides[auth_scheme] = lambda: {
        "id": "u-viewer",
        "role": "viewer",
    }

    client = TestClient(plugin_test_app)
    resp = client.get("/api/plugins")
    assert resp.status_code == 403

    resp_put = client.put("/api/plugins/sankey/enablement", json={"enabled": False})
    assert resp_put.status_code == 403


def test_admin_endpoints_reject_editor_and_allow_admin(plugin_test_app: FastAPI):
    mock_db = AsyncMock()
    res = MagicMock()
    res.scalars.return_value.all.return_value = []
    res.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = res

    plugin_test_app.dependency_overrides[get_async_session] = lambda: mock_db

    # Editor / standard user role is rejected with 403
    for editor_role in ("user", "editor"):
        plugin_test_app.dependency_overrides[auth_scheme] = lambda r=editor_role: {
            "id": "u-editor",
            "role": r,
        }
        client = TestClient(plugin_test_app)
        resp_get = client.get("/api/plugins")
        assert resp_get.status_code == 403

        resp_put = client.put("/api/plugins/sankey/enablement", json={"enabled": False})
        assert resp_put.status_code == 403

    # Admin role is allowed with 200
    plugin_test_app.dependency_overrides[auth_scheme] = lambda: {
        "id": "u-admin",
        "role": "admin",
    }
    client = TestClient(plugin_test_app)
    resp_admin = client.get("/api/plugins")
    assert resp_admin.status_code == 200


def test_org_scope_header_spoofing_rejected_with_403(plugin_test_app: FastAPI, monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "ee-test-license")

    mock_db = AsyncMock()
    # Mock membership check to return False for org-b
    with patch("src.modules.plugins.router._check_user_org_membership", new=AsyncMock(return_value=False)):
        plugin_test_app.dependency_overrides[get_async_session] = lambda: mock_db
        plugin_test_app.dependency_overrides[auth_scheme] = lambda: {
            "id": "u-org-a",
            "organization_id": "org-a",
            "role": "admin",
        }

        client = TestClient(plugin_test_app)
        # Attempt to spoof org-b via header
        resp = client.get("/api/plugins/active", headers={"X-Organization-Id": "org-b"})
        assert resp.status_code == 403
        assert "not a member" in resp.json()["detail"]


def test_active_endpoint_resolves_default_org_when_not_in_token(plugin_test_app: FastAPI, monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "ee-test-license")

    mock_db = AsyncMock()
    res = MagicMock()
    res.scalars.return_value.all.return_value = []
    res.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = res

    with patch("src.modules.plugins.router._lookup_user_default_org", new=AsyncMock(return_value="org-own-123")):
        plugin_test_app.dependency_overrides[get_async_session] = lambda: mock_db
        plugin_test_app.dependency_overrides[auth_scheme] = lambda: {
            "id": "u-no-org-token",
            "role": "user",
        }

        client = TestClient(plugin_test_app)
        resp = client.get("/api/plugins/active")
        assert resp.status_code == 200
        # Active plugins endpoint returns active plugins for the user's resolved org
        assert "sankey" in resp.json()["active_plugins"]


def test_ce_scope_consistent_with_org_in_token(plugin_test_app: FastAPI, monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "community")
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)

    stored_rows = []
    mock_db = AsyncMock()
    mock_db.add = MagicMock()

    async def fake_execute(stmt):
        res = MagicMock()
        res.scalars.return_value.all.return_value = list(stored_rows)
        res.scalar_one_or_none.return_value = stored_rows[0] if stored_rows else None
        return res

    def fake_add(row):
        stored_rows.clear()
        stored_rows.append(row)

    mock_db.execute.side_effect = fake_execute
    mock_db.add.side_effect = fake_add

    plugin_test_app.dependency_overrides[get_async_session] = lambda: mock_db
    # Token carrying an organization_id in CE mode
    plugin_test_app.dependency_overrides[auth_scheme] = lambda: {
        "id": "u-ce-admin",
        "organization_id": "00000000-0000-0000-0000-000000000001",
        "role": "admin",
    }

    client = TestClient(plugin_test_app)

    # Disable sankey via PUT
    put_resp = client.put("/api/plugins/sankey/enablement", json={"enabled": False})
    assert put_resp.status_code == 200
    assert stored_rows[0].scope_key == "instance"
    assert put_resp.json()["enabled"] is False

    # GET /api/plugins returns disabled
    list_resp = client.get("/api/plugins")
    assert list_resp.status_code == 200
    sankey_item = next(p for p in list_resp.json() if p["id"] == "sankey")
    assert sankey_item["enabled"] is False

    # GET /api/plugins/active returns sankey as disabled
    active_resp = client.get("/api/plugins/active")
    assert active_resp.status_code == 200
    assert "sankey" not in active_resp.json()["active_plugins"]
    assert "sankey" in active_resp.json()["disabled_chart_types"]



def test_admin_enablement_toggle_and_active_endpoint(plugin_test_app: FastAPI):
    stored_rows = []

    mock_db = AsyncMock()
    mock_db.add = MagicMock()

    async def fake_execute(stmt):
        res = MagicMock()
        res.scalars.return_value.all.return_value = list(stored_rows)
        res.scalar_one_or_none.return_value = stored_rows[0] if stored_rows else None
        return res

    def fake_add(row):
        stored_rows.clear()
        stored_rows.append(row)

    mock_db.execute.side_effect = fake_execute
    mock_db.add.side_effect = fake_add

    plugin_test_app.dependency_overrides[get_async_session] = lambda: mock_db
    plugin_test_app.dependency_overrides[auth_scheme] = lambda: {
        "id": "u-admin",
        "role": "admin",
    }

    client = TestClient(plugin_test_app)

    # Initially active
    active_resp = client.get("/api/plugins/active")
    assert active_resp.status_code == 200
    assert "sankey" in active_resp.json()["active_plugins"]

    # Disable sankey
    put_resp = client.put("/api/plugins/sankey/enablement", json={"enabled": False})
    assert put_resp.status_code == 200
    assert put_resp.json()["enabled"] is False
    assert put_resp.json()["active"] is False

    # Now /api/plugins/active reports sankey in disabled_chart_types
    active_after = client.get("/api/plugins/active")
    assert active_after.status_code == 200
    assert "sankey" not in active_after.json()["active_plugins"]
    assert active_after.json()["disabled_chart_types"].get("sankey") == "Sankey Diagram"

    # Unknown plugin returns 404
    not_found = client.put("/api/plugins/unknown_xyz/enablement", json={"enabled": True})
    assert not_found.status_code == 404
