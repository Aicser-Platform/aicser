"""Plan-entitlement gating for agent-skill action handlers.

create_alert/schedule_email/generate_pptx are paid-tier capabilities
(PLAN_CONFIGS: alerts, scheduled_reports, export_formats). A free-tier or
unresolvable org must be denied before any side effect (DB write, deck
generation) runs.
"""
from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.services.action_handlers import (
    handle_create_alert,
    handle_schedule_email,
    handle_generate_pptx,
)


@pytest.mark.asyncio
async def test_create_alert_denied_on_free_plan():
    result = await handle_create_alert(
        {
            "organization_id": "org-1",
            "user_id": "user-1",
            "sql_query": "SELECT 1",
        }
    )
    assert result.get("success") is False
    assert result.get("upgrade_required") is True
    assert result.get("feature") == "alerts"


@pytest.mark.asyncio
async def test_create_alert_allowed_bypasses_to_real_handler(monkeypatch):
    monkeypatch.setattr(
        "ee.modules.ai.services.skill_entitlements.check_plan_feature_entitlement",
        AsyncMock(return_value=None),
    )
    # No DB-backed org/alert service in this unit test -- once past the gate,
    # it should fail for a *different* reason (service lookup), not the gate.
    result = await handle_create_alert(
        {
            "organization_id": "org-1",
            "user_id": "user-1",
            "sql_query": "SELECT 1",
        }
    )
    assert result.get("feature") != "alerts"


@pytest.mark.asyncio
async def test_schedule_email_denied_on_free_plan():
    result = await handle_schedule_email(
        {
            "organization_id": "org-1",
            "user_id": "user-1",
            "user_email": "a@example.com",
        }
    )
    assert result.get("success") is False
    assert result.get("upgrade_required") is True
    assert result.get("feature") == "scheduled_reports"


@pytest.mark.asyncio
async def test_generate_pptx_denied_on_free_plan():
    result = await handle_generate_pptx(
        {
            "organization_id": "org-1",
            "conversation_id": "conv-1",
            "query": "Quarterly review",
        }
    )
    assert result.get("success") is False
    assert result.get("upgrade_required") is True
    assert result.get("feature") == "export_formats"
