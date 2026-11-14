"""Turning off two-step sign-in needs proof beyond the session, with or without a password here."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from src.modules.authentication import service, totp_service


def account(**kw):
    return SimpleNamespace(**{"hashed_password": None, "totp_enabled": True, "totp_secret": "sealed", "totp_backup_codes": ["x"], **kw})


async def disable(user, **kw):
    db = SimpleNamespace(commit=AsyncMock())
    with patch.object(service, "get_user_by_id", AsyncMock(return_value=user)):
        await service.disable_totp(db, "u1", **kw)


@pytest.mark.asyncio
async def test_provider_account_needs_a_code():
    user = account()
    with pytest.raises(ValueError):
        await disable(user)
    assert user.totp_enabled is True


@pytest.mark.asyncio
async def test_provider_account_with_a_right_code():
    user = account()
    with patch.object(totp_service, "decrypt_secret", return_value="s"), patch.object(totp_service, "verify_totp_code", return_value=True):
        await disable(user, code="123456")
    assert user.totp_enabled is False and user.totp_secret is None


@pytest.mark.asyncio
async def test_password_account_still_needs_the_password():
    user = account(hashed_password="h")
    with patch.object(service, "verify_password", return_value=False), pytest.raises(ValueError):
        await disable(user, password="wrong")
    assert user.totp_enabled is True
