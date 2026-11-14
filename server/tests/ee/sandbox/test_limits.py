"""What a sandbox member may and may not do. Pure rules, no database."""
import os

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")

from src.modules.pricing.plans import PLAN_CONFIGS, plan_at_least  # noqa: E402
from src.modules.sandbox import limits  # noqa: E402


@pytest.mark.parametrize("method,path", [
    ("POST", "/ai/analyze"), ("POST", "/chats/1"), ("POST", "/api/feed/abc/react"), ("POST", "/api/feed/abc/comments"),
    ("POST", "/api/feed/publications"), ("POST", "/api/dashboards"), ("POST", "/api/invitations"), ("POST", "/data/upload"),
    ("POST", "/data/query/execute"), ("POST", "/data/sources"), ("POST", "/api/alerts/rules"), ("GET", "/charts"),
])
def test_allowed_while_active(method, path):
    assert limits.request_decision(method, path, "active") is None


@pytest.mark.parametrize("method,path", [
    ("POST", "/data/database/connect"), ("POST", "/data/database/test"), ("POST", "/data/sources/x/snapshots"),
    ("POST", "/data/warehouses/connect"), ("POST", "/data/enterprise/connections"), ("POST", "/api/schedule-email"),
    ("POST", "/api/notebooks/1/run"), ("POST", "/api/share-links"), ("POST", "/api/embed/assistants"), ("POST", "/mcp/x"),
    ("POST", "/api/organizations/1"), ("POST", "/api/rbac/roles"), ("POST", "/api/some-route-added-next-year"),
    ("GET", "/mcp/tools"), ("GET", "/api/share-links"), ("GET", "/api/embed/x"), ("GET", "/debug/x"),
    # a prefix must end at a path boundary
    ("POST", "/ainotreally"), ("POST", "/api/feedback-exfil"),
])
def test_refused_while_active(method, path):
    assert limits.request_decision(method, path, "active") == "blocked"


def test_an_ended_workspace_is_read_only_except_keeping_it():
    assert limits.request_decision("POST", "/ai/analyze", "expired") == "ended"
    assert limits.request_decision("GET", "/charts", "expired") is None
    assert limits.request_decision("POST", "/api/sandbox/keep", "expired") is None
    assert limits.request_decision("POST", "/auth/logout", "expired") is None


@pytest.mark.parametrize("name,tier,source,allowed", [
    ("save_chart", 2, "", True), ("create_alert", 2, "", True), ("read_sheet", 0, "", True),
    ("send_email", 3, "", False), ("send_to_destination", 3, "", False), ("run_python", 1, "", False),
    ("run_notebook", 1, "", False), ("github__create_issue", 3, "mcp:github", False),
    ("anything", 1, "mcp:github", False), ("files_read", 0, "agent.devices", False), ("delete_all", 4, "", False),
])
def test_agent_tools(name, tier, source, allowed):
    assert limits.tool_allowed(name, tier, source) is allowed


def test_the_agreed_allowances():
    verified, guest = PLAN_CONFIGS["sandbox"], PLAN_CONFIGS["sandbox_guest"]
    assert (verified["ai_credits_limit"], verified["ai_credits_per_user_limit"], verified["max_users"]) == (300, 100, 3)
    assert (guest["ai_credits_limit"], guest["max_users"]) == (30, 1)
    assert limits.lifetime_days(limits.GUEST) == 1 and limits.lifetime_days(limits.VERIFIED) == 3


def test_sandbox_plans_are_hidden_and_keep_nothing_outbound():
    for slug in ("sandbox", "sandbox_guest"):
        plan = PLAN_CONFIGS[slug]
        assert plan["hidden"] and plan["price_monthly"] == 0
        for feature in ("slack_teams", "webhooks", "scheduled_reports", "embed_analytics", "crm_connectors", "digital_worker"):
            assert plan["features"][feature] is False
        assert plan["features"]["collaboration"] is True and plan["features"]["agent"] is True
    assert plan_at_least("sandbox", "team") and not plan_at_least("sandbox", "enterprise")


def test_runs_on_the_cheap_models_only():
    prefs = limits.ai_preferences(limits.GUEST, "2026-11-05T00:00:00+00:00")
    assert prefs["forced_models"] == ["openrouter_deepseek_flash", "openrouter_gpt6_luna"]
    assert prefs["sandbox"] is True and prefs["hard_limit_usd"] == 0.25


def test_off_by_default_and_never_self_hosted(monkeypatch):
    monkeypatch.delenv("AISER_SANDBOX_ENABLED", raising=False)
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    assert limits.sandbox_enabled() is False
    monkeypatch.setenv("AISER_SANDBOX_ENABLED", "true")
    assert limits.sandbox_enabled() is True
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    assert limits.sandbox_enabled() is False
