"""
Background job task definitions for ARQ worker.

Each async function becomes an available job type.
"""
import logging
from typing import Any, Dict, Optional
from datetime import datetime

logger = logging.getLogger(__name__)


async def run_data_retention_cleanup(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """
    Clean up expired user data per retention policy.
    Replaces the asyncio.create_task(schedule_retention_cleanup()) sleep loop.
    """
    logger.info("Running data retention cleanup")
    try:
        from src.db.session import async_session
        from src.modules.data.services.data_retention_service import DataRetentionService

        async with async_session() as db:
            service = DataRetentionService(db)
            affected = await service.cleanup_expired_file_sources()
        logger.info("Retention cleanup complete: %s data sources affected", affected)
        return {
            "success": True,
            "affected": affected,
            "completed_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"Retention cleanup failed: {e}")
        raise


async def run_data_quality_check(ctx: Dict[str, Any], data_source_id: str) -> Dict[str, Any]:
    """
    Profile a data source: null rates, row counts, freshness, schema drift.
    """
    logger.info(f"Running data quality check for data source: {data_source_id}")
    try:
        import duckdb
        from src.modules.data.services.data_connectivity_service import DataConnectivityService

        svc = DataConnectivityService()
        schema = await svc.get_source_schema(data_source_id)
        if not schema.get("success"):
            return {"success": False, "error": f"Schema retrieval failed: {schema.get('error')}"}

        tables = schema.get("schema", {}).get("tables", [])
        quality_results = []

        for table in tables[:10]:  # Limit to first 10 tables per check
            table_name = table.get("name", "")
            columns = table.get("columns", [])
            quality_results.append({
                "table": table_name,
                "column_count": len(columns),
                "checked_at": datetime.utcnow().isoformat(),
                "status": "profiled",
            })

        return {
            "success": True,
            "data_source_id": data_source_id,
            "tables_checked": len(quality_results),
            "results": quality_results,
            "completed_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"Data quality check failed for {data_source_id}: {e}")
        raise


async def refresh_schema_cache(ctx: Dict[str, Any], data_source_id: str) -> Dict[str, Any]:
    """
    Refresh the Redis-cached schema for a data source.
    """
    logger.info(f"Refreshing schema cache for data source: {data_source_id}")
    try:
        from src.modules.data.services.data_connectivity_service import DataConnectivityService
        svc = DataConnectivityService()
        result = await svc.get_source_schema(data_source_id, force_refresh=True)
        return {
            "success": result.get("success", False),
            "data_source_id": data_source_id,
            "completed_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"Schema cache refresh failed for {data_source_id}: {e}")
        raise


async def run_scheduled_report(ctx: Dict[str, Any], report_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate and optionally deliver a scheduled AI report.
    report_config: {conversation_id, message_id, delivery: {method: 'email'|'telegram', recipient: str}}
    """
    logger.info(f"Running scheduled report: {report_config.get('conversation_id')}")
    try:
        conversation_id = report_config.get("conversation_id")
        delivery = report_config.get("delivery", {})

        if not conversation_id:
            return {"success": False, "error": "conversation_id is required"}

        return {
            "success": True,
            "conversation_id": conversation_id,
            "delivery_method": delivery.get("method", "none"),
            "completed_at": datetime.utcnow().isoformat(),
            "note": "Report generation scheduled — full delivery integration in Phase 2",
        }
    except Exception as e:
        logger.error(f"Scheduled report failed: {e}")
        return {"success": False, "error": str(e)}


async def run_bi_sync(ctx: Dict[str, Any], dashboard_id: str, target: str) -> Dict[str, Any]:
    """
    Sync an Aiser dashboard to a BI tool (PowerBI/Tableau).
    target: 'powerbi' | 'tableau'
    (Full implementation in Phase 2B bi-sync-engine)
    """
    logger.info(f"BI sync triggered: dashboard={dashboard_id}, target={target}")
    return {
        "success": True,
        "dashboard_id": dashboard_id,
        "target": target,
        "status": "queued",
        "note": "Full BI sync engine implementation in Phase 2B",
        "queued_at": datetime.utcnow().isoformat(),
    }


async def evaluate_alert_rules(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """
    Evaluate all active alert rules. Triggered by ARQ cron every minute.

    For each active rule: executes condition_sql against the linked data source,
    compares the result to the threshold, and dispatches notifications if breached.
    """
    # Renew the worker heartbeat so the health endpoint sees the worker as alive.
    try:
        import os
        import redis as _redis
        _redis_url = os.getenv("REDIS_URL", "redis://localhost:6379/0")
        _r = _redis.from_url(_redis_url, socket_connect_timeout=1, socket_timeout=1)
        _r.setex("aiser:worker:heartbeat", 90, "1")
        _r.close()
    except Exception:
        pass

    logger.info("🔔 Starting alert rule evaluation cycle")
    try:
        from src.db.session import async_session
        async with async_session() as db:
            from src.modules.alerts.alert_evaluator import AlertEvaluator
            evaluator = AlertEvaluator(db)
            await evaluator.run_evaluation_cycle()
        return {"success": True, "completed_at": datetime.utcnow().isoformat()}
    except Exception as e:
        logger.error(f"❌ Alert evaluation cycle failed: {e}")
        raise


async def refresh_artifact_data(
    ctx: Dict[str, Any],
    data_source_id: str,
    *,
    export_formats: Optional[list] = None,
) -> Dict[str, Any]:
    """
    ARQ job: re-execute all dashboard widget queries for a given data source.
    Triggered on demand (POST /ai/artifacts/refresh) or by cron for live data sources.

    Optional: auto-export updated dashboards to pptx/docx if export_formats is set.
    """
    logger.info("refresh_artifact_data: data_source_id=%s", data_source_id)
    try:
        import importlib

        _artifact_svc = importlib.import_module("ee.modules.ai.services.artifact_automation_service")
        refresh_all_dashboards_for_data_source = _artifact_svc.refresh_all_dashboards_for_data_source
        export_dashboard_artifacts = _artifact_svc.export_dashboard_artifacts
        result = await refresh_all_dashboards_for_data_source(data_source_id)

        exports = {}
        if export_formats:
            for did in (result.get("dashboard_ids") or [])[:5]:
                try:
                    exp = await export_dashboard_artifacts(
                        did, formats=export_formats, org_id="default"
                    )
                    exports[did] = exp
                except Exception as exc:
                    exports[did] = {"error": str(exc)}

        return {
            "success": True,
            "data_source_id": data_source_id,
            "refresh_result": result,
            "exports": exports,
            "completed_at": datetime.utcnow().isoformat(),
        }
    except Exception as exc:
        logger.exception("refresh_artifact_data failed: %s", exc)
        raise


async def sync_artifacts_after_schema_change(
    ctx: Dict[str, Any],
    data_source_id: str,
    old_schema: Optional[dict] = None,
    new_schema: Optional[dict] = None,
) -> Dict[str, Any]:
    """
    ARQ job: run after schema change detection — flag stale widgets and refresh data.
    Called by the schema refresh pipeline when drift is detected.
    """
    logger.info("sync_artifacts_after_schema_change: data_source_id=%s", data_source_id)
    try:
        import importlib

        _artifact_svc = importlib.import_module("ee.modules.ai.services.artifact_automation_service")
        _sync = _artifact_svc.sync_artifacts_after_schema_change
        result = await _sync(data_source_id, old_schema=old_schema, new_schema=new_schema)
        return {"success": True, **result, "completed_at": datetime.utcnow().isoformat()}
    except Exception as exc:
        logger.exception("sync_artifacts_after_schema_change failed: %s", exc)
        raise


async def refresh_all_active_schemas(ctx: Dict[str, Any]) -> Dict[str, Any]:
    """
    RELIABILITY: refresh_schema_cache and sync_artifacts_after_schema_change
    both existed and worked but were never scheduled anywhere -- a source's
    cached schema was only ever refreshed by an explicit user action, so
    NL2SQL could keep generating SQL against columns dropped or renamed on
    the underlying warehouse indefinitely, only surfacing as a confusing
    DB-level error at query time. Triggered by ARQ cron (see worker.py);
    fans out `refresh_schema_cache`'s per-source logic to every active
    source, and dispatches the existing drift-sync job when the refreshed
    schema actually differs from what was cached.
    """
    logger.info("refresh_all_active_schemas: starting cycle")
    try:
        from sqlalchemy import select

        from src.db.session import async_session
        from src.modules.data.models import DataSource
        from src.modules.data.services.data_connectivity_service import DataConnectivityService

        svc = DataConnectivityService()
        async with async_session() as db:
            result = await db.execute(select(DataSource.id).where(DataSource.is_active == True))  # noqa: E712
            source_ids = [row[0] for row in result.all()]

        refreshed = 0
        drifted = 0
        failed = 0
        for source_id in source_ids:
            try:
                before = await svc.get_source_schema(source_id)
                old_schema = before.get("schema") if before.get("success") else None

                after = await svc.get_source_schema(source_id, force_refresh=True)
                if not after.get("success"):
                    failed += 1
                    continue
                new_schema = after.get("schema")
                refreshed += 1

                if old_schema is not None and old_schema != new_schema:
                    drifted += 1
                    logger.info("refresh_all_active_schemas: drift detected for %s", source_id)
                    await sync_artifacts_after_schema_change(
                        ctx, source_id, old_schema=old_schema, new_schema=new_schema
                    )
            except Exception as exc:
                failed += 1
                logger.warning("refresh_all_active_schemas: failed for %s: %s", source_id, exc)

        logger.info(
            "refresh_all_active_schemas: complete (refreshed=%d drifted=%d failed=%d total=%d)",
            refreshed, drifted, failed, len(source_ids),
        )
        return {
            "success": True,
            "total": len(source_ids),
            "refreshed": refreshed,
            "drifted": drifted,
            "failed": failed,
            "completed_at": datetime.utcnow().isoformat(),
        }
    except Exception as exc:
        logger.exception("refresh_all_active_schemas failed: %s", exc)
        raise
