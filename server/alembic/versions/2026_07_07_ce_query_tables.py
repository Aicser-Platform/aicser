"""Add query editor tables to the CE branch.

These tables back the Query History, Saved Queries, Query Snapshots,
Scheduled Queries, and tab-state persistence features in the query editor.
They were previously only created by the EE migration
(2026_05_24_ee_platform_tables), so CE databases had no schema for them
and every query-history read/write silently failed.

All DDL uses IF NOT EXISTS so this migration is safe to apply on top of an
existing EE database that already has these tables.
"""
from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "2026_07_07_ce_query_tables"
down_revision = "2026_07_06_dash_created_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(text("""
        CREATE TABLE IF NOT EXISTS query_tabs (
            id              SERIAL PRIMARY KEY,
            user_id         TEXT        NOT NULL,
            organization_id TEXT,
            project_id      TEXT,
            tabs            JSONB       NOT NULL,
            active_key      VARCHAR(255),
            updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_query_tabs_scope "
        "ON query_tabs (user_id, organization_id, project_id)"
    ))

    op.execute(text("""
        CREATE TABLE IF NOT EXISTS saved_queries (
            id              SERIAL PRIMARY KEY,
            user_id         TEXT        NOT NULL,
            organization_id TEXT,
            project_id      TEXT,
            name            VARCHAR(255) NOT NULL,
            sql             TEXT        NOT NULL,
            metadata        JSONB,
            created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_saved_queries_scope "
        "ON saved_queries (user_id, organization_id, project_id)"
    ))

    op.execute(text("""
        CREATE TABLE IF NOT EXISTS saved_query_versions (
            id             SERIAL PRIMARY KEY,
            saved_query_id INTEGER NOT NULL REFERENCES saved_queries(id) ON DELETE CASCADE,
            sql            TEXT    NOT NULL,
            created_at     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_saved_query_versions_query_id "
        "ON saved_query_versions (saved_query_id)"
    ))

    op.execute(text("""
        CREATE TABLE IF NOT EXISTS query_execution_history (
            id              SERIAL PRIMARY KEY,
            user_id         TEXT         NOT NULL,
            organization_id TEXT,
            project_id      TEXT,
            data_source_id  VARCHAR,
            sql             TEXT         NOT NULL,
            status          VARCHAR(32)  NOT NULL DEFAULT 'success',
            row_count       INTEGER               DEFAULT 0,
            engine          VARCHAR(64),
            duration_ms     INTEGER,
            error_message   TEXT,
            started_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_query_execution_history_scope "
        "ON query_execution_history (user_id, organization_id)"
    ))

    op.execute(text("""
        CREATE TABLE IF NOT EXISTS query_schedules (
            id              SERIAL PRIMARY KEY,
            user_id         TEXT         NOT NULL,
            organization_id TEXT,
            project_id      TEXT,
            name            VARCHAR(255) NOT NULL,
            sql             TEXT         NOT NULL,
            cron            VARCHAR(255),
            enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
            last_run_at     TIMESTAMPTZ,
            created_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_query_schedules_scope "
        "ON query_schedules (user_id, organization_id, project_id)"
    ))

    op.execute(text("""
        CREATE TABLE IF NOT EXISTS query_snapshots (
            id              SERIAL PRIMARY KEY,
            user_id         TEXT        NOT NULL,
            organization_id TEXT,
            project_id      TEXT,
            name            VARCHAR(255),
            data_source_id  VARCHAR,
            sql             TEXT,
            columns         JSONB,
            rows            JSONB,
            row_count       INTEGER DEFAULT 0,
            metadata        JSONB,
            created_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
    """))
    op.execute(text(
        "CREATE INDEX IF NOT EXISTS idx_query_snapshots_scope "
        "ON query_snapshots (user_id, organization_id, project_id)"
    ))


def downgrade() -> None:
    op.execute(text("DROP TABLE IF EXISTS query_snapshots"))
    op.execute(text("DROP TABLE IF EXISTS query_schedules"))
    op.execute(text("DROP TABLE IF EXISTS query_execution_history"))
    op.execute(text("DROP TABLE IF EXISTS saved_query_versions"))
    op.execute(text("DROP TABLE IF EXISTS saved_queries"))
    op.execute(text("DROP TABLE IF EXISTS query_tabs"))
