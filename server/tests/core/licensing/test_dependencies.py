"""Tests for the require_valid_license FastAPI dependency."""
import pytest
from fastapi import HTTPException

from src.core.licensing import state as state_module
from src.core.licensing.dependencies import require_valid_license


@pytest.fixture(autouse=True)
def _reset_state():
    state_module.state.update(is_valid=False, features=[])
    yield


@pytest.mark.asyncio
async def test_noop_when_validation_not_required(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: False)
    state_module.state.is_valid = False
    await require_valid_license()  # must not raise


@pytest.mark.asyncio
async def test_passes_when_valid(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.is_valid = True
    await require_valid_license()  # must not raise


@pytest.mark.asyncio
async def test_raises_403_when_invalid(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.is_valid = False
    with pytest.raises(HTTPException) as exc_info:
        await require_valid_license()
    assert exc_info.value.status_code == 403
