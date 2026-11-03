"""MCP (Model Context Protocol) client contribution support for Aicser Plug-ins."""

from src.modules.plugins.mcp.client import McpClient, McpSSRFError, validate_mcp_url
from src.modules.plugins.mcp.service import (
    DiscoveredMcpSkill,
    discover_org_mcp_skills,
)

__all__ = [
    "DiscoveredMcpSkill",
    "McpClient",
    "McpSSRFError",
    "discover_org_mcp_skills",
    "validate_mcp_url",
]

