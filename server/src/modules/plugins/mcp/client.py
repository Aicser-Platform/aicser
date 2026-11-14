"""Async MCP client with outbound SSRF protection."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import os
import socket
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)


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

    # Resolve DNS and verify all resolved records are public (synchronous check)
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


async def async_validate_mcp_host(
    hostname: str,
    port: int,
    allow_private: bool = False,
) -> List[str]:
    """Resolve DNS asynchronously using loop.getaddrinfo and verify all IPs are public."""
    if allow_private:
        return [hostname]

    clean_host = (hostname or "").strip().lower()
    if not clean_host:
        raise McpSSRFError("MCP hostname cannot be empty")

    if clean_host in ("localhost", "localhost.localdomain", "metadata.google.internal"):
        raise McpSSRFError(f"SSRF protection blocked loopback/metadata host '{clean_host}'")

    try:
        ip_obj = ipaddress.ip_address(clean_host)
        if _is_disallowed_ip(str(ip_obj)):
            raise McpSSRFError(f"SSRF protection blocked private/reserved IP '{clean_host}'")
        return [str(ip_obj)]
    except ValueError:
        pass

    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()

    try:
        infos = await loop.getaddrinfo(clean_host, port)
    except socket.gaierror as exc:
        raise McpSSRFError(f"Could not resolve MCP hostname '{clean_host}': {exc}") from exc

    resolved_ips: List[str] = []
    for info in infos:
        sockaddr = info[4]
        resolved_ip = sockaddr[0]
        if _is_disallowed_ip(resolved_ip):
            raise McpSSRFError(
                f"SSRF protection blocked '{clean_host}' resolving to non-public IP '{resolved_ip}'"
            )
        resolved_ips.append(resolved_ip)

    if not resolved_ips:
        raise McpSSRFError(f"No IP addresses resolved for MCP host '{clean_host}'")

    return resolved_ips


class SSRFSafeTransport(httpx.AsyncBaseTransport):
    """Async transport wrapper enforcing SSRF validation on DNS resolution and redirect hops."""

    def __init__(
        self,
        allow_private: bool = False,
        wrapped_transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        self.allow_private = allow_private
        self.wrapped_transport = wrapped_transport or httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        url_str = str(request.url)
        validate_mcp_url(url_str, allow_private=self.allow_private)

        if not self.allow_private:
            port = request.url.port or (443 if request.url.scheme == "https" else 80)
            await async_validate_mcp_host(
                request.url.host,
                port,
                allow_private=self.allow_private,
            )

        resp = await self.wrapped_transport.handle_async_request(request)

        if resp.is_redirect and "location" in resp.headers:
            target_url = str(request.url.join(resp.headers["location"]))
            validate_mcp_url(target_url, allow_private=self.allow_private)
            parsed_loc = urlparse(target_url)
            loc_host = (parsed_loc.hostname or "").strip().lower()
            loc_port = parsed_loc.port or (443 if parsed_loc.scheme == "https" else 80)
            if loc_host and not self.allow_private:
                await async_validate_mcp_host(
                    loc_host,
                    loc_port,
                    allow_private=self.allow_private,
                )

        return resp

    async def aclose(self) -> None:
        await self.wrapped_transport.aclose()


class McpClient:
    """Minimal JSON-RPC 2.0 client for MCP `tools/list` and `tools/call`."""

    def __init__(
        self,
        endpoint_url: str,
        auth_token: Optional[str] = None,
        custom_headers: Optional[Dict[str, str]] = None,
        timeout: float = 10.0,
        allow_private: Optional[bool] = None,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ) -> None:
        if allow_private is None:
            allow_private = os.getenv("ALLOW_PRIVATE_MCP_ENDPOINTS", "false").strip().lower() in (
                "1",
                "true",
                "yes",
            )
        self.allow_private = allow_private
        self.endpoint_url = validate_mcp_url(endpoint_url, allow_private=allow_private)
        self.auth_token = auth_token
        self.custom_headers = dict(custom_headers or {})
        self.timeout = timeout
        self.transport = transport

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", **self.custom_headers}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers

    def _get_transport(self) -> httpx.AsyncBaseTransport:
        if self.transport is not None:
            if isinstance(self.transport, SSRFSafeTransport):
                return self.transport
            return SSRFSafeTransport(
                allow_private=self.allow_private,
                wrapped_transport=self.transport,
            )
        return SSRFSafeTransport(allow_private=self.allow_private)

    async def list_tools(self) -> List[Dict[str, Any]]:
        """Invoke MCP JSON-RPC `tools/list` and return tool definitions."""
        validate_mcp_url(self.endpoint_url, allow_private=self.allow_private)
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/list",
            "params": {},
        }
        transport = self._get_transport()
        async with httpx.AsyncClient(transport=transport, timeout=self.timeout) as client:
            resp = await client.post(self.endpoint_url, json=payload, headers=self._headers())
            resp.raise_for_status()
            body = resp.json()
        result = body.get("result") or {}
        tools = result.get("tools")
        return list(tools) if isinstance(tools, list) else []

    async def call_tool(self, name: str, arguments: Optional[Dict[str, Any]] = None) -> Any:
        """Invoke MCP JSON-RPC `tools/call`."""
        validate_mcp_url(self.endpoint_url, allow_private=self.allow_private)
        payload = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments or {},
            },
        }
        transport = self._get_transport()
        async with httpx.AsyncClient(transport=transport, timeout=self.timeout) as client:
            resp = await client.post(self.endpoint_url, json=payload, headers=self._headers())
            resp.raise_for_status()
            body = resp.json()
        if "error" in body:
            raise RuntimeError(f"MCP tool '{name}' returned error: {body['error']}")
        return body.get("result")
