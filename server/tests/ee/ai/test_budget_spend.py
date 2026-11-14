"""Every model call must count against budgets, priced or not."""
from src.modules.ai.services.litellm_service import UNPRICED_MODEL_RATE, budget_cost_usd


def test_a_priced_call_counts_its_price():
    assert budget_cost_usd(0.0123, 1000, 1000) == 0.0123


def test_a_call_with_no_price_never_counts_as_free():
    assert budget_cost_usd(None, 1000, 1000) == UNPRICED_MODEL_RATE["input"] + UNPRICED_MODEL_RATE["output"]
    assert budget_cost_usd(0.0, 2000, 0) == UNPRICED_MODEL_RATE["input"] * 2


def test_a_failed_call_with_no_tokens_costs_nothing():
    assert budget_cost_usd(None, 0, 0) == 0
