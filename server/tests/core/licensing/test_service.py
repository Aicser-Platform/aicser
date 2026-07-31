"""Tests for the licensing orchestration service. Mocks client.activate /
client.validate / verify.verify_entitlement_token — this is pure orchestration
logic, not a re-test of the HTTP or JWT layers (those are covered in Tasks 4-5).
Uses a real Postgres session via src.db.session.async_session, matching how
the rest of this repo's DB-backed tests work (no DB mocking)."""
import datetime as dt
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select

from src.core.licensing import client, service, state as state_module, verify
from src.core.licensing.models import LicenseStateRecord
from src.db.session import async_session


@pytest.fixture(autouse=True)
def _reset_state():
    state_module.state.update(is_valid=False, features=[])
    state_module.state.last_error = None
    state_module.state.last_validated_at = None
    yield


@pytest.fixture(autouse=True)
async def _cleanup_license_state_rows():
    yield
    async with async_session() as db:
        rows = (await db.execute(select(LicenseStateRecord))).scalars().all()
        for row in rows:
            await db.delete(row)
        await db.commit()


def _claims(**overrides):
    now = dt.datetime.now(dt.timezone.utc)
    license_expires_at = now + dt.timedelta(days=365)
    return {
        "license_id": "lic-1",
        "customer_id": "cust-1",
        "edition": "enterprise",
        "max_users": 30,
        "features": ["sso"],
        "instance_id": "inst-1",
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(days=30)).timestamp()),
        "license_expires_at": license_expires_at.isoformat(),
        **overrides,
    }


@pytest.mark.asyncio
async def test_bootstrap_noop_when_not_required(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: False)
    with patch.object(client, "activate", new=AsyncMock()) as mock_activate:
        await service.bootstrap()
    mock_activate.assert_not_called()
    assert state_module.state.is_valid is False


@pytest.mark.asyncio
async def test_bootstrap_first_activation_creates_row_and_updates_state(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "AICSER-ENT-AAAA-BBBB-CCCC-DDDD")

    activate_result = client.ActivationResult(
        entitlement_token="eyJ...",
        expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30),
        license_expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=365),
    )
    with (
        patch.object(client, "activate", new=AsyncMock(return_value=activate_result)) as mock_activate,
        patch.object(verify, "verify_entitlement_token", new=AsyncMock(return_value=_claims())),
    ):
        await service.bootstrap()

    mock_activate.assert_called_once()
    assert state_module.state.is_valid is True
    assert state_module.state.license_id == "lic-1"
    assert state_module.state.customer_id == "cust-1"
    assert state_module.state.max_users == 30
    assert state_module.state.features == ["sso"]

    async with async_session() as db:
        rows = (await db.execute(select(LicenseStateRecord))).scalars().all()
    assert len(rows) == 1
    assert rows[0].license_id == "lic-1"
    assert rows[0].is_valid is True
    assert rows[0].max_users == 30
    assert rows[0].expires_at == activate_result.license_expires_at


@pytest.mark.asyncio
async def test_bootstrap_uses_license_expiry_not_token_expiry(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "AICSER-ENT-AAAA-BBBB-CCCC-DDDD")
    token_expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=60)
    license_expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=365)
    activate_result = client.ActivationResult(
        entitlement_token="eyJ...",
        expires_at=token_expires_at,
        license_expires_at=license_expires_at,
    )

    with (
        patch.object(client, "activate", new=AsyncMock(return_value=activate_result)),
        patch.object(
            verify,
            "verify_entitlement_token",
            new=AsyncMock(
                return_value=_claims(
                    exp=int(token_expires_at.timestamp()),
                    license_expires_at=license_expires_at.isoformat(),
                )
            ),
        ),
    ):
        await service.bootstrap()

    assert state_module.state.expires_at == license_expires_at
    assert state_module.state.expires_at != token_expires_at


@pytest.mark.asyncio
async def test_bootstrap_existing_row_calls_validate_not_activate(monkeypatch):
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    async with async_session() as db:
        db.add(
            LicenseStateRecord(
                instance_id="existing-inst",
                license_id="lic-1",
                entitlement_token="old-token",
                is_valid=True,
            )
        )
        await db.commit()

    validate_result = client.ActivationResult(
        entitlement_token="eyJ-new", expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)
    )
    with (
        patch.object(client, "activate", new=AsyncMock()) as mock_activate,
        patch.object(client, "validate", new=AsyncMock(return_value=validate_result)) as mock_validate,
        patch.object(verify, "verify_entitlement_token", new=AsyncMock(return_value=_claims())),
    ):
        await service.bootstrap()

    mock_activate.assert_not_called()
    mock_validate.assert_called_once()
    assert state_module.state.is_valid is True


