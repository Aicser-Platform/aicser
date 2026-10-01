"""Audit → SIEM: ordered, gap-free, at-least-once; signed; off unless configured."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from src.shared.audit import siem_forwarder as F

T0 = datetime(2026, 9, 24, 8, 0, tzinfo=timezone.utc)


def _row(i):
    return {"id": f"00000000-0000-0000-0000-{i:012d}", "event_type": "chat_query", "category": "ai",
            "user_id": None, "org_id": "11111111-1111-1111-1111-111111111111", "resource_type": None,
            "resource_id": None, "action": "POST /api/ai/analyze", "ip_address": "10.0.0.1", "user_agent": "x",
            "request_id": "r", "status_code": 200, "duration_ms": 5, "metadata": '{"k": 1}',
            "created_at": T0 + timedelta(seconds=i)}


@pytest.fixture()
def sim(monkeypatch):
    rows = [_row(i) for i in range(1, 6)]
    state = {"cursor": None, "posts": [], "status": 200}

    async def fetch(cursor, orgs, limit):
        key = (datetime.fromisoformat(cursor["created_at"]), cursor["id"]) if cursor else None
        out = [r for r in rows if key is None or (r["created_at"], r["id"]) > key]
        return out[:limit]

    async def post(url, body, ctype, cfg):
        state["posts"].append((body, ctype, cfg))
        return state["status"]

    async def load():
        return state["cursor"]

    async def save(c_at, c_id):
        state["cursor"] = {"created_at": c_at, "id": c_id}

    monkeypatch.setattr(F, "_fetch_batch", fetch)
    monkeypatch.setattr(F, "_post", post)
    monkeypatch.setattr(F, "_load_cursor", load)
    monkeypatch.setattr(F, "_save_cursor", save)
    monkeypatch.setenv("AUDIT_SIEM_URL", "https://siem.example/ingest")
    monkeypatch.setenv("AUDIT_SIEM_BATCH_SIZE", "2")
    return state


@pytest.mark.asyncio
async def test_off_unless_configured(monkeypatch):
    monkeypatch.delenv("AUDIT_SIEM_URL", raising=False)
    assert await F.forward_audit_events() == {"enabled": False}


@pytest.mark.asyncio
async def test_delivers_everything_in_order_in_batches(sim):
    out = await F.forward_audit_events()
    assert out == {"enabled": True, "sent": 5}
    ids = [json.loads(line)["id"][-1] for body, _, _ in sim["posts"] for line in body.decode().splitlines()]
    assert ids == ["1", "2", "3", "4", "5"] and len(sim["posts"]) == 3
    assert (await F.forward_audit_events())["sent"] == 0  # nothing re-sent


@pytest.mark.asyncio
async def test_failure_keeps_cursor_so_nothing_is_lost(sim):
    sim["status"] = 503
    out = await F.forward_audit_events()
    assert out["error"] == "http_503" and sim["cursor"] is None
    sim["status"] = 200
    assert (await F.forward_audit_events())["sent"] == 5


def test_signature_and_splunk_format(monkeypatch):
    body, ctype = F.encode_batch([F.to_event(_row(1))], "splunk_hec")
    evt = json.loads(body)
    assert evt["sourcetype"] == "aicser:audit" and evt["event"]["metadata"] == {"k": 1}
    assert evt["time"] == T0.timestamp() + 1
    assert F.sign(b"abc", "s3cret").startswith("sha256=") and F.sign(b"abc", "s3cret") != F.sign(b"abd", "s3cret")
