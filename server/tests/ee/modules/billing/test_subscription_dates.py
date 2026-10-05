"""Subscription start/end dates: Stripe sync (checkout + webhooks), KHQR terms, and the
status mapping that decides whether a stored row still grants its plan."""

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.billing.khqr import khqr_provisioning as prov
from src.modules.billing.stripe import subscription_sync as sync
from src.shared.trial_grant import _in_effect

NOW = datetime(2026, 10, 5, 12, tzinfo=timezone.utc)
START = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp())
END = int(datetime(2026, 11, 1, tzinfo=timezone.utc).timestamp())


def _stripe_sub(**overrides):
    sub = {
        "id": "sub_123",
        "status": "active",
        "current_period_start": START,
        "current_period_end": END,
        "trial_end": None,
        "ended_at": None,
        "items": {"data": [{"price": {"id": "price_team_m"}}]},
    }
    sub.update(overrides)
    return sub


def _row():
    return SimpleNamespace(status=None, trial_ends_at=None, period_starts_at=None, ends_at=None)


# ── Stripe dates ─────────────────────────────────────────────────────────────

def test_active_subscription_stores_its_current_period():
    row = _row()
    assert sync.apply_stripe_subscription(row, _stripe_sub(), NOW) == "active"
    assert row.period_starts_at == datetime(2026, 10, 1, tzinfo=timezone.utc)
    assert row.ends_at == datetime(2026, 11, 1, tzinfo=timezone.utc)
    assert _in_effect(row.status, row.ends_at, "stripe", NOW)


def test_period_is_read_from_items_on_newer_stripe_api_versions():
    """API versions from 2025-03-31 dropped current_period_* from the subscription itself."""
    sub = _stripe_sub(current_period_start=None, current_period_end=None,
                      items={"data": [{"price": {"id": "p"}, "current_period_start": START, "current_period_end": END}]})
    row = _row()
    sync.apply_stripe_subscription(row, sub, NOW)
    assert row.period_starts_at == datetime(2026, 10, 1, tzinfo=timezone.utc)
    assert row.ends_at == datetime(2026, 11, 1, tzinfo=timezone.utc)


def test_stripe_trial_keeps_its_trial_end():
    trial_end = int(datetime(2026, 10, 19, tzinfo=timezone.utc).timestamp())
    row = _row()
    assert sync.apply_stripe_subscription(row, _stripe_sub(status="trialing", trial_end=trial_end), NOW) == "trialing"
    assert row.trial_ends_at == datetime(2026, 10, 19, tzinfo=timezone.utc)


@pytest.mark.parametrize("status", ["incomplete", "incomplete_expired", "unpaid", "paused"])
def test_unpaid_stripe_statuses_never_grant_the_plan(status):
    """Not in our enum, and storing them with a future period end kept the plan on."""
    row = _row()
    assert sync.apply_stripe_subscription(row, _stripe_sub(status=status), NOW) == "canceled"
    assert row.ends_at == NOW
    assert not _in_effect(row.status, row.ends_at, "stripe", NOW)


def test_canceled_subscription_ends_when_stripe_ended_it_not_at_period_end():
    ended = int(datetime(2026, 10, 3, tzinfo=timezone.utc).timestamp())
    row = _row()
    sync.apply_stripe_subscription(row, _stripe_sub(status="canceled", ended_at=ended), NOW)
    assert row.ends_at == datetime(2026, 10, 3, tzinfo=timezone.utc)
    assert not _in_effect(row.status, row.ends_at, "stripe", NOW)


def test_price_maps_back_to_its_plan():
    settings = SimpleNamespace(STRIPE_PRICE_PRO_MONTHLY="price_pro_m", STRIPE_PRICE_PRO_YEARLY="",
                               STRIPE_PRICE_TEAM_MONTHLY="price_team_m", STRIPE_PRICE_TEAM_YEARLY="price_team_y")
    with patch.object(sync, "settings", settings):
        assert sync.plan_slug_for_price("price_pro_m") == "pro"
        assert sync.plan_slug_for_price("price_team_y") == "team"
        assert sync.plan_slug_for_price("") is None
        assert sync.plan_slug_for_price("price_unknown") is None


