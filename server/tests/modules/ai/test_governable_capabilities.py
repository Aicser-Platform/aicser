"""Settings › AI › Rules & models lists Ask's capabilities and every Agent tool, so one switch governs both."""

from ee.modules.ai.router import _all_governable_capabilities


def test_agent_tools_join_the_governed_list_with_their_risk():
    caps = _all_governable_capabilities(
        [{"name": "execute_analysis", "description": "x", "cost_tier": 2, "side_effect_class": "read", "tags": [],
          "input_schema": {}}])
    by_name = {c["name"]: c for c in caps}
    assert by_name["execute_analysis"]["tags"] == []  # Ask's own entry is kept as it is
    assert by_name["find_work"]["side_effect_class"] == "read"
    assert by_name["update_chart"]["side_effect_class"] == "write"
    assert by_name["send_email"]["side_effect_class"] == "external"
    assert [c["name"] for c in caps] == sorted(c["name"] for c in caps)
    assert len(by_name) == len(caps)  # no name listed twice
