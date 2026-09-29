"""Resource-access checks for chart/report embed tokens.

Previously only dashboards were verified: anyone with embed:create could mint a
chart or report token for any id. These helpers close that gap.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from src.modules.embed import router as embed_router


@pytest.mark.asyncio
async def test_require_chart_access_rejects_non_uuid():
    with pytest.raises(HTTPException) as exc_info:
        await embed_router._require_chart_access(AsyncMock(), "not-a-uuid", "u1")
    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Chart not found"


@pytest.mark.asyncio
async def test_require_chart_access_allows_owner(monkeypatch):
    chart_id = "11111111-1111-1111-1111-111111111111"
    row = MagicMock(user_id="u1", project_id="p1")
    result = MagicMock()
    result.first.return_value = row
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    enforce = AsyncMock()
    monkeypatch.setattr(embed_router, "enforce_permission", enforce)

    await embed_router._require_chart_access(db, chart_id, "u1")
    enforce.assert_not_called()


@pytest.mark.asyncio
async def test_require_chart_access_checks_project_permission_for_non_owner(monkeypatch):
    chart_id = "11111111-1111-1111-1111-111111111111"
    row = MagicMock(user_id="other", project_id="p1")
    result = MagicMock()
    result.first.return_value = row
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)
    enforce = AsyncMock()
    monkeypatch.setattr(embed_router, "enforce_permission", enforce)

    await embed_router._require_chart_access(db, chart_id, "u1")
    enforce.assert_awaited_once_with("u1", "dashboard:view", project_id="p1")


@pytest.mark.asyncio
async def test_require_report_access_404_when_community_edition(monkeypatch):
    monkeypatch.setattr(embed_router, "is_ee_enabled", lambda: False)
    with pytest.raises(HTTPException) as exc_info:
        await embed_router._require_report_access(AsyncMock(), "c:m", "u1")
    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Report not found"


@pytest.mark.asyncio
async def test_require_report_access_allows_conversation_owner(monkeypatch):
    monkeypatch.setattr(embed_router, "is_ee_enabled", lambda: True)
    conversation_id = "22222222-2222-2222-2222-222222222222"
    result = MagicMock()
    result.mappings.return_value.first.return_value = {"user_id": "u1"}
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)

    await embed_router._require_report_access(db, f"{conversation_id}:msg-1", "u1")


@pytest.mark.asyncio
async def test_require_report_access_rejects_other_users_conversation(monkeypatch):
    monkeypatch.setattr(embed_router, "is_ee_enabled", lambda: True)
    conversation_id = "22222222-2222-2222-2222-222222222222"
    result = MagicMock()
    result.mappings.return_value.first.return_value = {"user_id": "other"}
    db = AsyncMock()
    db.execute = AsyncMock(return_value=result)

    with pytest.raises(HTTPException) as exc_info:
        await embed_router._require_report_access(db, f"{conversation_id}:msg-1", "u1")
    assert exc_info.value.status_code == 404
