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
async def test_dns_rebinding_mock_resolve_to_loopback_rejected(monkeypatch):
    monkeypatch.setenv("ALLOW_PRIVATE_MCP_ENDPOINTS", "false")

    # Mock getaddrinfo returning 127.0.0.1 for a public-looking domain name
    fake_info = [(2, 1, 6, "", ("127.0.0.1", 443))]

    from src.modules.plugins.mcp.client import McpClient, async_validate_mcp_host

    with patch("asyncio.get_running_loop") as mock_loop:
        loop_instance = MagicMock()
        loop_instance.getaddrinfo = AsyncMock(return_value=fake_info)
        mock_loop.return_value = loop_instance

        with pytest.raises(McpSSRFError) as exc_info_async:
            await async_validate_mcp_host("rebound-attack.example.com", 443)
        assert "non-public IP" in str(exc_info_async.value) or "127.0.0.1" in str(exc_info_async.value)


@pytest.mark.asyncio
async def test_dns_rebinding_second_resolve_to_loopback_rejected(monkeypatch):
    """Test DNS rebinding attack where 1st resolve returns public IP but connect-time resolve returns 127.0.0.1."""
    monkeypatch.setenv("ALLOW_PRIVATE_MCP_ENDPOINTS", "false")

    from src.modules.plugins.mcp.client import McpClient, SSRFSafeNetworkBackend

    public_info = [(2, 1, 6, "", ("93.184.216.34", 443))]
    rebind_loopback_info = [(2, 1, 6, "", ("127.0.0.1", 443))]

    # Simulate DNS rebinding: 1st call gives public IP, 2nd call (at connect time) gives loopback
    call_count = 0

    async def mock_getaddrinfo(host, port):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return public_info
        return rebind_loopback_info

    backend = SSRFSafeNetworkBackend(allow_private=False)
    with patch("asyncio.get_running_loop") as mock_loop:
        loop_instance = MagicMock()
        loop_instance.getaddrinfo = mock_getaddrinfo
        mock_loop.return_value = loop_instance

        # 1st resolve passes
        from src.modules.plugins.mcp.client import async_validate_mcp_host
        first_ips = await async_validate_mcp_host("rebound-attack.example.com", 443)
        assert first_ips == ["93.184.216.34"]

        # 2nd resolve at connect_tcp time is rejected with McpSSRFError
        with pytest.raises(McpSSRFError) as exc_info:
            await backend.connect_tcp("rebound-attack.example.com", 443)
        assert "127.0.0.1" in str(exc_info.value) or "non-public IP" in str(exc_info.value)


@pytest.mark.asyncio
async def test_mcp_client_redirect_to_metadata_ip_rejected(monkeypatch):
    import httpx
    from src.modules.plugins.mcp.client import McpClient

    monkeypatch.setenv("ALLOW_PRIVATE_MCP_ENDPOINTS", "false")

    class MockRedirectTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                302,
                headers={"Location": "http://169.254.169.254/latest/meta-data/"},
                request=request,
            )

    client = McpClient(
        "https://8.8.8.8/mcp",
        transport=MockRedirectTransport(),
    )

    with pytest.raises(McpSSRFError) as exc_info:
        await client.list_tools()

    assert "169.254.169.254" in str(exc_info.value)



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

