"""KHQR (CutLuy) billing: webhook signature checks, price/period rules, and the
idempotent plan provisioning shared by the webhook and the checkout redirect."""

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError

from src.db.session import get_async_session
from src.modules.billing.khqr import khqr_provisioning as prov
from src.modules.billing.khqr.cutluy_service import CutLuyService
from src.modules.billing.khqr.router import router as khqr_router
from src.modules.billing.models import OrganizationSubscription, PaymentHistory

SECRET = "whsec_test"
ORG_ID = str(uuid.uuid4())


def _sign(body: bytes, ts: int, secret: str = SECRET) -> str:
    digest = hmac.new(secret.encode(), f"{ts}.".encode() + body, hashlib.sha256).hexdigest()
    return f"t={ts},v1={digest}"


def _payment(**overrides):
    payment = {
        "id": "PUETcMUOKStjZsCb6zAl8kg9fMRGM85x",
        "status": "paid",
        "amount": "25.00",
        "currency": "USD",
        "reference_id": "aicser-pro-monthly-abc",
        "metadata": {"organization_id": ORG_ID, "plan_slug": "pro", "billing_period": "monthly"},
        "approved_at": "2026-07-09T12:03:10.000Z",
    }
    payment.update(overrides)
    return payment


def _db(existing_sub=None, plan=None, flush_error=None):
    """AsyncSession stand-in: first execute() returns the plan, second the org subscription."""
    plan = plan or SimpleNamespace(id=uuid.uuid4(), name="Pro")
    results = [
        MagicMock(scalar_one_or_none=MagicMock(return_value=plan)),
        MagicMock(scalar_one_or_none=MagicMock(return_value=existing_sub)),
    ]
    db = AsyncMock()
    db.add = MagicMock()
    db.execute = AsyncMock(side_effect=results)
    db.flush = AsyncMock(side_effect=flush_error)
    return db, plan


# ── signature ────────────────────────────────────────────────────────────────

def test_signature_valid():
    body = b'{"type":"payment.completed"}'
    ts = int(time.time())
    assert CutLuyService.verify_webhook_signature(body, _sign(body, ts), SECRET)


def test_signature_rejects_tampered_body_wrong_secret_and_stale_timestamp():
    body = b'{"type":"payment.completed"}'
    ts = int(time.time())
    assert not CutLuyService.verify_webhook_signature(body + b" ", _sign(body, ts), SECRET)
    assert not CutLuyService.verify_webhook_signature(body, _sign(body, ts, "other"), SECRET)
    assert not CutLuyService.verify_webhook_signature(body, _sign(body, ts - 301), SECRET)
    assert not CutLuyService.verify_webhook_signature(body, None, SECRET)
    assert not CutLuyService.verify_webhook_signature(body, "garbage", SECRET)


def test_signature_accepts_millisecond_timestamp():
    body = b"{}"
    ts_ms = int(time.time() * 1000)
    assert CutLuyService.verify_webhook_signature(body, _sign(body, ts_ms), SECRET)


# ── pricing / period ─────────────────────────────────────────────────────────

def test_plan_price_only_for_self_serve_plans():
    assert prov.plan_price("pro", "monthly") == Decimal("25.00")
    assert prov.plan_price("team", "yearly") == Decimal("990.00")
    assert prov.plan_price("enterprise", "monthly") is None
    assert prov.plan_price("free", "monthly") is None
    assert prov.plan_price("pro", "weekly") is None


def test_period_stacks_only_on_unexpired_same_khqr_plan():
    now = datetime(2026, 10, 3, tzinfo=timezone.utc)
    plan_id = uuid.uuid4()
    active = SimpleNamespace(provider="khqr", status="active", plan_id=plan_id, ends_at=now + timedelta(days=10))
    assert prov.compute_period_end(active, plan_id, "monthly", now) == datetime(2026, 11, 13, tzinfo=timezone.utc)
    # Different plan, lapsed period, or a Stripe row all start from now.
    assert prov.compute_period_end(active, uuid.uuid4(), "monthly", now) == datetime(2026, 11, 3, tzinfo=timezone.utc)
    lapsed = SimpleNamespace(provider="khqr", status="active", plan_id=plan_id, ends_at=now - timedelta(days=1))
    assert prov.compute_period_end(lapsed, plan_id, "yearly", now) == datetime(2027, 10, 3, tzinfo=timezone.utc)
    stripe = SimpleNamespace(provider="stripe", status="active", plan_id=plan_id, ends_at=now + timedelta(days=10))
    assert prov.compute_period_end(stripe, plan_id, "monthly", now) == datetime(2026, 11, 3, tzinfo=timezone.utc)
    assert prov.compute_period_end(None, plan_id, "monthly", now) == datetime(2026, 11, 3, tzinfo=timezone.utc)


