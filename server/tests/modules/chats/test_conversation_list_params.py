"""The conversation list is recent-first and honours limit/offset. It used to return the 10
OLDEST conversations (BaseFilterParams defaults: asc, page_size 10, `limit` ignored), so a new
conversation was missing from the list and got cleared as the current one — its answer vanished."""

import uuid

import pytest
from starlette.requests import Request

from ee.modules.chats.conversations import router as conv_router
from src.shared.utils.query_params import BaseFilterParams


def _request(qs: str) -> Request:
    return Request({"type": "http", "method": "GET", "path": "/conversations", "query_string": qs.encode(), "headers": []})


@pytest.fixture
def calls(monkeypatch):
    seen = {}

    async def fake_list(**kwargs):
        seen.update(kwargs)
        return {"items": [], "pagination": {}}

    async def allow(*_a, **_k):
        return None

    monkeypatch.setattr(conv_router.service, "get_all_by_project", fake_list)
    monkeypatch.setattr(conv_router, "_check_project_access", allow)
    return seen


@pytest.mark.asyncio
async def test_defaults_to_newest_first_and_honours_limit(calls):
    pid = str(uuid.uuid4())
    await conv_router.get_conversations(
        request=_request(f"project_id={pid}&limit=100"), params=BaseFilterParams(), project_id=pid,
        current_token={"id": str(uuid.uuid4())},
    )
    assert calls["sort_order"] == "desc"
    assert calls["limit"] == 100
    assert calls["offset"] == 0


@pytest.mark.asyncio
async def test_explicit_order_and_offset_are_respected(calls):
    pid = str(uuid.uuid4())
    await conv_router.get_conversations(
        request=_request(f"project_id={pid}&sort_order=asc&limit=500&offset=20"), params=BaseFilterParams(),
        project_id=pid, current_token={"id": str(uuid.uuid4())},
    )
    assert calls["sort_order"] == "asc"
    assert calls["limit"] == 200  # clamped
    assert calls["offset"] == 20
