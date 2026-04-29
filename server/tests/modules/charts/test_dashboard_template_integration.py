import os
import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from jose import jwt as jose_jwt
from sqlalchemy import text

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip(
        "Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.",
        allow_module_level=True,
    )

from src.modules.charts.router import router as charts_router
from src.db.session import get_sync_engine


TEMPLATE_CASES = [
    ("banking_portfolio_overview", "banking"),
    ("insurance_claims_performance", "insurance"),
    ("education_enrollment_health", "education"),
    ("energy_consumption_operations", "energy"),
    ("gov_service_delivery_pulse", "govt_public_services"),
]


def _dispose_async_engine_pool() -> None:
    # Reset pooled asyncpg connections between TestClient-managed event loops.
    from src.db.session import async_engine

    try:
        asyncio.run(async_engine.dispose())
    except RuntimeError:
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(async_engine.dispose())
        finally:
            loop.close()


@pytest.fixture(autouse=True)
def _reset_async_engine_pool_between_cases():
    _dispose_async_engine_pool()
    yield
    _dispose_async_engine_pool()


def _build_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(charts_router, prefix="/charts")
    return app


def _resolve_project_member_context() -> tuple[str, str]:
    engine = get_sync_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text(
                """
                SELECT ur.user_id::text AS user_id, ur.project_id::text AS project_id
                FROM user_roles ur
                WHERE ur.project_id IS NOT NULL
                  AND COALESCE(ur.is_deleted, false) = false
                  AND COALESCE(ur.is_active, true) = true
                LIMIT 1
                """
            )
        ).fetchone()

    if not row:
        pytest.skip("No user_roles project membership found in seeded database")

    return str(row[0]), str(row[1])


def _build_bearer_token(user_id: str) -> str:
    # In development mode, JWTCookieBearer accepts unverified claims fallback.
    return jose_jwt.encode({"sub": user_id, "email": "integration@example.com"}, "dev-secret", algorithm="HS256")


@pytest.mark.parametrize("template_id,expected_domain", TEMPLATE_CASES)
def test_template_catalog_and_create_from_template_flow(template_id: str, expected_domain: str):
    user_id, project_id = _resolve_project_member_context()
    bearer_token = _build_bearer_token(user_id)

    with TestClient(_build_test_app()) as client:
        client.headers.update({"Authorization": f"Bearer {bearer_token}"})

        templates_res = client.get("/charts/dashboards/templates")
        assert templates_res.status_code == 200, f"templates failed: {templates_res.status_code} {templates_res.text}"
        templates_body = templates_res.json()

        assert templates_body.get("success") is True
        templates = templates_body.get("templates") or []
        assert len(templates) >= 5

        template = next((t for t in templates if t.get("id") == template_id), None)
        assert template is not None, f"{template_id} template missing"

        create_payload = {
            "template_id": template_id,
            "project_id": project_id,
            "dashboard_name": f"Integration Template Dashboard ({template_id})",
        }
        create_res = client.post("/charts/dashboards/from-template", json=create_payload)
        assert create_res.status_code == 200, f"create failed for {template_id}: {create_res.status_code} {create_res.text}"

        create_body = create_res.json()
        assert create_body.get("success") is True
        assert create_body.get("template", {}).get("id") == template_id

        data_source = create_body.get("data_source") or {}
        assert data_source.get("id")
        assert data_source.get("domain") == expected_domain

        charts = create_body.get("charts") or []
        sql_pack = create_body.get("sql_pack") or []
        expected_widget_count = len(template.get("widgets") or [])
        assert expected_widget_count > 0
        assert len(charts) == expected_widget_count
        assert len(sql_pack) == expected_widget_count

        dashboard_id = (create_body.get("dashboard") or {}).get("id")
        assert dashboard_id

        delete_res = client.delete(f"/charts/dashboards/{dashboard_id}")
        assert delete_res.status_code in (200, 204), f"cleanup failed for {template_id}: {delete_res.status_code} {delete_res.text}"
