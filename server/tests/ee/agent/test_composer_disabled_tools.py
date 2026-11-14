"""Composer Web / Calculations toggles hide tools for one Agent run."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.core.tool_registry import ToolCaller, ToolSpec, ToolTier


@pytest.mark.asyncio
async def test_available_tools_merges_disabled_extra():
    from src.modules.agent import tools as agent_tools

    async def _noop(_caller, _args):
        return {}

    keep = ToolSpec(
        name="_keep_tool",
        description="keep",
        input_schema={"type": "object", "properties": {}},
        handler=_noop,
        tier=ToolTier.READ,
        surfaces=frozenset({"agent"}),
        source="test",
    )
    drop = ToolSpec(
        name="_drop_tool",
        description="drop",
        input_schema={"type": "object", "properties": {}},
        handler=_noop,
        tier=ToolTier.READ,
        surfaces=frozenset({"agent"}),
        source="test",
    )

    registry = MagicMock()
    registry.list.return_value = [keep, drop]

    caller = ToolCaller(user_id="u1", organization_id="o1", project_id=None)
    with (
        patch.object(agent_tools, "load_registered_tools", return_value=registry),
        patch.object(agent_tools, "run_policy", new=AsyncMock(return_value={"max_tier": 4})),
        patch(
            "ee.modules.ai.services.capability_governance_service.get_disabled_capabilities",
            new=AsyncMock(return_value=[]),
        ),
        patch.object(agent_tools, "_in_sandbox", new=AsyncMock(return_value=False)),
        patch.object(agent_tools, "_feature_on", new=AsyncMock(return_value=True)),
        patch("src.modules.agent.devices.device_tool_specs", new=AsyncMock(return_value=[])),
        patch("src.modules.agent.mcp_client.mcp_tool_specs", new=AsyncMock(return_value=[])),
    ):
        specs_on, _ = await agent_tools.available_tools(caller, {"max_tier": 4})
        specs_off, _ = await agent_tools.available_tools(
            caller, {"max_tier": 4}, disabled_extra=["_drop_tool"]
        )

    assert "_keep_tool" in specs_on and "_drop_tool" in specs_on
    assert "_keep_tool" in specs_off
    assert "_drop_tool" not in specs_off
