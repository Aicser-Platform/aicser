"""Tests for GET /api/licensing/status. Uses FastAPI's TestClient directly
against a minimal app mounting just this router, with require_permission
patched to a no-op (RBAC itself is tested elsewhere) — matches how this
repo's other narrow router tests avoid needing a full auth stack."""
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.core.licensing import state as state_module
from src.core.licensing.router import router as licensing_router


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(licensing_router, prefix="/api/licensing")
    return TestClient(app)


def test_status_reports_not_required_by_default(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: False)
    with patch("src.core.licensing.router.require_permission", new=AsyncMock()):
        resp = _make_client().get(
            "/api/licensing/status", headers={"Authorization": "Bearer test-token"}
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["requires_validation"] is False


def test_status_reports_valid_license(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.update(
        is_valid=True, license_id="lic-1", customer_id="cust-1", max_users=30, features=["sso"], expires_at=None
    )
    with patch("src.core.licensing.router.require_permission", new=AsyncMock()):
        resp = _make_client().get(
            "/api/licensing/status", headers={"Authorization": "Bearer test-token"}
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_valid"] is True
    assert body["license_id"] == "lic-1"
    assert body["customer_id"] == "cust-1"
    assert body["max_users"] == 30
    assert body["features"] == ["sso"]
