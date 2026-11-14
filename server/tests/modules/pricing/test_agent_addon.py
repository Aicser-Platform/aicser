"""Agent runs on AI credits in Pro and Team, is included in Enterprise, and is licensed per seat
on self-hosted installs. Scheduled (unattended) agents come with Team, on credits."""

import pytest

from ee.modules.pricing import feature_gate as fg
from ee.modules.pricing.plans import ADDONS, addon_enables, is_feature_available


def test_agent_is_on_from_pro():
    assert [is_feature_available(p, "agent") for p in ("free", "pro", "team", "enterprise")] == [False, True, True, True]


def test_scheduled_agents_are_part_of_team_on_credits():
    assert [is_feature_available(p, "digital_worker") for p in ("free", "pro", "team", "enterprise")] == [False, False, True, True]
    assert "digital_worker" not in ADDONS


def test_agent_addon_is_for_self_hosted_enterprise():
    assert ADDONS["agent"]["deployment"] == "self_host" and ADDONS["agent"]["min_plan"] == "enterprise"
    assert not addon_enables("team", "agent", {"agent": {"seats": 3}})


@pytest.mark.asyncio
async def test_self_hosted_agent_follows_the_license(monkeypatch):
    from src.core.licensing.state import state

    monkeypatch.setattr(fg, "is_self_host_deployment", lambda: True)
    monkeypatch.setattr(state, "is_valid", True)
    monkeypatch.setattr(state, "features", ["govern"])
    assert (await fg.org_entitlement("o1", None, "agent"))[0] is False
    assert (await fg.org_entitlement("o1", None, "govern"))[0] is True
    monkeypatch.setattr(state, "features", ["agent"])
    assert (await fg.org_entitlement("o1", None, "agent"))[0] is True
    monkeypatch.setattr(state, "is_valid", False)
    assert (await fg.org_entitlement("o1", None, "agent"))[0] is True  # evaluation install