# ── webhooks ─────────────────────────────────────────────────────────────────

def _result(scalar=None, first=None):
    res = MagicMock()
    res.scalar_one_or_none.return_value = scalar
    res.first.return_value = first
    return res


class _StripeObj(dict):
    """dict with attribute access, like stripe.StripeObject."""
    __getattr__ = dict.get


@pytest.mark.asyncio
async def test_plan_changed_in_stripe_portal_updates_the_plan():
    from src.modules.billing.stripe.stripe_webhook_handler import StripeWebhookHandler

    team_id, pro_id = uuid.uuid4(), uuid.uuid4()
    row = SimpleNamespace(organization_id=uuid.uuid4(), plan_id=team_id, provider_metadata={},
                          status="active", trial_ends_at=None, period_starts_at=None, ends_at=None)
    sub = _StripeObj(_stripe_sub(customer="cus_1", cancel_at_period_end=False,
                                 items={"data": [_StripeObj(price=_StripeObj(id="price_pro_m",
                                                                             recurring=_StripeObj(interval="month")))]}))
    db = AsyncMock()
    db.execute.side_effect = [_result(scalar=row), _result(scalar=SimpleNamespace(id=pro_id))]
    with patch.object(sync, "settings", SimpleNamespace(
            STRIPE_PRICE_PRO_MONTHLY="price_pro_m", STRIPE_PRICE_PRO_YEARLY="",
            STRIPE_PRICE_TEAM_MONTHLY="price_team_m", STRIPE_PRICE_TEAM_YEARLY="")):
        await StripeWebhookHandler(db).handle_subscription_updated(sub)

    assert row.plan_id == pro_id
    assert row.ends_at == datetime(2026, 11, 1, tzinfo=timezone.utc)
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_failed_webhook_event_raises_so_stripe_retries():
    from src.modules.billing.stripe.stripe_webhook_handler import StripeWebhookHandler

    handler = StripeWebhookHandler(AsyncMock())
    event = SimpleNamespace(type="customer.subscription.updated", id="evt_1",
                            data=SimpleNamespace(object=_StripeObj(id="sub_1")))
    with patch.object(handler, "handle_subscription_updated", AsyncMock(side_effect=RuntimeError("db down"))):
        with pytest.raises(RuntimeError):
            await handler.handle_event(event)


@pytest.mark.asyncio
async def test_invoice_paid_twice_records_one_payment():
    from src.modules.billing.stripe.stripe_webhook_handler import StripeWebhookHandler

    db = AsyncMock()
    db.add = MagicMock()
    db.execute.side_effect = [
        _result(scalar=SimpleNamespace(organization_id=uuid.uuid4())),
        _result(first=(uuid.uuid4(),)),  # already recorded by checkout verification
    ]
    out = await StripeWebhookHandler(db).handle_invoice_paid(
        _StripeObj(id="in_1", customer="cus_1", subscription="sub_1"))

    assert out["duplicate"] is True
    db.add.assert_not_called()


# ── KHQR terms ───────────────────────────────────────────────────────────────

def test_khqr_term_start_is_now_or_the_stacked_term_start():
    plan_id = uuid.uuid4()
    began = NOW - timedelta(days=20)
    active = SimpleNamespace(provider="khqr", status="active", plan_id=plan_id,
                             ends_at=NOW + timedelta(days=10), period_starts_at=began)
    # Renewing early continues the same term...
    assert prov.compute_term_start(active, plan_id, NOW) == began
    # ...a different plan, a lapsed term, or no row starts a new term now.
    assert prov.compute_term_start(active, uuid.uuid4(), NOW) == NOW
    lapsed = SimpleNamespace(provider="khqr", status="active", plan_id=plan_id,
                             ends_at=NOW - timedelta(days=1), period_starts_at=began)
    assert prov.compute_term_start(lapsed, plan_id, NOW) == NOW
    assert prov.compute_term_start(None, plan_id, NOW) == NOW


def test_lapsed_khqr_term_stops_granting_the_plan():
    assert _in_effect("active", NOW + timedelta(days=1), "khqr", NOW)
    assert not _in_effect("active", NOW - timedelta(seconds=1), "khqr", NOW)
