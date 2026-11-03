"""Unit tests for MCP client SSRF protection and dynamic AI skill discovery (Issue 12)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.fernet import Fernet

from src.modules.plugins import service as plugin_service
from src.modules.plugins.mcp.client import McpSSRFError, validate_mcp_url
from src.modules.plugins.mcp.service import discover_org_mcp_skills
from src.modules.plugins.registry import registry


def test_ssrf_validator_blocks_loopback_and_private_ips(monkeypatch):
    monkeypatch.setenv("ALLOW_PRIVATE_MCP_ENDPOINTS", "false")

    with pytest.raises(McpSSRFError):
        validate_mcp_url("http://127.0.0.1:8080/mcp")

    with pytest.raises(McpSSRFError):
        validate_mcp_url("http://localhost:8080/mcp")

    with pytest.raises(McpSSRFError):
        validate_mcp_url("http://169.254.169.254/latest/meta-data/")

    with pytest.raises(McpSSRFError):
        validate_mcp_url("http://10.0.0.12/mcp")

    # Public IP passes
    assert validate_mcp_url("https://8.8.8.8/mcp") == "https://8.8.8.8/mcp"


@pytest.mark.asyncio
async def test_discover_org_mcp_skills_namespaces_and_marks_mutation(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("ALLOW_PRIVATE_MCP_ENDPOINTS", "true")

    registry.reset()
    registry._discovered = True
    registry.register_manifest_dict(
        {
            "id": "jira_mcp",
            "name": "Jira MCP",
            "version": "1.0.0",
            "api_version": "1",
            "default_enabled": True,
            "contributions": [
                {
                    "kind": "mcp_server",
                    "server_name": "jira",
                    "description": "Jira MCP integration",
                    "default_url": "https://8.8.8.8/mcp",
                }
            ],
        }
    )

    mock_db = AsyncMock()
    res = MagicMock()
    res.scalars.return_value.all.return_value = []
    res.scalar_one_or_none.return_value = None
    mock_db.execute.return_value = res

    fake_tools = [
        {"name": "search_issues", "description": "Search Jira issues"},
        {"name": "delete_issue", "description": "Delete a Jira issue"},
    ]

    with patch(
        "src.modules.plugins.mcp.service.McpClient.list_tools",
        new=AsyncMock(return_value=fake_tools),
    ):
        skills = await discover_org_mcp_skills(mock_db, scope_key="org-1")

    assert len(skills) == 2
    by_name = {s.name: s for s in skills}
    assert "mcp_jira_mcp_search_issues" in by_name
    assert by_name["mcp_jira_mcp_search_issues"].is_read_only is True
    assert by_name["mcp_jira_mcp_search_issues"].requires_approval is False

    assert "mcp_jira_mcp_delete_issue" in by_name
    assert by_name["mcp_jira_mcp_delete_issue"].is_read_only is False
    assert by_name["mcp_jira_mcp_delete_issue"].requires_approval is True
    registry.reset()

