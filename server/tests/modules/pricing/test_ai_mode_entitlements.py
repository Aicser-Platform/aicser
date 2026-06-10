"""Plan entitlements for AI analysis modes (incl. dashboard builder)."""

from src.modules.pricing.plans import FREE_ALLOWED_AI_MODES, PAID_ALLOWED_AI_MODES, get_plan_config


def test_dashboard_mode_allowed_on_free_and_paid_plans():
    assert "dashboard" in FREE_ALLOWED_AI_MODES
    assert "dashboard" in PAID_ALLOWED_AI_MODES

    free_modes = get_plan_config("free").get("allowed_ai_modes") or []
    pro_modes = get_plan_config("pro").get("allowed_ai_modes") or []
    team_modes = get_plan_config("team").get("allowed_ai_modes") or []

    assert "dashboard" in free_modes
    assert "dashboard" in pro_modes
    assert "dashboard" in team_modes


def test_api_streaming_plan_gate_allows_dashboard_for_free():
    from src.modules.ai.api_streaming import _plan_allows_mode

    assert _plan_allows_mode("free", "dashboard") is True
    assert _plan_allows_mode("pro", "dashboard") is True
    assert _plan_allows_mode("team", "dashboard") is True
