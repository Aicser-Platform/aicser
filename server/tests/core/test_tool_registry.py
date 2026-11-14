"""Kernel tool registry: one catalog, tiers decide approval, add-ons cannot clobber each other."""

import pytest

from src.core.tool_registry import (
    ALLOW,
    ASK_EVERY_TIME,
    ASK_ONCE,
    HAND_BACK,
    ToolRegistry,
    ToolSpec,
    ToolTier,
    approval_for,
)


async def _noop(caller, args):
    return {}


def _spec(name="t", tier=ToolTier.READ, source="m", surfaces=frozenset({"agent", "mcp"})):
    return ToolSpec(name=name, description="d", input_schema={"type": "object"}, handler=_noop,
                    tier=tier, source=source, surfaces=surfaces)


def test_register_and_filter_by_surface():
    reg = ToolRegistry()
    reg.register(_spec("a"))
    reg.register(_spec("b", surfaces=frozenset({"agent"})))
    assert {t.name for t in reg.list()} == {"a", "b"}
    assert {t.name for t in reg.list(surface="mcp")} == {"a"}


def test_another_module_cannot_take_a_registered_name():
    reg = ToolRegistry()
    reg.register(_spec("send_email", source="channel"))
    reg.register(_spec("send_email", source="channel"))  # re-import of the same module is fine
    with pytest.raises(ValueError):
        reg.register(_spec("send_email", source="operate"))


@pytest.mark.parametrize("tier,expected", [
    (ToolTier.READ, ALLOW),
    (ToolTier.WORKSPACE, ALLOW),
    (ToolTier.INTERNAL, ASK_ONCE),
    (ToolTier.EXTERNAL, ASK_EVERY_TIME),
    (ToolTier.IRREVERSIBLE, HAND_BACK),
])
def test_default_approval_by_tier(tier, expected):
    assert approval_for(_spec(tier=tier)) == expected


def test_ask_once_tool_is_allowed_after_approval_in_the_task():
    spec = _spec("save_dashboard", tier=ToolTier.INTERNAL)
    assert approval_for(spec, approved_in_task=["save_dashboard"]) == ALLOW


def test_pre_approval_never_covers_irreversible_tools():
    spec = _spec("delete_table", tier=ToolTier.IRREVERSIBLE)
    assert approval_for(spec, pre_approved=["delete_table"]) == HAND_BACK


def test_untrusted_content_forces_a_fresh_approval_for_outside_effects():
    spec = _spec("send_email", tier=ToolTier.EXTERNAL)
    assert approval_for(spec, pre_approved=["send_email"]) == ALLOW
    assert approval_for(spec, pre_approved=["send_email"], untrusted_content_seen=True) == ASK_EVERY_TIME


def test_mcp_tool_annotations_follow_the_tier():
    tool = _spec("post", tier=ToolTier.EXTERNAL).to_mcp_tool()
    assert tool["annotations"] == {"readOnlyHint": False, "destructiveHint": False, "openWorldHint": True}


def test_governed_tools_are_registered_and_mcp_offers_only_read_or_draft():
    from ee.modules.mcp_server import router as R
    from src.core.tool_registry import get_tool_registry

    names = {t.name for t in get_tool_registry().list()}
    assert {"run_query", "ask", "query_metric", "draft_recipe"} <= names
    assert all(t.tier <= ToolTier.WORKSPACE for t in R._mcp_tools())
