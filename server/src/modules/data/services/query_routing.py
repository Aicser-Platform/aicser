"""Routes a database-type data source to its lakehouse (Bronze/Silver/Gold) data
instead of a live production connection, once a pipeline manages it.

This is the single choke point for the "the AI agent must never touch a client's
production database" guarantee: every caller of MultiEngineQueryService reaches
DirectSQLEngine through the same code path (src/modules/data/services/
multi_engine_query_service.py), so gating there (see Task 7) covers chat, the
standalone chart builder, and dashboards without separate wiring in each.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, Optional


class LakehouseNotReady(Exception):
    """A pipeline manages this source, but it has no Gold data yet."""

    def __init__(self, pipeline_id: uuid.UUID, last_run_status: Optional[str]):
        self.pipeline_id = pipeline_id
        self.last_run_status = last_run_status
        super().__init__(
            f"pipeline {pipeline_id} has not produced Gold data yet "
            f"(last run status: {last_run_status or 'never run'})"
        )


async def resolve_query_source(data_source: Dict[str, Any]) -> Dict[str, Any]:
    """`data_source` unchanged, unless it's a pipeline-managed database source.

    - Not a database-like type -> unchanged.
    - No enabled DataPipeline for it -> unchanged (not opted in / grandfathered).
    - Enabled pipeline, no active Gold DataLakeObject yet -> raises LakehouseNotReady.
    - Enabled pipeline, active Gold object exists -> a synthetic source dict
      (type="lakehouse_iceberg") the DuckDB engine can read directly.
    """
    ds_type = (data_source.get("type") or "").lower()
    if ds_type not in ("database", "enterprise_connector"):
        return data_source

    ds_id = data_source.get("id") or data_source.get("data_source_id")
    if not ds_id:
        return data_source

    from sqlalchemy import desc, select

    from src.db.session import async_session
    from src.modules.data.models import (DataIngestionJob, DataLakeObject,
                                          DataPipeline)

    async with async_session() as db:
        pipeline = (
            await db.execute(
                select(DataPipeline).where(
                    DataPipeline.source_asset_type == "data_source",
                    DataPipeline.source_asset_id == str(ds_id),
                    DataPipeline.enabled.is_(True),
                )
            )
        ).scalars().first()

        if pipeline is None:
            return data_source

        gold = (
            await db.execute(
                select(DataLakeObject)
                .where(
                    DataLakeObject.data_source_id == str(ds_id),
                    DataLakeObject.layer == "gold",
                    DataLakeObject.status == "active",
                )
                .order_by(desc(DataLakeObject.created_at))
                .limit(1)
            )
        ).scalars().first()

        if gold is None or not gold.storage_uri:
            last_run = (
                await db.execute(
                    select(DataIngestionJob)
                    .where(DataIngestionJob.pipeline_id == pipeline.id)
                    .order_by(desc(DataIngestionJob.created_at))
                    .limit(1)
                )
            ).scalars().first()
            raise LakehouseNotReady(
                pipeline_id=pipeline.id,
                last_run_status=last_run.status if last_run else None,
            )

        return {
            **data_source,
            "type": "lakehouse_iceberg",
            "storage_uri": gold.storage_uri,
            "format": "iceberg",
            "schema": gold.schema_snapshot,
        }