@pytest.mark.asyncio
async def test_bootstrap_validate_failure_past_grace_period_persists_invalid_to_row(monkeypatch):
    """Regression: bootstrap()'s failure path used to update only the in-memory
    state, leaving the DB row's is_valid stale at True forever (found by manually
    revoking a real license and restarting — /api/licensing/status correctly
    flipped to invalid, but `SELECT is_valid FROM license_state` still said true)."""
    monkeypatch.setenv("LICENSE_GRACE_PERIOD_DAYS", "3")
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    async with async_session() as db:
        db.add(
            LicenseStateRecord(
                instance_id="existing-inst",
                license_id="lic-1",
                is_valid=True,
                last_validated_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=10),
            )
        )
        await db.commit()

    with patch.object(client, "validate", new=AsyncMock(side_effect=client.LicenseServerError("revoked"))):
        await service.bootstrap()

    assert state_module.state.is_valid is False
    async with async_session() as db:
        rows = (await db.execute(select(LicenseStateRecord))).scalars().all()
    assert len(rows) == 1
    assert rows[0].is_valid is False


@pytest.mark.asyncio
async def test_bootstrap_validate_failure_within_grace_period_keeps_row_valid(monkeypatch):
    """Regression: bootstrap() had no grace-period tolerance at all, unlike
    refresh_once() — any failure at boot (including a plain network blip)
    immediately locked the instance out, defeating the point of
    LICENSE_GRACE_PERIOD_DAYS for the one moment (a restart) it matters most."""
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    recent = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)
    async with async_session() as db:
        db.add(
            LicenseStateRecord(
                instance_id="existing-inst",
                license_id="lic-1",
                customer_id="cust-1",
                features=["sso"],
                is_valid=True,
                last_validated_at=recent,
            )
        )
        await db.commit()

    with patch.object(client, "validate", new=AsyncMock(side_effect=client.LicenseServerError("timeout"))):
        await service.bootstrap()

    # In-memory state starts blank on every restart — the failure path must
    # restore it from the persisted row, not leave the dataclass default.
    assert state_module.state.is_valid is True
    assert state_module.state.customer_id == "cust-1"
    assert state_module.state.features == ["sso"]
    assert state_module.state.last_error == "timeout"

    async with async_session() as db:
        rows = (await db.execute(select(LicenseStateRecord))).scalars().all()
    assert len(rows) == 1
    assert rows[0].is_valid is True


@pytest.mark.asyncio
async def test_bootstrap_first_activation_failure_has_no_grace_period(monkeypatch):
    """A row that was never successfully validated has nothing to be lenient
    about — activation failure must invalidate immediately."""
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "AICSER-ENT-AAAA-BBBB-CCCC-DDDD")

    with patch.object(client, "activate", new=AsyncMock(side_effect=client.LicenseServerError("bad key"))):
        await service.bootstrap()

    assert state_module.state.is_valid is False
    async with async_session() as db:
        rows = (await db.execute(select(LicenseStateRecord))).scalars().all()
    assert len(rows) == 1
    assert rows[0].is_valid is False


@pytest.mark.asyncio
async def test_refresh_once_unreachable_within_grace_period_keeps_valid(monkeypatch):
    state_module.state.update(is_valid=True, license_id="lic-1", customer_id="cust-1", features=[])
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    async with async_session() as db:
        db.add(LicenseStateRecord(instance_id="inst-1", license_id="lic-1", is_valid=True))
        await db.commit()

    with patch.object(client, "validate", new=AsyncMock(side_effect=client.LicenseServerError("timeout"))):
        await service.refresh_once()

    assert state_module.state.is_valid is True
    assert state_module.state.last_error == "timeout"


@pytest.mark.asyncio
async def test_refresh_once_unreachable_past_grace_period_flips_invalid(monkeypatch):
    monkeypatch.setenv("LICENSE_GRACE_PERIOD_DAYS", "3")
    state_module.state.update(is_valid=True, license_id="lic-1", customer_id="cust-1", features=[])
    state_module.state.last_validated_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=4)
    monkeypatch.setattr(state_module.state, "requires_validation", lambda: True)
    async with async_session() as db:
        db.add(LicenseStateRecord(instance_id="inst-1", license_id="lic-1", is_valid=True))
        await db.commit()

    with patch.object(client, "validate", new=AsyncMock(side_effect=client.LicenseServerError("timeout"))):
        await service.refresh_once()

    assert state_module.state.is_valid is False
