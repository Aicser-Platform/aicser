from fastapi import FastAPI
import pytest


@pytest.fixture(scope="session")
def app_ai_routes():
    from src.modules.ai.router import router as ai_router
    from src.modules.ai.api_streaming import router as ai_streaming_router

    app = FastAPI()
    # Same mounting style as app/core/api.py
    app.include_router(ai_streaming_router, prefix="/ai")
    app.include_router(ai_router, prefix="/ai")
    return app


def test_canonical_analyze_routes_registered(app_ai_routes):
    paths = {route.path for route in app_ai_routes.router.routes}
    assert "/ai/analyze" in paths
    assert "/ai/analyze/resume" in paths


def test_deprecated_chat_analysis_routes_removed(app_ai_routes):
    paths = {route.path for route in app_ai_routes.router.routes}
    assert "/ai/chat" not in paths
    assert "/ai/chat/stream" not in paths
    assert "/ai/analyze/legacy" not in paths
