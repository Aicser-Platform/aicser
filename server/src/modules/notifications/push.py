"""Push notifications to phones and browsers (the Web Push standard, no app store or extra service).

Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT (a mailto: address) to turn it on; without
them nothing is offered and nothing is sent. A failed push never affects what triggered it.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Optional

from sqlalchemy import delete, select

from src.db.session import async_session
from src.modules.notifications.models import PushSubscription

logger = logging.getLogger(__name__)
GONE = (404, 410)  # the browser dropped this subscription


def public_key() -> Optional[str]:
    return (os.getenv("VAPID_PUBLIC_KEY") or "").strip() or None


async def subscribe(user_id: str, endpoint: str, p256dh: str, auth: str) -> None:
    async with async_session() as db:
        row = (await db.execute(select(PushSubscription).where(PushSubscription.endpoint == endpoint))).scalar_one_or_none()
        if row is None:
            db.add(PushSubscription(user_id=uuid.UUID(user_id), endpoint=endpoint, p256dh=p256dh, auth=auth))
        else:  # the same device, possibly now signed in as someone else
            row.user_id, row.p256dh, row.auth = uuid.UUID(user_id), p256dh, auth
        await db.commit()


async def unsubscribe(user_id: str, endpoint: str) -> None:
    async with async_session() as db:
        await db.execute(delete(PushSubscription).where(
            PushSubscription.endpoint == endpoint, PushSubscription.user_id == uuid.UUID(user_id)))
        await db.commit()


def _send_one(sub: PushSubscription, payload: str, private_key: str, subject: str) -> Optional[int]:
    from pywebpush import WebPushException, webpush

    try:
        webpush({"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}}, payload,
                vapid_private_key=private_key, vapid_claims={"sub": subject}, timeout=10)
        return None
    except WebPushException as exc:
        return getattr(exc.response, "status_code", None)


async def send_to_user(user_id: str, title: str, body: str, url: str) -> int:
    private_key = (os.getenv("VAPID_PRIVATE_KEY") or "").strip()
    subject = (os.getenv("VAPID_SUBJECT") or "").strip()
    if not private_key or not subject or not public_key():
        return 0
    sent = 0
    try:
        async with async_session() as db:
            subs = (await db.execute(select(PushSubscription).where(
                PushSubscription.user_id == uuid.UUID(str(user_id))))).scalars().all()
            payload = json.dumps({"title": title[:120], "body": body[:240], "url": url})
            for sub in subs:
                failure = await asyncio.to_thread(_send_one, sub, payload, private_key, subject)
                if failure in GONE:
                    await db.delete(sub)
                elif failure is None:
                    sent += 1
            await db.commit()
    except Exception as exc:  # noqa: BLE001 - see the module note
        logger.warning("Push to %s failed: %s", user_id, type(exc).__name__)
    return sent
