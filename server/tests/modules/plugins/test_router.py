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
