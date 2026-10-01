"""Forward audit events to a SIEM (Splunk HEC, Sentinel/Elastic HTTP intake, any NDJSON sink).

Delivery is at-least-once and gap-free:
- rows are read in (created_at, id) order after a durable cursor stored in system_settings
  (not Redis — a cache flush must not replay or skip history);
- only rows older than a short settling lag are read, so late-committing inserts that carry
  an earlier timestamp are not skipped;
- the cursor advances only after the SIEM answers 2xx; a failed batch is retried next run.

Configuration (env): AUDIT_SIEM_URL (enables forwarding), AUDIT_SIEM_FORMAT (jsonl |
splunk_hec), AUDIT_SIEM_AUTH_HEADER (e.g. "Splunk <token>" / "Bearer <token>"),
AUDIT_SIEM_HMAC_SECRET (adds X-Aicser-Signature: sha256=<hex>), AUDIT_SIEM_ORG_IDS
(comma list to limit which organizations are forwarded), AUDIT_SIEM_BATCH_SIZE.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

CURSOR_KEY = "audit.siem.cursor"
_SETTLE_SECONDS = 10
_MAX_BATCHES_PER_RUN = 20


def _config() -> Dict[str, Any]:
    orgs = [o.strip() for o in os.getenv("AUDIT_SIEM_ORG_IDS", "").split(",") if o.strip()]
    try:
        batch = max(1, min(5000, int(os.getenv("AUDIT_SIEM_BATCH_SIZE", "500"))))
    except ValueError:
        batch = 500
    return {
        "url": os.getenv("AUDIT_SIEM_URL", "").strip(),
        "format": os.getenv("AUDIT_SIEM_FORMAT", "jsonl").strip().lower(),
        "auth": os.getenv("AUDIT_SIEM_AUTH_HEADER", "").strip(),
        "secret": os.getenv("AUDIT_SIEM_HMAC_SECRET", "").strip(),
        "orgs": orgs,
        "batch": batch,
    }


def to_event(row: Dict[str, Any]) -> Dict[str, Any]:
    created = row.get("created_at")
    meta = row.get("metadata")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {"raw": meta}
    return {
        "id": str(row["id"]),
        "time": created.isoformat() if isinstance(created, datetime) else str(created),
        "source": "aicser",
        "event_type": row.get("event_type"),
        "category": row.get("category"),
        "user_id": str(row["user_id"]) if row.get("user_id") else None,
        "org_id": str(row["org_id"]) if row.get("org_id") else None,
        "resource_type": row.get("resource_type"),
        "resource_id": row.get("resource_id"),
        "action": row.get("action"),
        "ip_address": row.get("ip_address"),
        "user_agent": row.get("user_agent"),
        "request_id": row.get("request_id"),
        "status_code": row.get("status_code"),
        "duration_ms": row.get("duration_ms"),
        "metadata": meta or {},
    }


def encode_batch(events: List[Dict[str, Any]], fmt: str) -> Tuple[bytes, str]:
    if fmt == "splunk_hec":
        lines = []
        for e in events:
            try:
                epoch = datetime.fromisoformat(e["time"]).timestamp()
            except (TypeError, ValueError):
                epoch = None
            lines.append(json.dumps({"time": epoch, "sourcetype": "aicser:audit", "source": "aicser", "event": e},
                                    default=str))
        return "\n".join(lines).encode(), "application/json"
    return ("\n".join(json.dumps(e, default=str) for e in events) + "\n").encode(), "application/x-ndjson"


def sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def _load_cursor() -> Optional[Dict[str, str]]:
    from src.core.system_settings.repository import SystemSettingRepository

    row = await SystemSettingRepository().get_setting(CURSOR_KEY)
    return dict(row.value) if row and isinstance(row.value, dict) else None


async def _save_cursor(created_at: str, event_id: str) -> None:
    from src.core.system_settings.repository import SystemSettingRepository

    await SystemSettingRepository().set_setting(
        CURSOR_KEY, {"created_at": created_at, "id": event_id},
        description="Last audit event delivered to the SIEM (at-least-once cursor).",
    )


async def _fetch_batch(cursor: Optional[Dict[str, str]], orgs: List[str], limit: int) -> List[Dict[str, Any]]:
    from sqlalchemy import text

    from src.db.session import async_session

    where = ["created_at <= :settled"]
    params: Dict[str, Any] = {"settled": datetime.now(timezone.utc) - timedelta(seconds=_SETTLE_SECONDS),
                              "limit": limit}
    if cursor:
        where.append("(created_at, id) > (CAST(:c_at AS timestamptz), CAST(:c_id AS uuid))")
        params.update(c_at=cursor["created_at"], c_id=cursor["id"])
    if orgs:
        where.append("org_id::text = ANY(:orgs)")
        params["orgs"] = orgs
    sql = text(
        "SELECT id, event_type, category, user_id, org_id, resource_type, resource_id, action, "
        "ip_address, user_agent, request_id, status_code, duration_ms, metadata, created_at "
        f"FROM audit_logs WHERE {' AND '.join(where)} ORDER BY created_at, id LIMIT :limit"
    )
    async with async_session() as db:
        return [dict(r) for r in (await db.execute(sql, params)).mappings().all()]


async def _post(url: str, body: bytes, content_type: str, cfg: Dict[str, Any]) -> int:
    import aiohttp

    headers = {"Content-Type": content_type, "User-Agent": "aicser-audit-forwarder"}
    if cfg["auth"]:
        headers["Authorization"] = cfg["auth"]
    if cfg["secret"]:
        headers["X-Aicser-Signature"] = sign(body, cfg["secret"])
    async with aiohttp.ClientSession() as session:
        async with session.post(url, data=body, headers=headers, timeout=aiohttp.ClientTimeout(total=20)) as resp:
            return resp.status


async def forward_audit_events() -> Dict[str, Any]:
    """Deliver new audit events. Returns a summary; raises nothing on delivery failure."""
    cfg = _config()
    if not cfg["url"]:
        return {"enabled": False}
    cursor = await _load_cursor()
    sent = 0
    for _ in range(_MAX_BATCHES_PER_RUN):
        rows = await _fetch_batch(cursor, cfg["orgs"], cfg["batch"])
        if not rows:
            break
        body, ctype = encode_batch([to_event(r) for r in rows], cfg["format"])
        try:
            status = await _post(cfg["url"], body, ctype, cfg)
        except Exception as exc:
            logger.warning("SIEM forward failed (%s); will retry from the same cursor", type(exc).__name__)
            return {"enabled": True, "sent": sent, "error": type(exc).__name__}
        if not 200 <= status < 300:
            logger.warning("SIEM rejected batch with HTTP %s; will retry from the same cursor", status)
            return {"enabled": True, "sent": sent, "error": f"http_{status}"}
        last = rows[-1]
        cursor = {"created_at": last["created_at"].isoformat(), "id": str(last["id"])}
        await _save_cursor(cursor["created_at"], cursor["id"])
        sent += len(rows)
        if len(rows) < cfg["batch"]:
            break
    return {"enabled": True, "sent": sent}
