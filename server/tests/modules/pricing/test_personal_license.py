"""Aicser Personal: one-time desktop license with two years of updates, renewable."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.pricing import personal_license as pl
from src.modules.pricing.plans import PERSONAL_LICENSE


class _Db:
    """Just enough of an AsyncSession for fulfil()."""

    def __init__(self, rows=()):
        self.rows = list(rows)
        self.commit = AsyncMock()
        self.flush = AsyncMock()

    def add(self, obj):
        obj.id = obj.id or uuid.uuid4()
        self.rows.append(obj)

    async def execute(self, _stmt):
        result = MagicMock()
        result.scalars.return_value.all.return_value = list(self.rows)
        return result


USER = str(uuid.uuid4())


def test_price_and_offer():
    assert pl.price("purchase") == Decimal("149.00")
    assert pl.price("renewal") == Decimal("69.00")
    assert PERSONAL_LICENSE["update_years"] == 2 and PERSONAL_LICENSE["tier"] == "personal"


@pytest.mark.asyncio
async def test_purchase_creates_license_with_two_years_of_updates():
    db = _Db()
    with patch.object(pl, "_issue_on_license_server", AsyncMock()) as issue:
        out = await pl.fulfil(db, kind="purchase", user_id=USER, email="a@b.c", provider="stripe",
                              reference="cs_1", amount=Decimal("149"))
    assert out["applied"] is True
    lic = db.rows[0]
    assert lic.devices == PERSONAL_LICENSE["devices"]
    years = (lic.updates_until - datetime.now(timezone.utc)).days / 365
    assert 1.99 < years < 2.01
    assert lic.payments[0]["reference"] == "cs_1"
    issue.assert_awaited_once()
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_underpayment_and_duplicate_are_refused():
    db = _Db()
    out = await pl.fulfil(db, kind="purchase", user_id=USER, email=None, provider="khqr", reference="p1", amount=Decimal("10"))
    assert out == {"applied": False, "reason": "amount_mismatch"}
    existing = SimpleNamespace(id=uuid.uuid4(), payments=[{"reference": "p1"}])
    out = await pl.fulfil(_Db([existing]), kind="purchase", user_id=USER, email=None, provider="khqr",
                          reference="p1", amount=Decimal("149"))
    assert out == {"applied": False, "reason": "duplicate"}


@pytest.mark.asyncio
async def test_renewal_extends_from_later_of_today_and_current_date():
    future = datetime.now(timezone.utc) + timedelta(days=100)
    lic = SimpleNamespace(id=uuid.uuid4(), updates_until=future, payments=[], status="issued", license_id="L1",
                          devices=3, created_at=datetime.now(timezone.utc), activation_key=None)
    with patch.object(pl, "_issue_on_license_server", AsyncMock()), patch.object(pl, "flag_modified"):
        out = await pl.fulfil(_Db([lic]), kind="renewal", user_id=USER, email=None, provider="stripe",
                              reference="cs_2", amount=Decimal("69"), license_ref=str(lic.id))
    assert out["applied"] is True
    assert (lic.updates_until - future).days in (730, 731)

    lapsed = SimpleNamespace(id=uuid.uuid4(), updates_until=datetime.now(timezone.utc) - timedelta(days=400), payments=[],
                             status="issued", license_id="L2", devices=3, created_at=None, activation_key=None)
    with patch.object(pl, "_issue_on_license_server", AsyncMock()), patch.object(pl, "flag_modified"):
        await pl.fulfil(_Db([lapsed]), kind="renewal", user_id=USER, email=None, provider="stripe",
                        reference="cs_3", amount=Decimal("69"), license_ref=str(lapsed.id))
    years = (lapsed.updates_until - datetime.now(timezone.utc)).days / 365
    assert 1.99 < years < 2.01


@pytest.mark.asyncio
async def test_renewal_of_unknown_license_is_refused():
    out = await pl.fulfil(_Db(), kind="renewal", user_id=USER, email=None, provider="stripe",
                          reference="cs_4", amount=Decimal("69"), license_ref=str(uuid.uuid4()))
    assert out == {"applied": False, "reason": "license_not_found"}


@pytest.mark.asyncio
async def test_unconfigured_license_server_keeps_purchase_pending():
    lic = SimpleNamespace(id=uuid.uuid4(), license_id=None, status="pending", last_error=None)
    with patch.object(pl.settings, "LICENSE_ADMIN_TOKEN", ""):
        await pl._issue_on_license_server(lic)
    assert lic.status == "pending" and "not configured" in lic.last_error


@pytest.mark.asyncio
async def test_license_server_issue_stores_encrypted_key():
    lic = SimpleNamespace(id=uuid.uuid4(), license_id=None, status="pending", last_error=None, email="a@b.c",
                          user_id=USER, devices=3, updates_until=datetime.now(timezone.utc) + timedelta(days=730),
                          activation_key=None)
    resp = MagicMock(content=b"{}", raise_for_status=MagicMock())
    resp.json.return_value = {"license_id": "LIC-9", "activation_key": "KEY-123"}
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    with patch.object(pl.settings, "LICENSE_ADMIN_TOKEN", "t"), patch.object(pl.httpx, "AsyncClient", return_value=client), \
         patch("src.modules.data.utils.credentials.encrypt_text", return_value="enc"):
        await pl._issue_on_license_server(lic)
    body = client.post.await_args.kwargs["json"]
    assert body["tier"] == "personal" and body["license_expires_at"] is None and body["max_devices"] == 3
    assert lic.status == "issued" and lic.license_id == "LIC-9" and lic.activation_key == "enc"
