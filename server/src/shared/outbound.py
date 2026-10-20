"""Requests this server makes to addresses people configured (webhooks, Slack, Teams).

A configured URL must be http(s) and must resolve to a public address, so nobody can make the
server call its own metadata endpoint or an internal service. Callers also send with
allow_redirects=False, since a redirect could point inward after this check passed.
"""

from __future__ import annotations

import asyncio
import ipaddress
from urllib.parse import urlparse


def is_http_url(url: str, *, https_only: bool = False) -> bool:
    try:
        parsed = urlparse(url)
    except Exception:  # noqa: BLE001
        return False
    schemes = ("https",) if https_only else ("http", "https")
    return parsed.scheme in schemes and bool(parsed.netloc)


async def resolves_to_public_address(url: str) -> bool:
    try:
        host = urlparse(url).hostname
        if not host:
            return False
        infos = await asyncio.get_event_loop().getaddrinfo(host, None)
        if not infos:
            return False
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified:
                return False
        return True
    except Exception:  # noqa: BLE001
        return False


async def safe_destination(url: str, *, https_only: bool = False) -> bool:
    return is_http_url(url, https_only=https_only) and await resolves_to_public_address(url)
