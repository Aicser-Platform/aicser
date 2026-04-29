from fastapi import FastAPI
from fastapi.testclient import TestClient
from unittest.mock import patch
import pytest


@pytest.fixture(scope="session")
def app_ai_router():
    # Lightweight app using only the AI router to test auth + handler
    from src.modules.ai.router import router as ai_router

    app = FastAPI()
    app.include_router(ai_router, prefix="/ai")
    return app


@pytest.fixture(scope="session")
def client_ai_router(app_ai_router):
    with TestClient(app_ai_router) as client:
        yield client


def test_echarts_generate_requires_auth(client_ai_router):
    resp = client_ai_router.post("/ai/echarts/generate", json={"query": "sales by month"})
    # Missing bearer token should be unauthorized
    assert resp.status_code in (401, 403)


def test_echarts_generate_success_with_auth(client_ai_router):
    # Patch LLM call to avoid external dependency
    with patch(
        "app.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        return_value={
            "success": True,
            "content": """Here is your chart\n```json\n{\n  \"title\": {\"text\": \"Sales by Month\"},\n  \"xAxis\": {\"type\": \"category\", \"data\":[\"Jan\",\"Feb\"]},\n  \"yAxis\": {\"type\": \"value\"},\n  \"series\": [{\"type\": \"bar\", \"data\": [10,20]}]\n}\n```""",
        },
    ):
        resp = client_ai_router.post(
            "/ai/echarts/generate",
            headers={"Authorization": "Bearer test-token"},
            json={"query": "sales by month", "data_source_id": None},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body.get("success") is True
        assert body.get("echarts_config")
        assert body["echarts_config"]["series"][0]["type"] in ("bar", "line", "scatter")


def test_ai_rate_limit_enforced():
    # Use the full app with middleware
    from src.main import app as full_app

    client = TestClient(full_app)

    # Patch LLM to be fast and deterministic
    with patch(
        "app.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        return_value={
            "success": True,
            "content": """```json\n{\n  \"series\":[{\"type\":\"bar\",\"data\":[]}]\n}\n```""",
        },
    ):
        status_counts = {200: 0, 429: 0}
        # Default limit is 60/min; send a little over
        for _ in range(65):
            r = client.post(
                "/ai/echarts/generate",
                headers={"Authorization": "Bearer test-token"},
                json={"query": "q"},
            )
            if r.status_code in status_counts:
                status_counts[r.status_code] += 1
        # We expect at least one 429 once the limit is exceeded
        assert status_counts[429] >= 1

