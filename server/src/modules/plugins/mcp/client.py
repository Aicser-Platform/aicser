"""Async MCP client with outbound SSRF protection."""

from __future__ import annotations

import ipaddress
import os
import socket
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx


class McpSSRFError(ValueError):
    """Raised when an MCP endpoint URL targets a disallowed private/loopback/metadata IP."""


def _is_disallowed_ip(ip_str: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def validate_mcp_url(url: str, allow_private: Optional[bool] = None) -> str:
    """Validate that an MCP endpoint URL uses HTTP(S) and does not point to private/loopback/metadata hosts."""
    if not url or not isinstance(url, str):
        raise McpSSRFError("MCP endpoint URL cannot be empty")

    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise McpSSRFError(f"Unsupported MCP URL scheme '{parsed.scheme}'; must be http or https")

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise McpSSRFError("MCP endpoint URL must include a valid hostname")

    if allow_private is None:
        allow_private = os.getenv("ALLOW_PRIVATE_MCP_ENDPOINTS", "false").strip().lower() in (
            "1",
            "true",
            "yes",
        )

    if allow_private:
        return url.strip()

    if hostname in ("localhost", "localhost.localdomain", "metadata.google.internal"):
        raise McpSSRFError(f"SSRF protection blocked loopback/metadata host '{hostname}'")

    # Check literal IP first
    try:
        ip_obj = ipaddress.ip_address(hostname)
        if _is_disallowed_ip(str(ip_obj)):
            raise McpSSRFError(f"SSRF protection blocked private/reserved IP '{hostname}'")
        return url.strip()
    except ValueError:
        pass

    # Resolve DNS and verify all resolved records are public
    try:
        infos = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise McpSSRFError(f"Could not resolve MCP hostname '{hostname}': {exc}") from exc

    for info in infos:
        sockaddr = info[4]
        resolved_ip = sockaddr[0]
        if _is_disallowed_ip(resolved_ip):
            raise McpSSRFError(
                f"SSRF protection blocked '{hostname}' resolving to non-public IP '{resolved_ip}'"
            )

    return url.strip()


class McpClient:
    """Minimal JSON-RPC 2.0 client for MCP `tools/list` and `tools/call`."""

    def __init__(
        self,
        endpoint_url: str,
        auth_token: Optional[str] = None,
        custom_headers: Optional[Dict[str, str]] = None,
        timeout: float = 10.0,
        allow_private: Optional[bool] = None,
    ) -> None:
        self.endpoint_url = validate_mcp_url(endpoint_url, allow_private=allow_private)
        self.auth_token = auth_token
        self.custom_headers = dict(custom_headers or {})
        self.timeout = timeout

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", **self.custom_headers}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers

    async def list_tools(self) -> List[Dict[str, Any]]:
        """Invoke MCP JSON-RPC `tools/list` and return tool definitions."""
        validate_mcp_url(self.endpoint_url)
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {},
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(self.endpoint_url, json=payload, headers=self._headers())
            resp.raise_for_status()
            body = resp.json()
        result = body.get("result") or {}
        tools = result.get("tools")
        return list(tools) if isinstance(tools, list) else []

    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
        """Invoke MCP JSON-RPC `tools/call`."""
        validate_mcp_url(self.endpoint_url)
        payload = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments or {},
            },
        }
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(self.endpoint_url, json=payload, headers=self._headers())
            resp.raise_for_status()
            body = resp.json()
        if "error" in body:
            raise RuntimeError(f"MCP tool '{name}' returned error: {body['error']}")
        return body.get("result")

