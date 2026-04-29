"""
Optional transactional email via SMTP.

Set in environment (all optional except host/from when sending):
  SMTP_HOST, SMTP_PORT (default 587), SMTP_USER, SMTP_PASSWORD,
  SMTP_FROM, SMTP_USE_TLS (default true)

If SMTP_HOST or SMTP_FROM is missing, sends are skipped and callers should rely on logs.
"""

from __future__ import annotations

import asyncio
import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from typing import Iterable, List

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip() and os.getenv("SMTP_FROM", "").strip())


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
) -> None:
    host = os.getenv("SMTP_HOST", "").strip()
    from_addr = os.getenv("SMTP_FROM", "").strip()
    port = int(os.getenv("SMTP_PORT", "587") or "587")
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    use_tls = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.set_content(body_text)

    if use_tls:
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


async def send_transactional_email(
    recipients: Iterable[str],
    subject: str,
    body_text: str,
    *,
    reply_to: str | None = None,
) -> bool:
    """
    Send a plain-text email if SMTP is configured. Returns True if send attempted successfully.
    """
    to_addrs = _normalize_recipients(recipients)
    if not to_addrs:
        logger.debug("Transactional email skipped: no recipients")
        return False
    if not smtp_configured():
        logger.debug(
            "Transactional email skipped (set SMTP_HOST and SMTP_FROM): subject=%r to=%s",
            subject,
            to_addrs,
        )
        return False

    try:
        await asyncio.to_thread(
            _send_sync, to_addrs, subject, body_text, reply_to=reply_to
        )
        logger.info("Transactional email sent subject=%r to=%s", subject, to_addrs)
        return True
    except Exception as e:
        logger.warning("Transactional email failed subject=%r: %s", subject, e)
        return False
