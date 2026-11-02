"""A seat and its subscription change together, or not at all."""

import pytest

from src.modules.pricing import seat_billing as B
from src.modules.pricing import seats as S


@pytest.fixture
def seat(monkeypatch):
    state = {"seat": "platform"}

    async def get(org, user):
        return state["seat"]

    async def put(org, user, seat_type, assigned_by=None):
        state["seat"] = seat_type

    monkeypatch.setattr(S, "get_seat_type", get)
    monkeypatch.setattr(S, "set_seat_type", put)
    return state


@pytest.mark.asyncio
async def test_a_billing_failure_puts_the_seat_back(seat, monkeypatch):
    async def fail(org):
        raise RuntimeError("card declined")

    monkeypatch.setattr(B, "sync_seats", fail)
    with pytest.raises(B.SeatBillingError):
        await B.change_seat("o", "u", "ai", "admin")
    assert seat["seat"] == "platform"


@pytest.mark.asyncio
async def test_an_ai_seat_is_not_given_when_the_subscription_cannot_be_charged(seat, monkeypatch):
    async def unbilled(org):
        return {"synced": False, "reason": "seat_prices_not_configured"}

    monkeypatch.setattr(B, "sync_seats", unbilled)
    with pytest.raises(B.SeatBillingError):
        await B.change_seat("o", "u", "ai", "admin")
    assert seat["seat"] == "platform"


@pytest.mark.asyncio
async def test_a_billed_change_keeps_the_seat(seat, monkeypatch):
    async def billed(org):
        return {"synced": True}

    monkeypatch.setattr(B, "sync_seats", billed)
    assert (await B.change_seat("o", "u", "ai", "admin"))["synced"]
    assert seat["seat"] == "ai"


@pytest.mark.asyncio
async def test_the_preview_prices_the_rest_of_the_period(monkeypatch):
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace

    now = datetime.now(timezone.utc)
    sub = SimpleNamespace(provider="khqr", period_starts_at=now - timedelta(days=15), ends_at=now + timedelta(days=15))

    async def subscription(org):
        return sub, SimpleNamespace(slug="team")

    async def counts(org):
        return {"ai": 4, "platform": 3}

    monkeypatch.setattr(B, "_subscription", subscription)
    monkeypatch.setattr(S, "seat_counts", counts)
    preview = await B.seat_change_preview("o", "ai")
    assert preview["per_period"] == 12.0 and preview["period"] == "monthly"
    assert 5.5 < preview["due_now"] < 6.5 and preview["needs_payment"]
