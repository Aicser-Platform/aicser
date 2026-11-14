"""The plans decide; the SKU catalog and the messages must agree with them."""
import re
from pathlib import Path

import pytest

from ee.modules.pricing.feature_gate import plan_needed_message
from ee.modules.pricing.plans import PLAN_CONFIGS, minimum_plan_for_feature
from ee.modules.pricing.sku_catalog import SKU_CATALOG

ORDER = ["free", "pro", "team", "enterprise"]


@pytest.mark.parametrize("sku", [s for s in SKU_CATALOG if s["features"]], ids=lambda s: s["id"])
def test_a_sku_starts_where_its_first_feature_starts(sku):
    first = min(ORDER.index(minimum_plan_for_feature(f)) for f in sku["features"])
    assert ORDER[first] == sku["min_tier"]


def test_team_gets_basic_audit_and_enterprise_keeps_the_rest():
    team, enterprise = PLAN_CONFIGS["team"]["features"], PLAN_CONFIGS["enterprise"]["features"]
    assert team["audit_logs"] is True
    for feature in ("compliance", "sso_saml", "ai_residency", "custom_roles", "white_label"):
        assert not team.get(feature) and enterprise[feature] is True


@pytest.mark.parametrize("plan", ["sandbox", "sandbox_guest"])
def test_the_demo_has_nothing_only_enterprise_has(plan):
    demo = PLAN_CONFIGS[plan]["features"]
    for feature in ("compliance", "sso_saml", "ai_residency", "custom_roles"):
        assert not demo.get(feature)


@pytest.mark.parametrize("plan,feature,expected", [
    ("free", "embed_analytics", "Embedding needs the Pro plan or higher."),
    ("team", "sso_saml", "SSO and directory sync comes with the Enterprise plan. Talk to us to add it."),
    ("sandbox", "embed_analytics", "Embedding isn't in the demo. Start a Team trial to keep going."),
    ("sandbox", "sso_saml", "SSO and directory sync isn't in the demo. It comes with the Enterprise plan."),
])
def test_people_read_a_sentence_not_a_key(plan, feature, expected):
    assert plan_needed_message(plan, feature) == expected


@pytest.mark.asyncio
async def test_self_hosted_members_are_never_held_to_the_own_key_rule(monkeypatch):
    from ee.modules.pricing import seats

    monkeypatch.setattr(seats, "is_self_host_deployment", lambda: True)
    assert await seats.is_platform_seat("org", "user") is False
