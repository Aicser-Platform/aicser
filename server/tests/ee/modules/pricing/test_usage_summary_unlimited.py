"""Uncapped plan limits stored as NULL must read as unlimited, not crash the usage summary."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ee.modules.pricing import usage_tracker


def _db():
    result = MagicMock()
    result.scalars.return_value.all.return_value = []
    result.scalar.return_value = 0
    result.scalar_one_or_none.return_value = None
    result.first.return_value = None
    result.all.return_value = []
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)
    db.scalar = AsyncMock(return_value=0)
    return db


@pytest.mark.asyncio
async def test_null_limits_are_unlimited():
    limits = {"ai_credits_limit": None, "api_calls_per_month": None, "embed_views_limit": None, "storage_limit_gb": None,
              "max_projects": None, "max_data_sources": None, "max_users": None}
    with patch.object(usage_tracker, "_get_effective_plan_limits", new=AsyncMock(return_value=("enterprise", limits))), \
         patch.object(usage_tracker, "is_self_host_deployment", return_value=False):
        summary = await usage_tracker.get_usage_summary("20481fd3-6ebc-451f-967f-a87570ba1375", _db())
    assert summary["api_calls"]["unlimited"] is True
    assert summary["api_calls"]["percentage"] == 0
    assert summary["ai_credits"]["unlimited"] is True
