"""load_report_payload reshapes a message's ai_metadata into the exact
ReportData shape the in-app report page already builds client-side (its
fetchApi('conversations/...') fallback path) - these lock in that mapping
server-side so the new /embed route and the in-app page never drift apart.
verify_report_read_access reuses the existing embed JWT-token system rather
than a report-specific auth mechanism.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.reports.operations import (
    ReportAccessError,
    load_report_payload,
    verify_report_read_access,
)


def _fake_message(msg_id, ai_metadata, conversation_id="conv-1"):
    return SimpleNamespace(
        id=msg_id,
        conversation_id=conversation_id,
        ai_metadata=ai_metadata,
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-02T00:00:00Z",
    )


def _async_session_returning(messages):
    session = AsyncMock()
    result = SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: messages))
    session.execute = AsyncMock(return_value=result)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_load_report_payload_maps_ai_metadata_to_report_data_shape():
    ai_metadata = {
        "report_plan": {
            "report_title": "Q3 Revenue Review",
            "report_tier": "standard",
            "tier_label": "Standard",
            "template_id": "executive-brief",
        },
        "report_sections": [{"id": "s1", "type": "kpi", "status": "complete", "title": "Revenue"}],
        "executive_summary": "Revenue grew 12% quarter over quarter.",
        "recommendations": [{"title": "Expand APAC", "priority": "high"}],
        "follow_up_questions": ["What drove APAC growth?"],
        "prepared_for": "Jane Doe",
        "organization_name": "Acme Corp",
    }
    message = _fake_message("msg-1", ai_metadata)

    with patch("ee.modules.ai.reports.operations.async_session", return_value=_async_session_returning([message])):
        payload = await load_report_payload("00000000-0000-0000-0000-000000000001", "msg-1")

    assert payload["title"] == "Q3 Revenue Review"
    assert payload["tier"] == "standard"
    assert payload["tierLabel"] == "Standard"
    assert payload["templateId"] == "executive-brief"
    assert payload["sections"] == ai_metadata["report_sections"]
    assert payload["executiveSummary"] == ai_metadata["executive_summary"]
    assert payload["recommendations"] == ai_metadata["recommendations"]
    assert payload["followUpQuestions"] == ai_metadata["follow_up_questions"]
    assert payload["preparedFor"] == "Jane Doe"
    assert payload["organizationName"] == "Acme Corp"
    assert payload["isStreaming"] is False


@pytest.mark.asyncio
async def test_load_report_payload_uses_org_branding_when_nothing_persisted():
    message = _fake_message("msg-1", {"report_plan": {"title": "X"}, "report_sections": []})
    branding = {"name": "Acme Co", "logo_url": "https://cdn.example.com/logo.png"}

    with patch("ee.modules.ai.reports.operations.async_session", return_value=_async_session_returning([message])), \
         patch("ee.modules.organizations.branding.resolve_report_branding", new=AsyncMock(return_value=branding)):
        payload = await load_report_payload(
            "00000000-0000-0000-0000-000000000001", "msg-1", organization_id="org-1"
        )

    assert payload["organizationName"] == "Acme Co"
    assert payload["organizationLogoUrl"] == "https://cdn.example.com/logo.png"


@pytest.mark.asyncio
async def test_load_report_payload_prefers_persisted_organization_name_over_branding():
    message = _fake_message("msg-1", {
        "report_plan": {"title": "X"},
        "report_sections": [],
        "organization_name": "Persisted Name",
    })
    branding = {"name": "Fresh Org Name", "logo_url": None}

    with patch("ee.modules.ai.reports.operations.async_session", return_value=_async_session_returning([message])), \
         patch("ee.modules.organizations.branding.resolve_report_branding", new=AsyncMock(return_value=branding)):
        payload = await load_report_payload(
            "00000000-0000-0000-0000-000000000001", "msg-1", organization_id="org-1"
        )

    assert payload["organizationName"] == "Persisted Name"


@pytest.mark.asyncio
async def test_load_report_payload_matches_assistant_suffixed_message_id():
    message = _fake_message("msg-1", {"report_plan": {"title": "X"}, "report_sections": []})

    with patch("ee.modules.ai.reports.operations.async_session", return_value=_async_session_returning([message])):
        payload = await load_report_payload("00000000-0000-0000-0000-000000000001", "msg-1-assistant")

    assert payload["messageId"] == "msg-1"


@pytest.mark.asyncio
async def test_load_report_payload_raises_404_when_message_not_found():
    with patch("ee.modules.ai.reports.operations.async_session", return_value=_async_session_returning([])):
        with pytest.raises(ReportAccessError) as exc_info:
            await load_report_payload("00000000-0000-0000-0000-000000000001", "missing")

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_load_report_payload_raises_404_when_message_has_no_report_data():
    message = _fake_message("msg-1", {"some_other_field": True})

    with patch("ee.modules.ai.reports.operations.async_session", return_value=_async_session_returning([message])):
        with pytest.raises(ReportAccessError) as exc_info:
            await load_report_payload("00000000-0000-0000-0000-000000000001", "msg-1")

    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_load_report_payload_rejects_malformed_conversation_id():
    with pytest.raises(ReportAccessError) as exc_info:
        await load_report_payload("not-a-uuid", "msg-1")
    assert exc_info.value.status_code == 404


@pytest.mark.asyncio
async def test_verify_report_read_access_requires_a_token():
    with pytest.raises(ReportAccessError) as exc_info:
        await verify_report_read_access("conv-1", "msg-1", None)
    assert exc_info.value.status_code == 401


@pytest.mark.asyncio
async def test_verify_report_read_access_rejects_mismatched_resource_scope():
    verified = {"resource_id": "conv-1:msg-OTHER", "org_id": "org-1"}
    with patch("src.modules.embed.service.verify_embed_token", new=AsyncMock(return_value=verified)):
        with pytest.raises(ReportAccessError) as exc_info:
            await verify_report_read_access("conv-1", "msg-1", "sometoken")
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_verify_report_read_access_accepts_matching_resource_scope():
    verified = {"resource_id": "conv-1:msg-1", "org_id": "org-1"}
    with patch("src.modules.embed.service.verify_embed_token", new=AsyncMock(return_value=verified)):
        result = await verify_report_read_access("conv-1", "msg-1", "sometoken")
    assert result["organization_id"] == "org-1"
