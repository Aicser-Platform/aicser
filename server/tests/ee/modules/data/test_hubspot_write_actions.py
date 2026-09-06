"""Regression tests for HubSpot write actions (Phase 2, second vendor).

Mirrors test_salesforce_write_actions.py's coverage.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.data.services import hubspot_client
from ee.modules.data.services import hubspot_write_actions as actions


@pytest.mark.asyncio
async def test_update_record_succeeds_on_200():
    fake_resp = SimpleNamespace(status_code=200, text="")
    with patch("httpx.AsyncClient.patch", new=AsyncMock(return_value=fake_resp)) as mock_patch:
        await hubspot_client.update_record("tok", "deals", "1", {"dealstage": "closedwon"})
    call = mock_patch.call_args
    assert call.args[0] == "https://api.hubapi.com/crm/v3/objects/deals/1"
    assert call.kwargs["json"] == {"properties": {"dealstage": "closedwon"}}


@pytest.mark.asyncio
async def test_update_record_raises_on_error():
    fake_resp = SimpleNamespace(status_code=404, text='{"message":"deal not found"}')
    with patch("httpx.AsyncClient.patch", new=AsyncMock(return_value=fake_resp)):
        with pytest.raises(hubspot_client.HubSpotClientError, match="not found"):
            await hubspot_client.update_record("tok", "deals", "bad-id", {})


@pytest.mark.asyncio
async def test_create_record_returns_id():
    fake_resp = SimpleNamespace(status_code=201, text="", json=lambda: {"id": "999", "properties": {}})
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_resp)):
        new_id = await hubspot_client.create_record("tok", "tasks", {"hs_task_subject": "Follow up"})
    assert new_id == "999"


@pytest.mark.asyncio
async def test_create_record_raises_when_no_id_in_response():
    fake_resp = SimpleNamespace(status_code=201, text="", json=lambda: {})
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_resp)):
        with pytest.raises(hubspot_client.HubSpotClientError):
            await hubspot_client.create_record("tok", "tasks", {})


@pytest.fixture(autouse=True)
def _patch_token_resolution():
    with patch(
        "ee.modules.data.services.oauth_connector_service.get_valid_access_token",
        new=AsyncMock(return_value=("fake-token", "https://api.hubapi.com")),
    ), patch(
        "ee.modules.ai.services.skill_entitlements.check_plan_feature_entitlement",
        new=AsyncMock(return_value=None),
    ):
        yield


@pytest.fixture
def _captured_audit_events():
    events = []

    async def _fake_log(**kwargs):
        events.append(kwargs)

    with patch("src.shared.middleware.audit_logger.log_audit_event", new=_fake_log):
        yield events


@pytest.mark.asyncio
async def test_update_deal_stage_missing_params_rejected():
    result = await actions.hubspot_update_deal_stage({"organization_id": "org-1"})
    assert result["success"] is False
    assert "source_connection_id" in result["error"]


@pytest.mark.asyncio
async def test_update_deal_stage_success_and_audit(_captured_audit_events):
    with patch(
        "ee.modules.data.services.hubspot_client.update_record", new=AsyncMock(return_value=None)
    ) as mock_update:
        result = await actions.hubspot_update_deal_stage({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "1",
            "deal_stage": "closedwon",
            "amount": 50000,
        })

    assert result["success"] is True
    assert result["record_id"] == "1"
    fields_sent = mock_update.call_args.args[3]
    assert fields_sent == {"dealstage": "closedwon", "amount": 50000}
    assert mock_update.call_args.args[1] == "deals"

    assert len(_captured_audit_events) == 1
    ev = _captured_audit_events[0]
    assert ev["event_type"] == "crm_write_action"
    assert ev["metadata"]["vendor"] == "hubspot"
    assert ev["metadata"]["success"] is True


@pytest.mark.asyncio
async def test_update_deal_stage_failure_is_audited(_captured_audit_events):
    with patch(
        "ee.modules.data.services.hubspot_client.update_record",
        new=AsyncMock(side_effect=hubspot_client.HubSpotClientError("boom")),
    ):
        result = await actions.hubspot_update_deal_stage({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "1",
            "deal_stage": "closedwon",
        })
    assert result["success"] is False
    assert "boom" in result["error"]
    assert _captured_audit_events[0]["metadata"]["success"] is False


@pytest.mark.asyncio
async def test_update_lead_status_targets_contacts_object():
    with patch(
        "ee.modules.data.services.hubspot_client.update_record", new=AsyncMock(return_value=None)
    ) as mock_update:
        result = await actions.hubspot_update_lead_status({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "42",
            "status": "OPEN",
        })
    assert result["success"] is True
    assert mock_update.call_args.args[1] == "contacts"
    assert mock_update.call_args.args[3] == {"hs_lead_status": "OPEN"}


@pytest.mark.asyncio
async def test_update_ticket_stage_targets_tickets_object():
    with patch(
        "ee.modules.data.services.hubspot_client.update_record", new=AsyncMock(return_value=None)
    ) as mock_update:
        result = await actions.hubspot_update_ticket_stage({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "77",
            "pipeline_stage": "resolved",
        })
    assert result["success"] is True
    assert mock_update.call_args.args[1] == "tickets"
    assert mock_update.call_args.args[3] == {"hs_pipeline_stage": "resolved"}


@pytest.mark.asyncio
async def test_create_task_builds_optional_fields():
    with patch(
        "ee.modules.data.services.hubspot_client.create_record", new=AsyncMock(return_value="500")
    ) as mock_create:
        result = await actions.hubspot_create_task({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "subject": "Call back",
            "due_date": "2026-03-01T00:00:00Z",
        })
    assert result["success"] is True
    assert result["record_id"] == "500"
    fields_sent = mock_create.call_args.args[2]
    assert fields_sent["hs_task_subject"] == "Call back"
    assert fields_sent["hs_timestamp"] == "2026-03-01T00:00:00Z"
    assert mock_create.call_args.args[1] == "tasks"


@pytest.mark.asyncio
async def test_create_task_missing_subject_rejected():
    result = await actions.hubspot_create_task({"organization_id": "org-1", "source_connection_id": "conn-1"})
    assert result["success"] is False
    assert "subject" in result["error"]


# ---------------------------------------------------------------------------
# Policy gating: same L2_CONFIRM contract as Salesforce's actions
# ---------------------------------------------------------------------------

def test_hubspot_write_actions_default_to_l2_confirm_tier():
    from ee.modules.ai.services.action_policy_engine import ActionRiskTier, get_action_tier

    for name in ("hubspot_update_deal_stage", "hubspot_update_lead_status", "hubspot_update_ticket_stage", "hubspot_create_task"):
        assert get_action_tier(name) == ActionRiskTier.L2_CONFIRM


def test_hubspot_write_actions_blocked_without_approval():
    from ee.modules.ai.services.action_policy_engine import evaluate_action

    for name in ("hubspot_update_deal_stage", "hubspot_update_lead_status", "hubspot_update_ticket_stage", "hubspot_create_task"):
        allowed, reason, tier = evaluate_action(name, approved=False)
        assert allowed is False


@pytest.mark.asyncio
async def test_run_skill_blocks_hubspot_write_without_approval():
    from ee.modules.ai.skills.registry import run_skill

    result = await run_skill("hubspot_update_deal_stage", {"organization_id": "org-1", "actions_approved": False})
    assert result["success"] is False
    assert result["requires_approval"] is True


@pytest.mark.asyncio
async def test_action_executor_node_has_all_four_hubspot_handlers_registered():
    from ee.modules.ai.nodes.action_executor_node import _ACTION_HANDLERS

    for name in ("hubspot_update_deal_stage", "hubspot_update_lead_status", "hubspot_update_ticket_stage", "hubspot_create_task"):
        assert name in _ACTION_HANDLERS


def test_no_skill_name_collisions_between_salesforce_and_hubspot():
    """Regression guard for the exact bug this session caught before
    shipping: unprefixed action names silently overwriting each other in
    the shared skill registry."""
    from ee.modules.ai.skills.registry import list_skills_discovery

    names = [s["name"] for s in list_skills_discovery()]
    assert len(names) == len(set(names)), "duplicate skill name registered"


@pytest.mark.asyncio
async def test_write_action_blocked_when_plan_lacks_crm_connectors():
    with patch(
        "ee.modules.ai.services.skill_entitlements.check_plan_feature_entitlement",
        new=AsyncMock(return_value={
            "success": False, "error": "HubSpot CRM actions requires a higher plan.", "upgrade_required": True,
        }),
    ):
        result = await actions.hubspot_update_deal_stage({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "1",
            "deal_stage": "closedwon",
        })
    assert result["success"] is False
    assert "higher plan" in result["error"]
