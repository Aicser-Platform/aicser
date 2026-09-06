from fastapi import FastAPI
import pytest


def _collect_paths(routes, prefix: str = "") -> set:
    """Flatten registered route paths, including prefixes applied by
    include_router(). Newer FastAPI (0.140+) defers sub-router routes behind
    a fastapi.routing._IncludedRouter wrapper (for lazy/deduped route
    resolution) instead of eagerly flattening them onto app.router.routes
    with a plain .path attribute - this walks that wrapper's original_router
    (applying its own include prefix) recursively so path assertions keep
    working regardless of nesting depth."""
    from fastapi.routing import _IncludedRouter

    paths: set = set()
    for route in routes:
        if isinstance(route, _IncludedRouter):
            sub_prefix = prefix + (route.include_context.prefix or "")
            paths |= _collect_paths(route.original_router.routes, sub_prefix)
        elif hasattr(route, "path"):
            paths.add(prefix + route.path)
    return paths


@pytest.fixture(scope="session")
def app_ai_routes():
    from ee.modules.ai.router import router as ai_router
    from ee.modules.ai.api_streaming import router as ai_streaming_router

    app = FastAPI()
    # Same mounting style as app/core/api.py
    app.include_router(ai_streaming_router, prefix="/ai")
    app.include_router(ai_router, prefix="/ai")
    return app


def test_canonical_analyze_routes_registered(app_ai_routes):
    paths = _collect_paths(app_ai_routes.router.routes)
    assert "/ai/analyze" in paths
    assert "/ai/analyze/resume" in paths


def test_deprecated_chat_analysis_routes_removed(app_ai_routes):
    paths = _collect_paths(app_ai_routes.router.routes)
    assert "/ai/chat" not in paths
    assert "/ai/chat/stream" not in paths
    assert "/ai/analyze/legacy" not in paths
