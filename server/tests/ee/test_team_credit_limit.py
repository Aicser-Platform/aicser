"""Team plans share one AI pool: no per-person cap shows as unlimited, not as 1 credit."""

from ee.modules.pricing.usage_tracker import _team_per_user_ai_credit_limit


def test_unlimited_per_person_is_not_a_cap_of_one():
    assert _team_per_user_ai_credit_limit({"ai_credits_per_user_limit": -1}) == -1


def test_explicit_and_derived_caps():
    assert _team_per_user_ai_credit_limit({"ai_credits_per_user_limit": 300}) == 300
    assert _team_per_user_ai_credit_limit({"ai_credits_limit": 900, "max_users": 5}) == 180
