"""Per-member pricing (AI $18 / Light $6), fixed-cost credits, credit packs, platform quotas."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from ee.modules.pricing import credit_packs as CP
from ee.modules.pricing import platform_usage as PU
from ee.modules.pricing.plans import (
    AI_CREDITS_PER_AI_SEAT, CREDIT_PACK, FREE_AI_CREDITS, PLAN_CONFIGS, PLATFORM_QUOTAS_PER_SEAT, SEAT_PRICES,
    billable_seats, billed_seats, credits_for, plan_quote, seat_capacity, seat_mix_amount,
)


def _pack(credits, used=0, days=30):
    return {"credits": credits, "used": used,
            "expires_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()}


def test_one_price_per_member_on_every_plan():
    assert SEAT_PRICES == {"ai": {"monthly": 18.0, "yearly": 180.0}, "platform": {"monthly": 6.0, "yearly": 60.0}}
    assert PLAN_CONFIGS["pro"]["seat_prices"] is PLAN_CONFIGS["team"]["seat_prices"]
    assert AI_CREDITS_PER_AI_SEAT == 900 and FREE_AI_CREDITS == 100
    assert PLAN_CONFIGS["free"]["ai_credits_limit"] == 100


def test_pro_is_one_member_with_ai_on_or_off():
    assert PLAN_CONFIGS["pro"]["max_users"] == 1
    assert seat_mix_amount("pro", "monthly", 1, 0) == 18.0
    assert seat_mix_amount("pro", "monthly", 0, 1) == 6.0
    assert seat_mix_amount("pro", "yearly", 1, 0) == 180.0


def test_team_is_one_price_for_up_to_five_members():
    assert PLAN_CONFIGS["team"]["min_seats"] == 5
    for ai, light in ((1, 0), (3, 0), (5, 0), (3, 2), (0, 5)):
        assert seat_mix_amount("team", "monthly", ai, light) == 90.0
        assert seat_mix_amount("team", "yearly", ai, light) == 900.0
    assert billable_seats("team", 3, 0) == {"ai": 5, "platform": 0}


def test_team_adds_members_past_five_as_ai_or_light():
    assert seat_mix_amount("team", "monthly", 7, 0) == 90 + 2 * 18
    assert seat_mix_amount("team", "monthly", 5, 3) == 90 + 3 * 6
    assert seat_mix_amount("team", "monthly", 6, 4) == 90 + 18 + 4 * 6
    # Light members fill the spare places first: 2 AI + 6 Light is five places and three more.
    assert seat_mix_amount("team", "monthly", 2, 6) == 90 + 3 * 6
    assert seat_mix_amount("team", "yearly", 5, 3) == 900 + 3 * 60


def test_moving_a_member_inside_teams_five_costs_nothing():
    assert seat_mix_amount("team", "monthly", 3, 2) == seat_mix_amount("team", "monthly", 4, 1)


def test_bought_seats_are_paid_for_filled_or_not():
    assert billed_seats("team", 2, 0, 2, 3) == {"ai": 7, "platform": 3}
    assert seat_mix_amount("team", "monthly", 2, 0, 2, 3) == 90 + 2 * 18 + 3 * 6
    assert seat_mix_amount("team", "yearly", 2, 0, 1, 0) == 900 + 180
    assert seat_capacity("team", 2, 3) == 10
    # Members past what was bought still count; nothing is free.
    assert billed_seats("team", 9, 0, 1, 0) == {"ai": 9, "platform": 0}


def test_only_team_buys_seats():
    assert billed_seats("pro", 1, 0, 3, 3) == {"ai": 1, "platform": 0}
    assert seat_capacity("pro", 3, 3) == 0


def test_quote_says_what_the_total_covers():
    assert plan_quote("team", "yearly", 2, 0) == {
        "amount": 900.0, "included_members": 5, "extra_ai": 0, "extra_light": 0}
    assert plan_quote("team", "monthly", 7, 1) == {
        "amount": 132.0, "included_members": 5, "extra_ai": 2, "extra_light": 1}
    assert plan_quote("enterprise", "monthly", 5, 0) is None


def test_sandbox_plans_include_no_paid_seats():
    from src.modules.pricing.plans import SANDBOX_PLANS

    for plan in SANDBOX_PLANS:
        assert not PLAN_CONFIGS[plan].get("included_ai_seats")


@pytest.mark.parametrize("mode,credits", [
    ("chat", 0), ("standard", 1), ("auto", 1), ("predictive", 2), ("diagnostic", 2),
    ("dashboard", 5), ("executive_report_comprehensive", 5), ("decision_intelligence", 5),
])
def test_credits_are_a_fixed_price_per_action(mode, credits):
    assert credits_for(mode) == credits


def test_credit_cost_ignores_tokens_but_stays_free_without_data():
    from ee.modules.pricing.usage_tracker import calculate_ai_credit_cost

    assert calculate_ai_credit_cost("diagnostic", "gpt-4.1", token_usage=50_000) == 2
    assert calculate_ai_credit_cost("standard", has_data_source=False) == 0


def test_packs_are_used_oldest_first_and_expire():
    packs = [_pack(1000, days=200), _pack(1000, days=10), _pack(500, days=-1)]
    assert CP.remaining_in(packs) == 2000
    assert CP.consume_from(packs, 1200) == 0
    assert packs[1]["used"] == 1000 and packs[0]["used"] == 200
    assert CP.consume_from(packs, 5000) == 4200


def test_credit_pack_offer():
    assert CREDIT_PACK == {"credits": 1000, "price": 10.0, "valid_days": 365}


def test_overage_pools_quotas_across_paid_seats():
    used = {"storage_gb": 130.0, "pipeline_run_minutes": 100.0, "warehouse_scan_gb": 700.0}
    bill = PU.overage(used, paid_seats=5)
    assert bill["lines"]["storage_gb"]["included"] == 5 * PLATFORM_QUOTAS_PER_SEAT["storage_gb"]
    assert bill["total"] == round(30 * 0.15 + 200 * 0.05, 2)


@pytest.mark.asyncio
async def test_light_member_uses_no_credits(monkeypatch):
    from ee.modules.pricing import usage_tracker as U

    async def light(org, user):
        return True

    monkeypatch.setattr(U, "_platform_seat", light)
    ok, _used, limit, msg = await U.check_ai_credit_limit("o", 5, None, user_id="u")
    assert ok and limit == -1 and "Own model keys" in msg


@pytest.mark.asyncio
async def test_credit_pool_is_900_per_ai_member(monkeypatch):
    from ee.modules.pricing import usage_tracker as U
    import ee.modules.pricing.seats as seats

    async def counts(org):
        return mix

    async def paying(org):
        return is_paying

    mix = {"ai": 3, "platform": 4}
    is_paying = True
    monkeypatch.setattr(seats, "seat_counts", counts)
    monkeypatch.setattr(U, "_paying", paying)

    async def bought(org):
        return {"ai": 0, "platform": 0}

    monkeypatch.setattr(seats, "seat_extras", bought)
    # Team pays for five AI places, filled or not.
    assert await U._seat_based_credit_limit("o", "team", {"ai_credits_limit": 900}) == 4500
    mix = {"ai": 7, "platform": 0}
    assert await U._seat_based_credit_limit("o", "team", {"ai_credits_limit": 900}) == 6300
    mix = {"ai": 0, "platform": 1}
    assert await U._seat_based_credit_limit("o", "pro", {"ai_credits_limit": 900}) == 0
    # A free trial gets credits for the people there, not for five empty seats.
    is_paying = False
    mix = {"ai": 1, "platform": 0}
    assert await U._seat_based_credit_limit("o", "team", {"ai_credits_limit": 900}) == 900
    assert await U._seat_based_credit_limit("o", "free", {"ai_credits_limit": 100}) == 100


@pytest.mark.asyncio
async def test_light_member_model_switches_to_own_key_or_refuses(monkeypatch):
    from ee.modules.ai.observability import request_context as rc
    from ee.modules.ai.services.litellm_service import LiteLLMService
    import src.modules.pricing.seats as seats

    svc = LiteLLMService.__new__(LiteLLMService)
    svc.available_models = {"primary": {"api_key": "k", "model": "m"}}
    monkeypatch.setattr(rc, "get_ai_request_context", lambda: {"user_id": "u", "organization_id": "o"})

    async def light(org, user):
        return True

    monkeypatch.setattr(seats, "is_platform_seat", light)
    assert await svc._platform_seat_model() is False
    svc.available_models["byok_openai"] = {"api_key": "own", "model": "gpt", "byok_provider": "openai"}
    assert (await svc._platform_seat_model())["api_key"] == "own"
