"""dbt sync must certify imported metrics (governed compiler path requires it)."""
import inspect
import os

os.environ.setdefault("AISER_EDITION", "enterprise")

from unittest.mock import AsyncMock, patch

import pytest

from src.modules.ai.services.semantic_layer_db import semantic_layer_db
from src.modules.ai.services.dbt_integration_service import dbt_integration_service


def test_upsert_metric_accepts_certified_param():
    sig = inspect.signature(semantic_layer_db.upsert_metric)
    assert "certified" in sig.parameters
    assert sig.parameters["certified"].default is False


def test_upsert_dimension_accepts_certified_param():
    sig = inspect.signature(semantic_layer_db.upsert_dimension)
    assert "certified" in sig.parameters


@pytest.mark.asyncio
async def test_dbt_sync_passes_certified_true(tmp_path):
    sem_manifest = tmp_path / "semantic_manifest.json"
    sem_manifest.write_text(
        '{"metrics": [{"name": "revenue", "type": "simple",'
        ' "type_params": {"measure": {"name": "amount"}}}],'
        ' "semantic_models": []}'
    )
    with patch.object(semantic_layer_db, "upsert_metric",
                      new_callable=AsyncMock,
                      return_value={"success": True}) as mock_upsert:
        await dbt_integration_service.sync_to_aiser(
            semantic_manifest_path=str(sem_manifest), data_source_id="ds1"
        )
    assert mock_upsert.await_count == 1
    assert mock_upsert.await_args.kwargs.get("certified") is True
