"""Mint signed, single-use Aicser embed links from your server.

    from aicser_embed import sign_embed_url

    embed = sign_embed_url(
        base_url="https://api.aicser.com",
        api_key=os.environ["AICSER_API_KEY"],
        dashboard_id="b4b3…",
        locked_filters=[{"field": "tenant_id", "value": customer.id}],
    )
    # render embed.url in an <iframe>; it opens once, so mint one per page view

Every query made with the link is pinned to ``locked_filters`` by Aicser, whatever the browser
sends. Keep the API key on your server. Standard library only.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence

__all__ = ["AicserSignError", "SignedEmbed", "sign_embed_url"]
__version__ = "0.3.1"


class AicserSignError(Exception):
    """Aicser refused to sign the link (bad key, plan without embedding, unknown dashboard…)."""

    def __init__(self, message: str, status: int) -> None:
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class SignedEmbed:
    url: str
    token: str
    expires_at: str


def _message(body: Mapping[str, Any], status: int) -> str:
    detail = body.get("detail")
    if isinstance(detail, str):
        return detail
    if isinstance(detail, Mapping) and isinstance(detail.get("message"), str):
        return detail["message"]
    return f"Aicser refused to sign the embed ({status})"


def sign_embed_url(
    *,
    base_url: str,
    api_key: str,
    dashboard_id: Optional[str] = None,
    resource_id: Optional[str] = None,
    scope: str = "dashboard",
    locked_filters: Optional[Sequence[Mapping[str, Any]]] = None,
    expires_in_minutes: int = 60,
    allowed_domains: Optional[Sequence[str]] = None,
    download: str = "none",
    timeout: float = 15.0,
) -> SignedEmbed:
    """Return a signed embed link for a dashboard, chart, or report.

    Pass ``dashboard_id`` (legacy) or ``resource_id``. For charts and reports set
    ``scope`` to ``"chart"`` or ``"report"`` (report ids are ``conversationId:messageId``).

    ``expires_in_minutes`` (5–1440) is how long the session may last once opened.
    ``allowed_domains`` limits which sites may show it; ``download`` is what visitors may save:
    ``"none"``, ``"image"`` or ``"data"``.
    """
    resolved = resource_id or dashboard_id
    if not resolved:
        raise AicserSignError("resource_id (or dashboard_id) is required", 400)
    if scope not in ("dashboard", "chart", "report"):
        raise AicserSignError(f"Unsupported embed scope: {scope}", 400)

    payload: Dict[str, Any] = {
        "resource_id": resolved,
        "scope": scope,
        "locked_filters": list(locked_filters or []),
        "expires_in_minutes": expires_in_minutes,
        "allowed_domains": list(allowed_domains or []),
        "download": download,
    }
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/embed/sign",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (caller's URL)
            status = response.status
            body = json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        try:
            body = json.loads(exc.read() or b"{}")
        except ValueError:
            body = {}
        raise AicserSignError(_message(body, exc.code), exc.code) from exc
    if not body.get("url") or not body.get("token"):
        raise AicserSignError(_message(body, status), status)
    return SignedEmbed(url=body["url"], token=body["token"], expires_at=body.get("expires_at") or "")
