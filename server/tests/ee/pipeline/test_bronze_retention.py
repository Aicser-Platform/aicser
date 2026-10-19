import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.modules.pipeline.bronze_retention import apply_bronze_retention, effective_bronze_retention_days


def test_effective_retention_pipeline_over_org():
    pipeline = SimpleNamespace(options={"movement_policy": {"bronze_retention_days": 7}})
    assert effective_bronze_retention_days(pipeline, {"default_bronze_retention_days": 30}) == 7


def test_effective_retention_org_default():
    pipeline = SimpleNamespace(options={})
    assert effective_bronze_retention_days(pipeline, {"default_bronze_retention_days": 30}) == 30


@pytest.mark.asyncio
async def test_apply_supersedes_only_stale_not_newest_per_table():
    from src.modules.pipeline.bronze_retention import apply_bronze_retention

    org_id = uuid.uuid4()
    ds_id = "ds-1"
    now = datetime.now(timezone.utc)
    old = SimpleNamespace(
        id=uuid.uuid4(),
        source_table="orders",
        created_at=now - timedelta(days=40),
        status="active",
    )
    newest = SimpleNamespace(
        id=uuid.uuid4(),
        source_table="orders",
        created_at=now - timedelta(days=2),
        status="active",
    )
    stale_other = SimpleNamespace(
        id=uuid.uuid4(),
        source_table="orders",
        created_at=now - timedelta(days=50),
        status="active",
    )

    session = AsyncMock()
    session.execute = AsyncMock(
        return_value=MagicMock(scalars=MagicMock(return_value=MagicMock(all=lambda: [old, newest, stale_other])))
    )

    pipeline = SimpleNamespace(
        organization_id=org_id,
        source_asset_type="data_source",
        source_asset_id=ds_id,
        options={"movement_policy": {"bronze_retention_days": 30}},
    )
    result = await apply_bronze_retention(session, pipeline, {})
    assert result["superseded"] == 2
    assert session.execute.await_count >= 2
