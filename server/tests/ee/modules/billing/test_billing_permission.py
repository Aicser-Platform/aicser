"""Billing actions are owner-only (org:manage_billing); admins can view (org:view_billing)."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from src.modules.pricing import feature_gate as fg

USER = str(uuid.uuid4())
ORG = str(uuid.uuid4())


def _db(granted: bool):
    db = AsyncMock()
    res = MagicMock()
    res.first.return_value = ("org:view_billing",) if granted else None
    db.execute.return_value = res
    return db


def _sql(db):
    return str(db.execute.await_args.args[0].compile(compile_kwargs={"literal_binds": True}))


@pytest.mark.asyncio
async def test_manage_requires_manage_billing_only():
    db = _db(granted=True)
    with patch.object(fg, "is_self_host_deployment", return_value=False), \
         patch.object(fg, "_user_id_candidates", AsyncMock(return_value=[uuid.UUID(USER)])):
        await fg.require_billing_permission(USER, ORG, db, manage=True)
    sql = _sql(db)
    assert "org:manage_billing" in sql and "org:view_billing" not in sql


@pytest.mark.asyncio
async def test_view_accepts_view_or_manage_billing():
    db = _db(granted=True)
    with patch.object(fg, "is_self_host_deployment", return_value=False), \
         patch.object(fg, "_user_id_candidates", AsyncMock(return_value=[uuid.UUID(USER)])):
        await fg.require_billing_permission(USER, ORG, db, manage=False)
    sql = _sql(db)
    assert "org:manage_billing" in sql and "org:view_billing" in sql


@pytest.mark.asyncio
async def test_member_without_billing_permission_gets_403():
    with patch.object(fg, "is_self_host_deployment", return_value=False), \
         patch.object(fg, "_user_id_candidates", AsyncMock(return_value=[uuid.UUID(USER)])):
        with pytest.raises(HTTPException) as exc:
            await fg.require_billing_permission(USER, ORG, _db(granted=False), manage=True)
    assert exc.value.status_code == 403


@pytest.mark.asyncio
async def test_self_hosted_skips_the_check():
    db = AsyncMock()
    with patch.object(fg, "is_self_host_deployment", return_value=True):
        await fg.require_billing_permission(USER, ORG, db, manage=True)
    db.execute.assert_not_awaited()


def test_admin_role_is_seeded_with_view_billing_not_manage():
    from ee.modules.authentication.rbac.decorators import _ROLE_PERMISSION_PATTERNS

    admin = _ROLE_PERMISSION_PATTERNS["org_admin"]
    assert "org:view_billing" in admin and "org:manage_billing" not in admin
