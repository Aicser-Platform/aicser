import asyncio
from fastapi import FastAPI
import httpx
from unittest.mock import patch
import pytest


_ECHARTS_LLM_RESULT = {
    "success": True,
    "content": """Here is your chart\n```json\n{\n  \"title\": {\"text\": \"Sales by Month\"},\n  \"xAxis\": {\"type\": \"category\", \"data\":[\"Jan\",\"Feb\"]},\n  \"yAxis\": {\"type\": \"value\"},\n  \"series\": [{\"type\": \"bar\", \"data\": [10,20]}]\n}\n```""",
}


class _InlineASGIClient:
    def __init__(self, app: FastAPI):
        self.app = app

    def post(self, url: str, **kwargs):
        async def _request():
            transport = httpx.ASGITransport(app=self.app)
            async with httpx.AsyncClient(
                transport=transport,
                base_url="http://testserver",
            ) as client:
                return await client.post(url, **kwargs)

        return asyncio.run(_request())


@pytest.fixture(scope="session")
def app_ai_router():
    # Lightweight app using only the AI router to test auth + handler
    from src.modules.ai.router import router as ai_router

    app = FastAPI()
    app.include_router(ai_router, prefix="/ai")
    return app


@pytest.fixture(scope="session")
def client_ai_router(app_ai_router):
    return _InlineASGIClient(app_ai_router)


def test_echarts_generate_requires_auth(client_ai_router):
    resp = client_ai_router.post("/ai/echarts/generate", json={"query": "sales by month"})
    # Missing bearer token should be unauthorized
    assert resp.status_code in (401, 403)


def test_echarts_generate_success_with_auth(client_ai_router):
    # Patch LLM call to avoid external dependency
    with patch(
        "src.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        return_value=_ECHARTS_LLM_RESULT,
    ), patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        return_value=_ECHARTS_LLM_RESULT,
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
    from src.core.middleware import RateLimitMiddleware

    app = FastAPI()

    @app.post("/ai/echarts/generate")
    async def _ok():
        return {"success": True}

    app.add_middleware(RateLimitMiddleware)
    client = _InlineASGIClient(app)

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
