"""Tests for the require_valid_license FastAPI dependency."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.core.licensing import state as state_module
from src.core.licensing.dependencies import require_valid_license


def _request(method="POST"):
    return SimpleNamespace(method=method)


@pytest.fixture(autouse=True)
def _reset_state():
    state_module.state.update(is_valid=False, features=[])
    yield


@pytest.mark.asyncio
async def test_noop_when_validation_not_required(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: False)
    state_module.state.is_valid = False
    await require_valid_license(_request())  # must not raise


@pytest.mark.asyncio
async def test_passes_when_valid(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.is_valid = True
    await require_valid_license(_request())  # must not raise


@pytest.mark.asyncio
async def test_raises_403_when_invalid(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.is_valid = False
    with pytest.raises(HTTPException) as exc_info:
        await require_valid_license(_request())
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_an_ended_license_can_read_but_not_change_anything(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.update(is_valid=False, license_id="lic-1")
    await require_valid_license(_request("GET"))
    with pytest.raises(HTTPException) as exc_info:
        await require_valid_license(_request("POST"))
    assert "read-only" in exc_info.value.detail


@pytest.mark.asyncio
async def test_no_license_at_all_can_not_even_read(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.update(is_valid=False)
    with pytest.raises(HTTPException):
        await require_valid_license(_request("GET"))


@pytest.mark.asyncio
async def test_the_end_date_holds_even_if_the_license_server_is_blocked(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    state_module.state.update(is_valid=True, license_id="lic-1",
                              expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    with pytest.raises(HTTPException):
        await require_valid_license(_request("POST"))
