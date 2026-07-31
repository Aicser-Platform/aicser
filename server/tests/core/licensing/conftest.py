"""Fixtures for licensing tests."""
import asyncio

import pytest
from src.core.config import get_settings


@pytest.fixture(autouse=True)
def clear_settings_cache():
    """Clear the settings cache before each test so monkeypatch can work."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _dispose_async_engine_pool() -> None:
    # Same fix as tests/modules/charts/test_dashboard_template_integration.py:
    # src.db.session.async_engine is a module-level singleton whose pooled
    # asyncpg connections are bound to the event loop that created them.
    # pytest-asyncio's function-scoped event loop means a fresh loop is used
    # per test, so pooled connections from a previous test must be dropped
    # before test_service.py's DB-backed tests open a new one.
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
def _reset_async_engine_pool_between_tests():
    _dispose_async_engine_pool()
    yield
    _dispose_async_engine_pool()
