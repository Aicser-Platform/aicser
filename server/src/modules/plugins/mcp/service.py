"""Service turning active MCP plug-in connections into governed AI Skills."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.plugins import service as plugin_service
from src.modules.plugins.manifest import MCPServerContribution
from src.modules.plugins.mcp.client import McpClient
from src.modules.plugins.registry import registry

logger = logging.getLogger(__name__)


@dataclass
class DiscoveredMcpSkill:
    name: str
    plugin_id: str
    remote_tool_name: str
    description: str
    input_schema: Dict[str, Any] = field(default_factory=dict)
    is_read_only: bool = True
    requires_approval: bool = False


def _is_mutating_tool(tool_def: Dict[str, Any]) -> bool:
    annotations = tool_def.get("annotations") or {}
    if annotations.get("readOnlyHint") is False or annotations.get("destructiveHint") is True:
        return True
    if tool_def.get("read_only") is False or tool_def.get("mutates") is True:
        return True
    name_lower = str(tool_def.get("name") or "").lower()
    mutation_prefixes = ("create_", "update_", "delete_", "drop_", "insert_", "write_", "send_", "post_")
    return name_lower.startswith(mutation_prefixes)


async def discover_org_mcp_skills(
    db: AsyncSession,
    scope_key: str,
    organization_id: Optional[str] = None,
) -> List[DiscoveredMcpSkill]:
    """Return namespaced AI skills (`mcp_{plugin_id}_{tool}`) for all Active MCP plug-ins."""
    states = await plugin_service.get_plugin_states(
        db, scope_key=scope_key, organization_id=organization_id
    )
    skills: List[DiscoveredMcpSkill] = []

    for st in states:
        if not st.active:
            continue
        manifest = registry.get_manifest(st.id)
        if not manifest:
            continue

        mcp_contribs = [
            c for c in manifest.contributions if isinstance(c, MCPServerContribution)
        ]
        if not mcp_contribs:
            continue

        cfg = await plugin_service.get_decrypted_plugin_config(db, scope_key=scope_key, plugin_id=st.id)
        endpoint_url = (cfg or {}).get("endpoint_url") or mcp_contribs[0].default_url
        if not endpoint_url:
            continue

        allowed_tools = (cfg or {}).get("allowed_tools")
        client = McpClient(
            endpoint_url=endpoint_url,
            auth_token=(cfg or {}).get("auth_token"),
            custom_headers=(cfg or {}).get("custom_headers"),
        )

        try:
            raw_tools = await client.list_tools()
        except Exception as err:
            logger.warning("Failed to list MCP tools for plug-in '%s': %s", st.id, err)
            continue

        for tool in raw_tools:
            raw_name = str(tool.get("name") or "").strip()
            if not raw_name:
                continue
            if isinstance(allowed_tools, list) and raw_name not in allowed_tools:
                continue

            mutating = _is_mutating_tool(tool)
            skills.append(
                DiscoveredMcpSkill(
                    name=f"mcp_{st.id}_{raw_name}",
                    plugin_id=st.id,
                    remote_tool_name=raw_name,
                    description=f"[{manifest.name}] {tool.get('description') or raw_name}",
                    input_schema=tool.get("inputSchema") or {},
                    is_read_only=not mutating,
                    requires_approval=mutating,
                )
            )

    return skills

