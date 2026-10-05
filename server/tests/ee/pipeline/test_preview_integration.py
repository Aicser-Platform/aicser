import os
import uuid
from unittest.mock import AsyncMock

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_preview_returns_403_when_user_lacks_source_grant(monkeypatch):
    """POST /api/pipelines/preview must deny before reading Bronze data."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from src.db.session import get_async_session
    from src.modules.pipeline.router import router
    from src.modules.pricing import feature_gate

    org_id = "11111111-1111-1111-1111-111111111111"
    source_id = str(uuid.uuid4())
    db = AsyncMock()

    async def fake_get_async_session():
        yield db

    async def allow_lakehouse_feature(user_id, session, requested_organization_id=None):
        return requested_organization_id or org_id

    async def fake_plan_context(organization_id, session):
        return "pro", {"lakehouse": True}

    async def fake_entitlement(organization_id, session, feature):
        return True, ""

    async def deny_source_access(self, user_id, data_source_id):
        return False, "No access permission"

    def fail_if_preview_executes(*args, **kwargs):
        raise AssertionError("preview execution must not run without a source grant")

    monkeypatch.setattr(feature_gate, "get_user_organization_id", allow_lakehouse_feature)
    monkeypatch.setattr(feature_gate, "_resolve_org_plan_context", fake_plan_context)
    monkeypatch.setattr(feature_gate, "org_entitlement", fake_entitlement)
    monkeypatch.setattr(
        "src.modules.pipeline.access.DataSourceRBACService.can_access_data_source",
        deny_source_access,
    )
    monkeypatch.setattr(
        "src.modules.pipeline.transform.executor.preview_transform",
        fail_if_preview_executes,
    )

    app = FastAPI()
    app.dependency_overrides[get_async_session] = fake_get_async_session
    app.include_router(router, prefix="/api")

    with TestClient(app) as client:
        response = client.post(
            "/api/pipelines/preview",
            headers={
                "Authorization": "Bearer test-token",
                "X-Organization-Id": org_id,
            },
            json={
                "yaml": "version: 1\nsteps: []\n",
                "source_asset_id": source_id,
                "limit": 100,
            },
        )

    assert response.status_code == 403
    assert response.json() == {"detail": "access denied"}
    db.execute.assert_not_called()