# ── provisioning ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_apply_skips_unpaid_and_underpaid():
    db = AsyncMock()
    assert (await prov.apply_khqr_payment(db, _payment(status="pending")))["reason"] == "not_paid"
    assert (await prov.apply_khqr_payment(db, _payment(amount="1.00")))["reason"] == "amount_mismatch"
    bad_meta = _payment(metadata={"organization_id": ORG_ID, "plan_slug": "enterprise", "billing_period": "monthly"})
    assert (await prov.apply_khqr_payment(db, bad_meta))["reason"] == "invalid_metadata"
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_apply_upgrades_existing_subscription_and_records_payment():
    sub = OrganizationSubscription(
        organization_id=uuid.UUID(ORG_ID),
        plan_id=uuid.uuid4(),
        status="trialing",
        provider="stripe",
        provider_subscription_id="sub_old",
        provider_customer_id="cus_keep",
        trial_ends_at=datetime.now(timezone.utc),
        provider_metadata={"price_id": "price_x"},
    )
    db, plan = _db(existing_sub=sub)

    result = await prov.apply_khqr_payment(db, _payment())

    assert result["applied"] is True
    record = db.add.call_args_list[0].args[0]
    assert isinstance(record, PaymentHistory)
    assert record.provider == "khqr" and record.provider_invoice_id == _payment()["id"]
    assert record.amount == 25.0
    assert sub.plan_id == plan.id and sub.status == "active" and sub.provider == "khqr"
    assert sub.provider_subscription_id is None and sub.trial_ends_at is None
    assert sub.provider_customer_id == "cus_keep"
    assert sub.provider_metadata["auto_renew"] is False and sub.provider_metadata["interval"] == "month"
    assert sub.ends_at > datetime.now(timezone.utc) + timedelta(days=27)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_apply_creates_subscription_when_missing():
    db, plan = _db(existing_sub=None)
    result = await prov.apply_khqr_payment(db, _payment())
    assert result["applied"] is True
    created = db.add.call_args_list[1].args[0]
    assert isinstance(created, OrganizationSubscription)
    assert created.plan_id == plan.id and created.provider == "khqr"


@pytest.mark.asyncio
async def test_apply_is_idempotent_per_payment():
    db, _ = _db(flush_error=IntegrityError("insert", {}, Exception("duplicate")))
    result = await prov.apply_khqr_payment(db, _payment())
    assert result == {"applied": False, "reason": "already_applied", "plan_slug": "pro"}
    db.rollback.assert_awaited_once()
    db.commit.assert_not_awaited()


# ── webhook route ────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(khqr_router)
    app.dependency_overrides[get_async_session] = lambda: AsyncMock()
    with patch.object(CutLuyService, "is_enabled", return_value=True), \
         patch("src.modules.billing.khqr.cutluy_service.settings") as settings:
        settings.CUTLUY_WEBHOOK_SECRET = SECRET
        yield TestClient(app)


def test_webhook_rejects_bad_signature(client):
    body = json.dumps({"type": "payment.completed"}).encode()
    res = client.post("/webhooks/cutluy", content=body, headers={"X-CutLuy-Signature": "t=1,v1=00"})
    assert res.status_code == 400


def test_webhook_ignores_non_completed_events(client):
    body = json.dumps({"id": "evt", "type": "payment.expired", "data": {"payment": {"id": "p1"}}}).encode()
    res = client.post("/webhooks/cutluy", content=body, headers={"X-CutLuy-Signature": _sign(body, int(time.time()))})
    assert res.status_code == 200 and res.json()["result"] == "ignored"


def test_webhook_completed_refetches_payment_and_applies(client):
    body = json.dumps({"id": "evt", "type": "payment.completed", "data": {"payment": {"id": "p1"}}}).encode()
    get_payment = AsyncMock(return_value=_payment(id="p1"))
    apply = AsyncMock(return_value={"applied": True})
    with patch.object(CutLuyService, "get_payment", new=get_payment), \
         patch("src.modules.billing.khqr.router.apply_khqr_payment", new=apply):
        res = client.post("/webhooks/cutluy", content=body, headers={"X-CutLuy-Signature": _sign(body, int(time.time()))})
    assert res.status_code == 200
    get_payment.assert_awaited_once_with("p1")
    assert apply.await_args.args[1]["id"] == "p1"
