"""
Aicser Background Job Runner using ARQ (Redis-backed, async-native, MIT license).

Replaces the asyncio.create_task(schedule_retention_cleanup()) sleep loops.

Usage:
    # Run the worker:
    arq app.jobs.worker.WorkerSettings

    # Enqueue a job from anywhere:
    from src.shared.jobs.client import enqueue
    await enqueue('send_scheduled_report', report_id='abc123')

Available jobs:
    - run_data_quality_check: Profile a data source for nulls/freshness
    - run_scheduled_report: Generate and deliver a scheduled report
    - run_data_retention_cleanup: Clean up expired data (replaces sleep loop)
    - run_bi_sync: Push Aiser dashboard changes to PowerBI/Tableau
    - refresh_schema_cache: Refresh cached schema for a data source
"""
