"""Tests for shared access control helpers."""

import pytest
from fastapi import HTTPException

from src.shared.access_control import extract_user_id, normalize_uuid, enforce_permission


def test_extract_user_id_from_dict():
    assert extract_user_id({"id": "550e8400-e29b-41d4-a716-446655440000"}) == "550e8400-e29b-41d4-a716-446655440000"


def test_extract_user_id_missing_raises():
    with pytest.raises(HTTPException) as exc:
        extract_user_id({})
    assert exc.value.status_code == 401


def test_normalize_uuid_passthrough():
    uid = "550e8400-e29b-41d4-a716-446655440000"
    assert normalize_uuid(uid) == uid


@pytest.mark.asyncio
async def test_enforce_permission_ce_noop(monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "community")
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)
    # Should not raise in CE mode
    await enforce_permission("user-1", "dashboard:view")
