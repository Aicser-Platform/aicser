"""Regression test: data retention read the plan from organizations.plan_type, a column nothing
updates when an org subscribes. A Team/Pro org (or a self-hosted install) whose row still said
'free' had its uploaded files deleted after the free plan's 7-day history window. The plan now
comes from get_organization_plan (the active subscription), like every plan gate.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.data.services.data_retention_service import DataRetentionService

ORG_ID = "0b94030e-5d22-427c-a109-89ace1073ee1"


def _db_with_org_row():
    db = AsyncMock()
    org_result = MagicMock()
    org_result.fetchall.return_value = [SimpleNamespace(id=ORG_ID, plan_type="free")]
    source_result = MagicMock()
    source_result.fetchall.return_value = []
    db.execute.side_effect = [org_result, source_result]
    return db


@pytest.mark.asyncio
@pytest.mark.parametrize("plan, days", [("team", 365), ("free", 7)])
async def test_history_window_comes_from_subscription_not_org_column(plan, days):
    db = _db_with_org_row()
    with patch(
        "src.modules.data.services.data_retention_service.get_organization_plan",
        new=AsyncMock(return_value=plan),
    ), patch(
        "src.modules.data.services.data_retention_service.get_plan_limits",
        side_effect=lambda p: {"data_history_days": {"team": 365, "free": 7}[p]},
    ) as limits:
        await DataRetentionService(db).cleanup_expired_file_sources(organization_id=ORG_ID)
    limits.assert_called_once_with(plan)
    cutoff_param = db.execute.await_args_list[1].args[1]["cutoff"]
    assert cutoff_param is not None


@pytest.mark.asyncio
async def test_unlimited_history_skips_the_org():
    db = _db_with_org_row()
    with patch(
        "src.modules.data.services.data_retention_service.get_organization_plan",
        new=AsyncMock(return_value="enterprise"),
    ), patch(
        "src.modules.data.services.data_retention_service.get_plan_limits",
        return_value={"data_history_days": -1},
    ):
        deleted = await DataRetentionService(db).cleanup_expired_file_sources(organization_id=ORG_ID)
    assert deleted == 0
    assert db.execute.await_count == 1  # only the org lookup; no source scan
