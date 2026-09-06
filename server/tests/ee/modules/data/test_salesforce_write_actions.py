"""Regression tests for Salesforce write actions (Phase 2).

Covers: the REST client's PATCH/POST/error handling, each handler's param
validation + audit logging + success/failure shape, and that these actions
are correctly policy-gated (L2_CONFIRM, requires explicit approval) through
the same mechanism every other agentic action uses.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.data.services import salesforce_client
from ee.modules.data.services import salesforce_write_actions as actions


# ---------------------------------------------------------------------------
# salesforce_client: update_record / create_record
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_update_record_succeeds_on_204():
    fake_resp = SimpleNamespace(status_code=204, text="")
    with patch("httpx.AsyncClient.patch", new=AsyncMock(return_value=fake_resp)) as mock_patch:
        await salesforce_client.update_record(
            "https://na1.salesforce.com", "tok", "Opportunity", "006x", {"StageName": "Closed Won"}
        )
    call = mock_patch.call_args
    assert call.args[0] == "https://na1.salesforce.com/services/data/v59.0/sobjects/Opportunity/006x"
    assert call.kwargs["json"] == {"StageName": "Closed Won"}
    assert call.kwargs["headers"]["Authorization"] == "Bearer tok"


@pytest.mark.asyncio
async def test_update_record_raises_on_non_204():
    fake_resp = SimpleNamespace(status_code=400, text='[{"errorCode":"INVALID_FIELD"}]')
    with patch("httpx.AsyncClient.patch", new=AsyncMock(return_value=fake_resp)):
        with pytest.raises(salesforce_client.SalesforceClientError, match="INVALID_FIELD"):
            await salesforce_client.update_record(
                "https://na1.salesforce.com", "tok", "Opportunity", "006x", {"BadField__c": 1}
            )


@pytest.mark.asyncio
async def test_create_record_returns_new_id_on_201():
    fake_resp = SimpleNamespace(
        status_code=201, text="", json=lambda: {"id": "00T1", "success": True, "errors": []}
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_resp)):
        new_id = await salesforce_client.create_record(
            "https://na1.salesforce.com", "tok", "Task", {"Subject": "Follow up"}
        )
    assert new_id == "00T1"


@pytest.mark.asyncio
async def test_create_record_raises_on_success_false():
    fake_resp = SimpleNamespace(
        status_code=201, text="", json=lambda: {"id": None, "success": False, "errors": ["REQUIRED_FIELD_MISSING"]}
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_resp)):
        with pytest.raises(salesforce_client.SalesforceClientError):
            await salesforce_client.create_record(
                "https://na1.salesforce.com", "tok", "Task", {}
            )


# ---------------------------------------------------------------------------
# Handlers: param validation, audit logging, success/failure shape
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _patch_token_resolution():
    with patch(
        "ee.modules.data.services.oauth_connector_service.get_valid_access_token",
        new=AsyncMock(return_value=("fake-token", "https://na1.salesforce.com")),
    ), patch(
        "ee.modules.ai.services.skill_entitlements.check_plan_feature_entitlement",
        new=AsyncMock(return_value=None),  # None = plan allows it (see skill_entitlements.py's contract)
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
async def test_update_opportunity_stage_missing_params_rejected():
    result = await actions.update_opportunity_stage({"organization_id": "org-1"})
    assert result["success"] is False
    assert "source_connection_id" in result["error"]


@pytest.mark.asyncio
async def test_update_opportunity_stage_success_and_audit(_captured_audit_events):
    with patch(
        "ee.modules.data.services.salesforce_client.update_record", new=AsyncMock(return_value=None)
    ) as mock_update:
        result = await actions.update_opportunity_stage({
            "organization_id": "org-1",
            "user_id": "user-1",
            "source_connection_id": "conn-1",
            "record_id": "006ABC",
            "stage_name": "Closed Won",
            "probability": 100,
        })

    assert result["success"] is True
    assert result["record_id"] == "006ABC"
    mock_update.assert_awaited_once()
    fields_sent = mock_update.call_args.args[4]
    assert fields_sent == {"StageName": "Closed Won", "Probability": 100}

    assert len(_captured_audit_events) == 1
    ev = _captured_audit_events[0]
    assert ev["event_type"] == "crm_write_action"
    assert ev["resource_type"] == "Opportunity"
    assert ev["resource_id"] == "006ABC"
    assert ev["metadata"]["success"] is True


@pytest.mark.asyncio
async def test_update_opportunity_stage_failure_is_audited_too(_captured_audit_events):
    with patch(
        "ee.modules.data.services.salesforce_client.update_record",
        new=AsyncMock(side_effect=salesforce_client.SalesforceClientError("boom")),
    ):
        result = await actions.update_opportunity_stage({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "006ABC",
            "stage_name": "Closed Won",
        })

    assert result["success"] is False
    assert "boom" in result["error"]
    assert len(_captured_audit_events) == 1
    assert _captured_audit_events[0]["metadata"]["success"] is False
    assert "boom" in _captured_audit_events[0]["metadata"]["detail"]


@pytest.mark.asyncio
async def test_create_task_builds_optional_fields_correctly():
    with patch(
        "ee.modules.data.services.salesforce_client.create_record", new=AsyncMock(return_value="00T1")
    ) as mock_create:
        result = await actions.create_task({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "subject": "Call back next week",
            "what_id": "006ABC",
            "activity_date": "2026-03-01",
        })

    assert result["success"] is True
    assert result["record_id"] == "00T1"
    fields_sent = mock_create.call_args.args[3]
    assert fields_sent["Subject"] == "Call back next week"
    assert fields_sent["WhatId"] == "006ABC"
    assert fields_sent["ActivityDate"] == "2026-03-01"
    assert "WhoId" not in fields_sent  # not supplied, must not appear as None/empty


@pytest.mark.asyncio
async def test_create_task_missing_subject_rejected():
    result = await actions.create_task({"organization_id": "org-1", "source_connection_id": "conn-1"})
    assert result["success"] is False
    assert "subject" in result["error"]


@pytest.mark.asyncio
async def test_update_lead_status_success():
    with patch(
        "ee.modules.data.services.salesforce_client.update_record", new=AsyncMock(return_value=None)
    ) as mock_update:
        result = await actions.update_lead_status({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "00Q1",
            "status": "Qualified",
        })
    assert result["success"] is True
    assert mock_update.call_args.args[2] == "Lead"
    assert mock_update.call_args.args[4] == {"Status": "Qualified"}


@pytest.mark.asyncio
async def test_add_case_comment_defaults_to_published():
    with patch(
        "ee.modules.data.services.salesforce_client.create_record", new=AsyncMock(return_value="00a1")
    ) as mock_create:
        result = await actions.add_case_comment({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "500ABC",
            "comment_body": "Resolved via patch 4.2",
        })
    assert result["success"] is True
    fields_sent = mock_create.call_args.args[3]
    assert fields_sent["ParentId"] == "500ABC"
    assert fields_sent["IsPublished"] is True


@pytest.mark.asyncio
async def test_add_case_comment_internal_only():
    with patch(
        "ee.modules.data.services.salesforce_client.create_record", new=AsyncMock(return_value="00a2")
    ) as mock_create:
        await actions.add_case_comment({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "500ABC",
            "comment_body": "Internal note",
            "is_published": False,
        })
    assert mock_create.call_args.args[3]["IsPublished"] is False


# ---------------------------------------------------------------------------
# Policy gating: these actions require explicit approval (L2_CONFIRM)
# ---------------------------------------------------------------------------

def test_crm_write_actions_default_to_l2_confirm_tier():
    from ee.modules.ai.services.action_policy_engine import ActionRiskTier, get_action_tier

    for name in ("salesforce_update_opportunity_stage", "salesforce_create_task", "salesforce_update_lead_status", "salesforce_add_case_comment"):
        assert get_action_tier(name) == ActionRiskTier.L2_CONFIRM


def test_crm_write_actions_blocked_without_approval():
    from ee.modules.ai.services.action_policy_engine import evaluate_action

    for name in ("salesforce_update_opportunity_stage", "salesforce_create_task", "salesforce_update_lead_status", "salesforce_add_case_comment"):
        allowed, reason, tier = evaluate_action(name, approved=False)
        assert allowed is False
        assert "approval" in reason.lower()


def test_crm_write_actions_allowed_with_approval():
    from ee.modules.ai.services.action_policy_engine import evaluate_action

    for name in ("salesforce_update_opportunity_stage", "salesforce_create_task", "salesforce_update_lead_status", "salesforce_add_case_comment"):
        allowed, _, _ = evaluate_action(name, approved=True)
        assert allowed is True


@pytest.mark.asyncio
async def test_run_skill_blocks_crm_write_without_approval():
    """End-to-end through the actual skill-execution entrypoint (not just
    the policy function in isolation) -- confirms the registered skill is
    wired to the SAME gate, not bypassable by calling run_skill directly."""
    from ee.modules.ai.skills.registry import run_skill

    result = await run_skill("salesforce_update_opportunity_stage", {
        "organization_id": "org-1",
        "actions_approved": False,
    })
    assert result["success"] is False
    assert result["requires_approval"] is True


@pytest.mark.asyncio
async def test_action_executor_node_has_all_four_crm_handlers_registered():
    from ee.modules.ai.nodes.action_executor_node import _ACTION_HANDLERS

    for name in ("salesforce_update_opportunity_stage", "salesforce_create_task", "salesforce_update_lead_status", "salesforce_add_case_comment"):
        assert name in _ACTION_HANDLERS


@pytest.mark.asyncio
async def test_write_action_blocked_when_plan_lacks_crm_connectors(_captured_audit_events):
    """Defense in depth: even with an active connection, a plan downgrade
    must block the actual write, not just the HTTP connection-management API
    (ee/modules/data/router.py's require_plan_feature gate is a separate
    enforcement point these handlers don't go through -- reachable instead
    via the AI orchestrator's pending_actions path)."""
    with patch(
        "ee.modules.ai.services.skill_entitlements.check_plan_feature_entitlement",
        new=AsyncMock(return_value={
            "success": False, "error": "Salesforce CRM actions requires a higher plan.", "upgrade_required": True,
        }),
    ):
        result = await actions.update_opportunity_stage({
            "organization_id": "org-1",
            "source_connection_id": "conn-1",
            "record_id": "006ABC",
            "stage_name": "Closed Won",
        })
    assert result["success"] is False
    assert "higher plan" in result["error"]
