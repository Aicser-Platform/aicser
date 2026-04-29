"""
StreamingIngestionService — ClickHouse Kafka Engine DDL generator and lifecycle manager.

Plan-gated via `require_plan_feature("streaming")` (Pro/Team/Enterprise); not tied to AISER_EDITION.

Responsibility:
- Generate and execute DDL to wire a Kafka topic into a ClickHouse landing table + Materialized View.
- Persist stream definitions to PostgreSQL `stream_definitions` table.
- Query ClickHouse system tables to monitor consumer lag and throughput.

`streaming_mode`:
- **realtime** — smaller Kafka poll batches / blocks for lower latency.
- **microbatch** — larger blocks for higher throughput (ClickHouse Kafka SETTINGS).

Data flow:
  Kafka topic → ClickHouse Kafka Engine table (transient buffer)
              → Materialized View (INSERT SELECT trigger)
              → MergeTree landing table (queryable via DirectSQL / AI pipeline)

All DDL is executed via the existing DirectSQLEngine on the user's connected ClickHouse data source.
"""

import logging
import os
import uuid
from typing import Any, Optional

from pydantic import BaseModel

logger = logging.getLogger(__name__)


def _is_clickhouse(data_source: dict) -> bool:
    dt = (data_source.get("db_type") or data_source.get("type") or "").lower()
    return "clickhouse" in dt


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class ColumnDef(BaseModel):
    name: str
    ch_type: str  # ClickHouse type, e.g. "String", "Float64", "DateTime"


class StreamDefinition(BaseModel):
    data_source_id: str          # UUID of the connected ClickHouse DataSource
    kafka_brokers: str           # comma-separated broker list
    topic: str
    consumer_group: str = "aiser"
    format: str = "JSONEachRow"  # JSONEachRow | CSV | Avro
    target_table: str            # MergeTree landing table name
    columns: list[ColumnDef]     # schema columns (excluding ClickHouse internal _topic/_partition etc.)
    streaming_mode: str = "realtime"  # realtime | microbatch


class StreamDefinitionRecord(BaseModel):
    id: str
    org_id: str
    data_source_id: str
    kafka_brokers: str
    topic: str
    target_table: str
    ch_kafka_table: str
    ch_mv_name: str
    streaming_mode: str
    status: str  # active | paused | error


# ---------------------------------------------------------------------------
# DDL helpers
# ---------------------------------------------------------------------------

def _kafka_extra_settings(streaming_mode: str) -> str:
    """Tune Kafka engine for latency (realtime) vs throughput (microbatch)."""
    m = (streaming_mode or "realtime").lower()
    if m == "microbatch":
        return """    kafka_max_block_size = 1048576,
    kafka_poll_max_batch_size = 1000"""
    return """    kafka_max_block_size = 65536,
    kafka_poll_max_batch_size = 50"""


def _kafka_table_ddl(defn: StreamDefinition, kafka_table_name: str) -> str:
    """Generate ClickHouse Kafka engine table DDL."""
    cols = ",\n    ".join(f"`{c.name}` {c.ch_type}" for c in defn.columns)
    extra = _kafka_extra_settings(defn.streaming_mode)
    return f"""
CREATE TABLE IF NOT EXISTS `{kafka_table_name}` (
    {cols}
)
ENGINE = Kafka
SETTINGS
    kafka_broker_list = '{defn.kafka_brokers}',
    kafka_topic_list = '{defn.topic}',
    kafka_group_name = '{defn.consumer_group}',
    kafka_format = '{defn.format}',
    kafka_num_consumers = 1,
{extra}
""".strip()


def _mergetree_table_ddl(defn: StreamDefinition) -> str:
    """Generate ClickHouse MergeTree landing table DDL."""
    cols = ",\n    ".join(f"`{c.name}` {c.ch_type}" for c in defn.columns)
    # Use the first DateTime/Date column as the ORDER BY key, or fall back to tuple()
    ts_col = next(
        (c.name for c in defn.columns if "DateTime" in c.ch_type or "Date" == c.ch_type),
        None,
    )
    order_by = f"`{ts_col}`" if ts_col else "tuple()"
    partition_by = f"toYYYYMM(`{ts_col}`)" if ts_col else None
    partition_clause = f"\nPARTITION BY {partition_by}" if partition_by else ""
    return f"""
CREATE TABLE IF NOT EXISTS `{defn.target_table}` (
    {cols}
)
ENGINE = MergeTree(){partition_clause}
ORDER BY {order_by}
""".strip()


