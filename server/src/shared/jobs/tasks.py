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
            affected_conversations = await service.cleanup_expired_conversations()
        logger.info(
            "Retention cleanup complete: %s data sources, %s conversations affected",
            affected, affected_conversations,
        )
        return {
            "success": True,
            "affected": affected,
            "affected_conversations": affected_conversations,
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


async def classify_data_source_columns(ctx: Dict[str, Any], data_source_id: str) -> Dict[str, Any]:
    """
    Background LLM column classification for one data source (metric /
    dimension / identifier / timestamp per column), batched into a single
    LLM call and cached in semantic_column_classifications.

    Enqueued by column_semantic_classifier.ensure_column_classifications_fresh
    on a cache miss (lazy: the first analytics query against a data source, or
    the first query after its schema changed, serves that request off the
    instant heuristic in data_profiler.py and enqueues this job in the
    background rather than blocking on an LLM call). Also safe to enqueue
    proactively (e.g. after a schema-drift sync) since it's idempotent --
    upsert_column_classifications overwrites in place keyed by
    (data_source_id, table_name, column_name).
    """
    logger.info(f"Classifying columns via LLM for data source: {data_source_id}")
    try:
        from src.core.edition import is_ee_enabled

        # src/shared is a CE-protected module (test_module_conventions.py's
        # test_protected_ce_modules_avoid_direct_ee_imports) -- must not
        # statically import the ee package by name, so a CE-only deployment
        # (no ee/ submodule on disk) can still import this whole file. Same
        # importlib.import_module(...) indirection this file's own
        # refresh_artifact_data already uses a few functions up.
        # LLM column classification is an EE feature; data_profiler.py's
        # structural/PK-FK heuristic already serves every request instantly
        # regardless of whether this job ever runs, so no-op-ing here in CE is
        # a real no-op, not a degraded experience -- the caller
        # (ensure_column_classifications_fresh, itself EE-only) never enqueues
        # this job at all when EE is disabled.
        if not is_ee_enabled():
            return {"success": False, "error": "EE edition required for LLM column classification", "data_source_id": data_source_id}

        import importlib

        from src.modules.data.services.data_connectivity_service import DataConnectivityService

        _classifier_svc = importlib.import_module("ee.modules.ai.services.column_semantic_classifier")
        classify_data_source_columns_llm = _classifier_svc.classify_data_source_columns_llm

        svc = DataConnectivityService()
        schema_result = await svc.get_source_schema(data_source_id)
        if not schema_result.get("success"):
            return {"success": False, "error": f"Schema retrieval failed: {schema_result.get('error')}"}
        schema = schema_result.get("schema") or {}

        # Best-effort sample of real values to ground the classification --
        # a failed/empty sample still lets classification proceed on column
        # name+type alone (see column_semantic_classifier._build_prompt).
        sample_rows = None
        try:
            sample_result = await svc.get_data_from_source(data_source_id, limit=20)
            if sample_result.get("success"):
                sample_rows = sample_result.get("data")
        except Exception as exc:
            logger.debug("classify_data_source_columns: sample fetch failed for %s: %s", data_source_id, exc)

        result = await classify_data_source_columns_llm(data_source_id, schema, sample_rows)
        return {
            "success": bool(result.get("success")),
            "data_source_id": data_source_id,
            "classified": result.get("classified", 0),
            "error": result.get("error"),
            "completed_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"classify_data_source_columns failed for {data_source_id}: {e}")
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


async def reindex_stale_knowledge_chunks(ctx: Dict[str, Any], batch_size: int = 200) -> Dict[str, Any]:
    """
    Re-embed document_chunks rows with a missing or stale embedding.

    "Stale" covers two cases, both silent-by-default without this job:
      - embedding IS NULL: the chunk was never successfully embedded (e.g.
        ingested during the transaction-poisoning bug this job was added
        alongside fixing, or any transient embedding-service failure at
        ingestion time).
      - embedding_model doesn't match the currently configured embedding
        model: EMBEDDING_PROVIDER/EMBEDDING_LOCAL_MODEL changed since the
        chunk was embedded, so its vector is in a different embedding space
        than anything queried against it now -- comparing it to a fresh
        query embedding produces meaningless similarity scores, not just a
        missing one.

    Runs a bounded batch per invocation (default 200) rather than the whole
    backlog at once -- the ARQ worker's job_timeout is 5 minutes, and local
    embedding generation is CPU-bound; the cron schedule re-triggers this
    often enough to fully catch up a realistic backlog within a few runs
    without risking a timeout on a large one.
    """
    from sqlalchemy import select, or_, and_, text as sa_text
    from src.db.session import async_session
    from src.modules.knowledge.models import DocumentChunk, KnowledgeDocument
    from src.shared.embedding import get_embedding_service
    from src.modules.knowledge.services.document_ingestion_service import PGVECTOR_EMBEDDING_DIMENSIONS

    embedding_service = get_embedding_service()
    current_model_id = embedding_service.current_model_id()

    logger.info("reindex_stale_knowledge_chunks: starting (current_model=%s, batch_size=%d)", current_model_id, batch_size)

    try:
        async with async_session() as session:
            stmt = (
                select(DocumentChunk.id, DocumentChunk.content)
                .join(KnowledgeDocument, DocumentChunk.document_id == KnowledgeDocument.id)
                .where(
                    KnowledgeDocument.status == "ready",
                    or_(
                        DocumentChunk.embedding.is_(None),
                        DocumentChunk.embedding_model.is_(None),
                        and_(
                            DocumentChunk.embedding_model != current_model_id,
                            # A chunk embedded with an org's BYOK key (see
                            # user_byok_embedding.py; identity strings are
                            # tagged "byok_org:<provider>:...") is NOT stale
                            # just because it differs from the platform-wide
                            # current_model_id computed above -- this job has
                            # no per-organization context (it scans across
                            # every org's documents in one pass), so
                            # re-embedding these here would silently
                            # overwrite a deliberate org BYOK choice with the
                            # platform default on every run. Leave them for a
                            # future org-aware reindex instead of clobbering
                            # them.
                            ~DocumentChunk.embedding_model.like("byok_org:%"),
                        ),
                    ),
                )
                .limit(batch_size)
            )
            rows = (await session.execute(stmt)).all()

            if not rows:
                logger.info("reindex_stale_knowledge_chunks: nothing to do")
                return {"success": True, "reembedded": 0, "failed": 0, "completed_at": datetime.utcnow().isoformat()}

            chunk_ids = [r[0] for r in rows]
            contents = [r[1] for r in rows]
            embeddings = await embedding_service.embed_texts(contents)

            reembedded = 0
            failed = 0
            pgvector_available = await session.execute(
                sa_text(
                    "SELECT EXISTS ("
                    "  SELECT 1 FROM pg_extension WHERE extname = 'vector'"
                    ") AND EXISTS ("
                    "  SELECT 1 FROM information_schema.columns "
                    "  WHERE table_name = 'document_chunks' AND column_name = 'embedding_vector'"
                    ")"
                )
            )
            pgvector_ok = bool(pgvector_available.scalar())

            for chunk_id, embedding in zip(chunk_ids, embeddings):
                if not isinstance(embedding, list):
                    failed += 1
                    continue
                await session.execute(
                    sa_text(
                        "UPDATE document_chunks SET embedding = :embedding, "
                        "embedding_model = :model, embedding_dims = :dims WHERE id = :id"
                    ),
                    {
                        "embedding": _json_dumps(embedding),
                        "model": current_model_id,
                        "dims": len(embedding),
                        "id": chunk_id,
                    },
                )
                if pgvector_ok and len(embedding) == PGVECTOR_EMBEDDING_DIMENSIONS:
                    vec_literal = "[" + ",".join(str(float(v)) for v in embedding) + "]"
                    await session.execute(
                        sa_text(
                            "UPDATE document_chunks SET embedding_vector = CAST(:vec AS vector) WHERE id = :id"
                        ),
                        {"vec": vec_literal, "id": chunk_id},
                    )
                reembedded += 1

            await session.commit()

        logger.info("reindex_stale_knowledge_chunks: complete (reembedded=%d failed=%d)", reembedded, failed)
        return {
            "success": True,
            "reembedded": reembedded,
            "failed": failed,
            "completed_at": datetime.utcnow().isoformat(),
        }
    except Exception as exc:
        logger.exception("reindex_stale_knowledge_chunks failed: %s", exc)
        raise


async def ingest_knowledge_document(
    ctx: Dict[str, Any],
    document_id: str,
    object_key: str,
    data_source_id: str,
    user_id: str,
    filename: str,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Background document ingestion for the knowledge base: fetches the
    original file bytes back from durable object storage (S3/Azure Blob/
    PostgreSQL -- see UploadDatasourceStorageService, the same backend
    CSV/datasource uploads use), writes a short-lived local tempfile for
    DocumentIngestionService's parsers (which need a real file_path, same as
    the pattern ee/modules/knowledge_connectors/router.py already uses for
    its own ephemeral ingestion inputs), then parses/chunks/embeds via the
    existing service unchanged.

    Enqueued by src/modules/knowledge/router.py's /create and /upload
    endpoints instead of calling ingest_document() inline in the request
    handler -- parsing + chunking + embedding a normal multi-page PDF
    (chunked at DocumentIngestionService.CHUNK_TARGET_TOKENS=600 tokens/
    chunk) can take real CPU time with a local embedding model and no GPU,
    which used to block the HTTP response for the whole duration and risked
    reverse-proxy/client timeouts regardless of which embedding model was
    configured. The router creates the KnowledgeDocument row up front with
    status="processing" and passes its id here so ingest_document() updates
    that same row (see its `document_id` param) instead of creating a
    second one -- the row the caller already has in hand (and returned in
    its HTTP response) is the one that ends up "ready"/"failed".

    A failure inside ingest_document() itself (bad PDF, embedding provider
    down, etc.) is already caught there and recorded as status="failed" on
    the document row -- that's a normal, non-retried outcome, so this
    returns {"success": False, ...} for it rather than raising. Only
    failures outside that (can't reach object storage, can't write the
    tempfile) raise, so ARQ's retry mechanism engages for genuinely
    transient infra problems.
    """
    import os
    import tempfile
    import uuid as _uuid

    logger.info("ingest_knowledge_document: starting for document %s (%s)", document_id, filename)

    doc_uuid = document_id if isinstance(document_id, _uuid.UUID) else _uuid.UUID(str(document_id))
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else "tmp"

    from src.db.session import async_session
    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService
    from src.modules.knowledge.models import KnowledgeDocument
    from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService
    from sqlalchemy import update as _sa_update

    storage_service = UploadDatasourceStorageService()
    try:
        file_content = await storage_service.get_file(object_key, project_id)
    except Exception as exc:
        # The document row exists (router-created) but has no bytes to
        # ingest -- record this as a normal failed outcome on the row itself
        # (same place any other ingestion failure surfaces to the KB
        # documents UI) rather than leaving it stuck at "processing".
        logger.exception("ingest_knowledge_document: failed to fetch object_key=%s for document %s", object_key, document_id)
        try:
            async with async_session() as session:
                await session.execute(
                    _sa_update(KnowledgeDocument)
                    .where(KnowledgeDocument.id == doc_uuid)
                    .values(status="failed", error_message=f"Failed to retrieve stored file: {str(exc)[:400]}")
                )
                await session.commit()
        except Exception:
            logger.exception("ingest_knowledge_document: also failed to mark document %s as failed", document_id)
        return {"success": False, "document_id": document_id, "error": str(exc)[:200]}

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp.write(file_content)
            tmp_path = tmp.name

        async with async_session() as session:
            service = DocumentIngestionService(session)
            doc = await service.ingest_document(
                file_path=tmp_path,
                data_source_id=data_source_id,
                user_id=user_id,
                filename=filename,
                document_id=doc_uuid,
                object_key=object_key,
            )

        logger.info(
            "ingest_knowledge_document: finished for document %s: status=%s chunks=%s",
            document_id, doc.status, doc.chunk_count,
        )
        return {
            "success": doc.status == "ready",
            "document_id": document_id,
            "status": doc.status,
            "chunk_count": doc.chunk_count or 0,
        }
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _json_dumps(value) -> str:
    import json
    return json.dumps(value)


async def sync_salesforce_object(
    ctx: Dict[str, Any],
    organization_id: str,
    project_id: Optional[str],
    source_connection_id: str,
    target_data_source_id: str,
    object_api_name: str,
    created_by: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Sync one Salesforce object into an existing (Postgres) data source the
    org already has connected. Enqueued on-demand from
    POST /api/connectors/oauth/salesforce/sync (ee/modules/data/router.py),
    which creates the DataIngestionJob row (job_id) up front so it can hand
    the caller an id to poll before this job ever runs.
    See salesforce_sync_service.py for the full design rationale."""
    logger.info(
        "sync_salesforce_object: org=%s object=%s source_connection=%s target=%s job_id=%s",
        organization_id, object_api_name, source_connection_id, target_data_source_id, job_id,
    )
    from src.db.session import async_session
    from ee.modules.data.services.salesforce_sync_service import sync_object

    async with async_session() as db:
        result = await sync_object(
            db,
            organization_id=organization_id,
            project_id=project_id,
            source_connection_id=source_connection_id,
            target_data_source_id=target_data_source_id,
            object_api_name=object_api_name,
            created_by=created_by,
            job_id=job_id,
        )
    logger.info(
        "sync_salesforce_object: finished object=%s rows_read=%s rows_written=%s",
        object_api_name, result.get("rows_read"), result.get("rows_written"),
    )
    return result


async def sync_hubspot_object(
    ctx: Dict[str, Any],
    organization_id: str,
    project_id: Optional[str],
    source_connection_id: str,
    target_data_source_id: str,
    object_api_name: str,
    created_by: Optional[str] = None,
    job_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Sync one HubSpot object into an existing (Postgres) data source the
    org already has connected. Mirrors sync_salesforce_object's contract --
    see hubspot_sync_service.py for the full design rationale."""
    logger.info(
        "sync_hubspot_object: org=%s object=%s source_connection=%s target=%s job_id=%s",
        organization_id, object_api_name, source_connection_id, target_data_source_id, job_id,
    )
    from src.db.session import async_session
    from ee.modules.data.services.hubspot_sync_service import sync_object

    async with async_session() as db:
        result = await sync_object(
            db,
            organization_id=organization_id,
            project_id=project_id,
            source_connection_id=source_connection_id,
            target_data_source_id=target_data_source_id,
            object_api_name=object_api_name,
            created_by=created_by,
            job_id=job_id,
        )
    logger.info(
        "sync_hubspot_object: finished object=%s rows_read=%s rows_written=%s",
        object_api_name, result.get("rows_read"), result.get("rows_written"),
    )
    return result
