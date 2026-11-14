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
        return mix

    async def bought(org):
        return {"ai": 0, "platform": 0}

    mix = {"ai": 5, "platform": 3}
    monkeypatch.setattr(B, "_subscription", subscription)
    monkeypatch.setattr(S, "seat_counts", counts)
    monkeypatch.setattr(S, "seat_extras", bought)
    preview = await B.seat_change_preview("o", "ai")
    assert preview["per_period"] == 12.0 and preview["period"] == "monthly"

    # Inside Team's five paid places, giving someone AI costs nothing.
    mix = {"ai": 3, "platform": 2}
    free = await B.seat_change_preview("o", "ai")
    assert free["per_period"] == 0.0 and free["due_now"] == 0.0 and not free["needs_payment"]
    mix = {"ai": 5, "platform": 3}
    assert 5.5 < preview["due_now"] < 6.5 and preview["needs_payment"]


def _team(monkeypatch, *, status="active", provider="khqr", used=5, extras=None, members=None):
    from datetime import datetime, timedelta, timezone
    from types import SimpleNamespace

    now = datetime.now(timezone.utc)
    sub = SimpleNamespace(provider=provider, status=status, period_starts_at=now - timedelta(days=15), ends_at=now + timedelta(days=15))

    async def subscription(org):
        return sub, SimpleNamespace(slug="team")

    async def in_use(org):
        return used

    async def counts(org):
        return members or {"ai": 5, "platform": 0}

    async def bought(org):
        return extras or {"ai": 0, "platform": 0}

    monkeypatch.setattr(B, "_subscription", subscription)
    monkeypatch.setattr(B, "seats_in_use", in_use)
    monkeypatch.setattr(S, "seat_counts", counts)
    monkeypatch.setattr(S, "seat_extras", bought)


@pytest.mark.asyncio
async def test_buying_seats_prices_the_rest_of_the_period(monkeypatch):
    _team(monkeypatch)
    preview = await B.extras_preview("o", 2, 1)
    assert preview["per_period"] == 42.0 and preview["capacity"] == 8 and preview["needs_payment"]
    assert 20 < preview["due_now"] < 22


@pytest.mark.asyncio
async def test_card_customers_are_billed_by_stripe_not_a_payment_link(monkeypatch):
    _team(monkeypatch, provider="stripe")
    assert not (await B.extras_preview("o", 1, 0))["needs_payment"]


@pytest.mark.asyncio
async def test_seats_in_use_cant_be_sold_back(monkeypatch):
    _team(monkeypatch, used=7, extras={"ai": 2, "platform": 0}, members={"ai": 7, "platform": 0})
    with pytest.raises(B.SeatBillingError):
        await B.extras_preview("o", 1, 0)


@pytest.mark.asyncio
@pytest.mark.parametrize("status,provider", [("trialing", "stripe"), ("active", None), ("canceled", "stripe")])
async def test_only_a_paid_active_team_buys_seats(monkeypatch, status, provider):
    _team(monkeypatch, status=status, provider=provider)
    with pytest.raises(B.SeatBillingError):
        await B.extras_preview("o", 1, 0)


@pytest.mark.asyncio
async def test_a_failed_charge_leaves_the_seats_as_they_were(monkeypatch):
    _team(monkeypatch, extras={"ai": 1, "platform": 0})
    saved = []

    async def save(org, ai, light):
        saved.append((ai, light))

    async def fail(org):
        raise RuntimeError("card declined")

    monkeypatch.setattr(B, "save_extras", save)
    monkeypatch.setattr(B, "sync_seats", fail)
    with pytest.raises(B.SeatBillingError):
        await B.change_extras("o", 4, 0)
    assert saved == [(4, 0), (1, 0)]


def test_the_seat_purchase_route_isnt_taken_for_a_member():
    from src.modules.pricing.router import router

    paths = [r.path for r in router.routes if "PUT" in getattr(r, "methods", set())]
    extras = next(i for i, path in enumerate(paths) if path.endswith("/seats/extras"))
    member = next(i for i, path in enumerate(paths) if path.endswith("/seats/{member_id}"))
    assert extras < member


@pytest.mark.asyncio
@pytest.mark.parametrize("members,bought,lands_on", [
    ({"ai": 5, "platform": 0}, {"ai": 0, "platform": 1}, None),      # the fifth AI seat was free
    ({"ai": 6, "platform": 0}, {"ai": 0, "platform": 1}, "platform"),  # only a Light seat is left
    ({"ai": 6, "platform": 0}, {"ai": 1, "platform": 0}, None),      # they bought an AI seat
])
async def test_a_new_member_takes_the_seat_that_was_paid_for(monkeypatch, members, bought, lands_on):
    placed = []

    async def counts(org):
        return members

    async def extras(org):
        return bought

    async def put(org, user, seat_type, assigned_by=None):
        placed.append(seat_type)

    monkeypatch.setattr(S, "seat_counts", counts)
    monkeypatch.setattr(S, "seat_extras", extras)
    monkeypatch.setattr(S, "set_seat_type", put)
    await S.place_new_member("o", "u", "team")
    assert placed == ([lands_on] if lands_on else [])


@pytest.mark.asyncio
async def test_seats_on_a_card_are_not_free_when_stripe_cant_bill(monkeypatch):
    _team(monkeypatch, provider="stripe")
    saved = []

    async def save(org, ai, light):
        saved.append((ai, light))

    async def disabled(org):
        return {"synced": False, "reason": "stripe_disabled"}

    monkeypatch.setattr(B, "save_extras", save)
    monkeypatch.setattr(B, "sync_seats", disabled)
    with pytest.raises(B.SeatBillingError):
        await B.change_extras("o", 2, 0, by_card=True)
    assert saved == [(2, 0), (0, 0)]