def _mv_ddl(mv_name: str, kafka_table_name: str, target_table: str) -> str:
    """Generate ClickHouse Materialized View that moves data from Kafka table to landing table."""
    return f"""
CREATE MATERIALIZED VIEW IF NOT EXISTS `{mv_name}`
TO `{target_table}`
AS SELECT *
FROM `{kafka_table_name}`
""".strip()


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class StreamingIngestionService:
    """Manages ClickHouse Kafka Engine streams for real-time log/IoT/event ingestion."""

    def __init__(self, db_session: Any = None) -> None:
        self._db = db_session

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def create_stream(self, defn: StreamDefinition, org_id: str) -> dict:
        """
        Provision ClickHouse Kafka engine + MV + landing table, then persist record.

        Returns: {"success": bool, "stream_id": str, "kafka_table": str, "mv_name": str}
        """
        stream_id = str(uuid.uuid4())
        kafka_table = f"kafka_{defn.topic.replace('-', '_').replace('.', '_')}"
        mv_name = f"mv_{defn.target_table}"

        ddl_statements = [
            _mergetree_table_ddl(defn),
            _kafka_table_ddl(defn, kafka_table),
            _mv_ddl(mv_name, kafka_table, defn.target_table),
        ]

        # Execute DDL via DirectSQLEngine on the linked ClickHouse source
        from src.modules.data.services.multi_engine_query_service import DirectSQLEngine
        engine = DirectSQLEngine()

        # Fetch data source connection info (must belong to org + be ClickHouse)
        data_source = await self._get_data_source_for_org(defn.data_source_id, org_id)
        if not data_source:
            return {"success": False, "error": "Data source not found or not accessible for this workspace."}
        if not _is_clickhouse(data_source):
            return {"success": False, "error": "Streaming ingestion requires a ClickHouse data source."}

        for ddl in ddl_statements:
            result = await engine.execute(ddl, data_source, {"analytics_type": "direct_sql"})
            if not result.get("success"):
                logger.error(f"❌ DDL failed: {result.get('error')}\nDDL: {ddl}")
                return {"success": False, "error": result.get("error", "DDL execution failed")}

        # Persist record
        if self._db:
            await self._persist_stream(
                stream_id=stream_id,
                org_id=org_id,
                defn=defn,
                kafka_table=kafka_table,
                mv_name=mv_name,
            )

        logger.info(f"✅ Stream created: topic={defn.topic} → table={defn.target_table} (stream_id={stream_id})")
        return {
            "success": True,
            "stream_id": stream_id,
            "kafka_table": kafka_table,
            "mv_name": mv_name,
            "target_table": defn.target_table,
        }

    async def get_stream_status(self, stream_id: str, org_id: str) -> dict:
        """Query ClickHouse system.kafka_consumers for lag + throughput."""
        record = await self._get_stream_record_for_org(stream_id, org_id)
        if not record:
            return {"error": "Stream not found"}

        data_source = await self._get_data_source_for_org(record["data_source_id"], org_id)
        if not data_source:
            return {"error": "Data source not found"}

        status_sql = f"""
SELECT
    consumer_id,
    assignments,
    messages_received,
    last_exception
FROM system.kafka_consumers
WHERE stream_name = '{record["ch_kafka_table"]}'
""".strip()

        from src.modules.data.services.multi_engine_query_service import DirectSQLEngine
        engine = DirectSQLEngine()
        result = await engine.execute(status_sql, data_source, {})
        return {
            "stream_id": stream_id,
            "status": record.get("status", "unknown"),
            "consumers": result.get("data", []),
        }

    async def test_stream(self, stream_id: str, org_id: str) -> dict:
        """Consume 5 messages from the Kafka engine table (non-destructive peek)."""
        record = await self._get_stream_record_for_org(stream_id, org_id)
        if not record:
            return {"error": "Stream not found"}

        data_source = await self._get_data_source_for_org(record["data_source_id"], org_id)
        if not data_source:
            return {"error": "Data source not found"}

        from src.modules.data.services.multi_engine_query_service import DirectSQLEngine
        engine = DirectSQLEngine()
        result = await engine.execute(
            f"SELECT * FROM `{record['ch_kafka_table']}` LIMIT 5",
            data_source,
            {},
        )
        return result

    async def delete_stream(self, stream_id: str, org_id: str) -> dict:
        """Drop Kafka engine table + MV, then remove DB record."""
        record = await self._get_stream_record_for_org(stream_id, org_id)
        if not record:
            return {"error": "Stream not found"}

        data_source = await self._get_data_source_for_org(record["data_source_id"], org_id)
        if not data_source:
            return {"error": "Data source not found"}

        from src.modules.data.services.multi_engine_query_service import DirectSQLEngine
        engine = DirectSQLEngine()

        for stmt in [
            f"DROP VIEW IF EXISTS `{record['ch_mv_name']}`",
            f"DROP TABLE IF EXISTS `{record['ch_kafka_table']}`",
        ]:
            await engine.execute(stmt, data_source, {})

        if self._db:
            await self._delete_stream_record(stream_id, org_id)

        return {"success": True, "stream_id": stream_id}

    async def list_streams(self, org_id: str) -> list[dict]:
        """Return all stream definition records for the organisation."""
        if not self._db:
            return []
        try:
            import sqlalchemy as sa
            result = await self._db.execute(
                sa.text(
                    "SELECT id, org_id, data_source_id, kafka_brokers, topic, target_table, "
                    "ch_kafka_table, ch_mv_name, streaming_mode, status, created_at "
                    "FROM stream_definitions WHERE org_id = :org_id ORDER BY created_at DESC"
                ),
                {"org_id": org_id},
            )
            rows = result.fetchall()
            return [dict(row._mapping) for row in rows]
        except Exception as e:
            logger.error(f"❌ list_streams failed: {e}")
            return []

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _get_data_source(self, data_source_id: str) -> Optional[dict]:
        if not self._db:
            return None
        try:
            import sqlalchemy as sa
            result = await self._db.execute(
                sa.text(
                    "SELECT id, name, type, db_type, connection_string, connection_config, host, port, database_name "
                    "FROM data_sources WHERE id = :id"
                ),
                {"id": data_source_id},
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        except Exception as e:
            logger.error(f"❌ _get_data_source failed: {e}")
            return None

    async def _get_data_source_for_org(self, data_source_id: str, org_id: str) -> Optional[dict]:
        """Resolve data source only if it belongs to a project in the caller's organization."""
        if not self._db or not org_id:
            return None
        try:
            import sqlalchemy as sa
            result = await self._db.execute(
                sa.text(
                    """
                    SELECT ds.id, ds.name, ds.type, ds.db_type, ds.connection_string, ds.connection_config,
                           ds.host, ds.port, ds.database_name
                    FROM data_sources ds
                    INNER JOIN projects p ON ds.project_id = p.id
                    WHERE ds.id = :id AND CAST(p.organization_id AS TEXT) = :org_id
                    """
                ),
                {"id": data_source_id, "org_id": str(org_id)},
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        except Exception as e:
            logger.error(f"❌ _get_data_source_for_org failed: {e}")
            return None

    async def _get_stream_record_for_org(self, stream_id: str, org_id: str) -> Optional[dict]:
        if not self._db or not org_id:
            return None
        try:
            import sqlalchemy as sa
            result = await self._db.execute(
                sa.text(
                    "SELECT id, org_id, data_source_id, kafka_brokers, topic, target_table, "
                    "ch_kafka_table, ch_mv_name, streaming_mode, status "
                    "FROM stream_definitions WHERE id = :id AND org_id = :org_id"
                ),
                {"id": stream_id, "org_id": org_id},
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        except Exception as e:
            logger.error(f"❌ _get_stream_record_for_org failed: {e}")
            return None

    async def _persist_stream(
        self,
        stream_id: str,
        org_id: str,
        defn: StreamDefinition,
        kafka_table: str,
        mv_name: str,
    ) -> None:
        try:
            import sqlalchemy as sa
            await self._db.execute(
                sa.text(
                    "INSERT INTO stream_definitions "
                    "(id, org_id, data_source_id, kafka_brokers, topic, target_table, "
                    "ch_kafka_table, ch_mv_name, streaming_mode, status) "
                    "VALUES (:id, :org_id, :ds_id, :brokers, :topic, :target, :kafka_tbl, :mv, :mode, 'active')"
                ),
                {
                    "id": stream_id,
                    "org_id": org_id,
                    "ds_id": defn.data_source_id,
                    "brokers": defn.kafka_brokers,
                    "topic": defn.topic,
                    "target": defn.target_table,
                    "kafka_tbl": kafka_table,
                    "mv": mv_name,
                    "mode": defn.streaming_mode,
                },
            )
            await self._db.commit()
        except Exception as e:
            logger.error(f"❌ _persist_stream failed: {e}")

    async def _get_stream_record(self, stream_id: str) -> Optional[dict]:
        if not self._db:
            return None
        try:
            import sqlalchemy as sa
            result = await self._db.execute(
                sa.text(
                    "SELECT id, org_id, data_source_id, kafka_brokers, topic, target_table, "
                    "ch_kafka_table, ch_mv_name, streaming_mode, status "
                    "FROM stream_definitions WHERE id = :id"
                ),
                {"id": stream_id},
            )
            row = result.fetchone()
            return dict(row._mapping) if row else None
        except Exception as e:
            logger.error(f"❌ _get_stream_record failed: {e}")
            return None

    async def _delete_stream_record(self, stream_id: str, org_id: str) -> None:
        try:
            import sqlalchemy as sa
            await self._db.execute(
                sa.text("DELETE FROM stream_definitions WHERE id = :id AND org_id = :org_id"),
                {"id": stream_id, "org_id": org_id},
            )
            await self._db.commit()
        except Exception as e:
            logger.error(f"❌ _delete_stream_record failed: {e}")
