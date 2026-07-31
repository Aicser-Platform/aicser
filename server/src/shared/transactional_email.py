"""
Optional transactional email via SMTP or Resend.

Set in environment (all optional except host/from when sending):
  SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASSWORD,
  SMTP_FROM, SMTP_USE_TLS (default true), SMTP_USE_SSL (default true on port 465)

Legacy aliases accepted: SMTP_USERNAME for SMTP_USER and SMTP_SENDER for SMTP_FROM.
Resend: RESEND_API_KEY, RESEND_FROM

If no provider is configured, sends are skipped and callers should rely on logs.
"""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
import json
import urllib.request
from email.message import EmailMessage
from typing import Iterable, List

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    import os

    from_addr = os.getenv("SMTP_FROM", "").strip() or os.getenv("SMTP_SENDER", "").strip()
    return bool(os.getenv("SMTP_HOST", "").strip() and from_addr)


def resend_configured() -> bool:
    import os

    return bool(os.getenv("RESEND_API_KEY", "").strip() and os.getenv("RESEND_FROM", "").strip())


def _normalize_recipients(recipients: Iterable[str]) -> List[str]:
    out: List[str] = []
    for r in recipients:
        s = (r or "").strip()
        if s and s not in out:
            out.append(s)
    return out


def _send_sync(
    to_addrs: List[str],
    subject: str,
    body_text: str,
    *,
    reply_to: str | None = None,
    config: dict | None = None,
    body_html: str | None = None,
) -> None:
    import os

    config = config or {}
    host = str(config.get("host") or os.getenv("SMTP_HOST", "")).strip()
    from_addr = str(
        config.get("from")
        or os.getenv("SMTP_FROM", "").strip()
        or os.getenv("SMTP_SENDER", "").strip()
    ).strip()
    port = int(config.get("port") or os.getenv("SMTP_PORT", "587") or "587")
    user = str(
        config.get("username")
        or os.getenv("SMTP_USER", "").strip()
        or os.getenv("SMTP_USERNAME", "").strip()
    ).strip()
    password = str(config.get("password") or os.getenv("SMTP_PASSWORD", "")).strip()
    if "use_ssl" in config:
        use_ssl = bool(config.get("use_ssl"))
    else:
        use_ssl_env = os.getenv("SMTP_USE_SSL", "").strip().lower()
        use_ssl = use_ssl_env in ("1", "true", "yes") if use_ssl_env else port == 465
    if "use_tls" in config:
        use_tls = bool(config.get("use_tls"))
    else:
        use_tls = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

    if "resend.com" in host.lower() and not password:
        raise RuntimeError("SMTP_PASSWORD is required for Resend SMTP")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    if use_ssl:
        context = ssl.create_default_context()
        with smtplib.SMTP_SSL(host, port, timeout=30, context=context) as server:
            if user and password:
                server.login(user, password)
            server.send_message(msg)
    elif use_tls:
        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.starttls(context=context)
            if user and password:
                server.login(user, password)
            server.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            if user and password:
                server.login(user, password)
            server.send_message(msg)


def _send_resend_sync(
    to_addrs: List[str],
    subject: str,
    body_text: str,
    *,
    reply_to: str | None = None,
    config: dict | None = None,
    body_html: str | None = None,
) -> None:
    import os

    config = config or {}
    api_key = str(config.get("api_key") or os.getenv("RESEND_API_KEY", "")).strip()
    from_addr = str(config.get("from") or os.getenv("RESEND_FROM", "")).strip()
    payload = {
        "from": from_addr,
        "to": to_addrs,
        "subject": subject,
        "text": body_text,
    }
    if body_html:
        payload["html"] = body_html
    if reply_to:
        payload["reply_to"] = reply_to

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        if response.status >= 400:
            raise RuntimeError(f"Resend returned HTTP {response.status}")


async def send_transactional_email(
    recipients: Iterable[str],
    subject: str,
    body_text: str,
    *,
    reply_to: str | None = None,
    body_html: str | None = None,
) -> bool:
    """
    Send a plain-text email if SMTP or Resend is configured. Returns True if send succeeded.
    """
    to_addrs = _normalize_recipients(recipients)
    if not to_addrs:
        logger.debug("Transactional email skipped: no recipients")
        return False

    try:
        from src.core.system_settings.runtime_config import get_effective_email_config

        email_config = await get_effective_email_config()
    except Exception:
        logger.exception("Failed to resolve runtime email config; falling back to env")
        email_config = {"provider": "smtp" if smtp_configured() else "resend", "enabled": smtp_configured() or resend_configured()}

    if not email_config.get("enabled"):
        logger.debug(
            "Transactional email skipped (set SMTP_HOST/SMTP_FROM or RESEND_API_KEY/RESEND_FROM): subject=%r to=%s",
            subject,
            to_addrs,
        )
        return False

    try:
        if email_config.get("provider") == "smtp":
            await asyncio.to_thread(
                _send_sync, to_addrs, subject, body_text, reply_to=reply_to, config=email_config, body_html=body_html
            )
        else:
            await asyncio.to_thread(
                _send_resend_sync, to_addrs, subject, body_text, reply_to=reply_to, config=email_config, body_html=body_html
            )
        logger.info("Transactional email sent subject=%r to=%s", subject, to_addrs)
        return True
    except Exception as e:
        logger.warning("Transactional email failed subject=%r: %s", subject, e)
        return False
