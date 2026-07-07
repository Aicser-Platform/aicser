"""EE platform tables: query editor, widgets, audit, streaming, chat assets, billing columns."""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text
from sqlalchemy.dialects import postgresql


def _is_ee_enabled() -> bool:
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    return edition in {"enterprise", "ee"} or bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip())


revision: str = "a8b9c0d1e2f3"
down_revision: Union[str, None] = "f7a8b9c0d1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if not _is_ee_enabled():
        return

    # ── organizations billing denormalization (rate_limiter, data retention) ──
    op.add_column("organizations", sa.Column("slug", sa.String(length=255), nullable=True))
    op.add_column(
        "organizations",
        sa.Column("plan_type", sa.String(length=50), server_default="free", nullable=False),
    )
    op.add_column(
        "organizations",
        sa.Column("ai_credits_used", sa.Integer(), server_default="0", nullable=False),
    )
    op.add_column(
        "organizations",
        sa.Column("ai_credits_limit", sa.Integer(), server_default="100", nullable=True),
    )
    op.add_column("organizations", sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizations", sa.Column("max_projects", sa.Integer(), nullable=True))

    # ── query editor ──────────────────────────────────────────────────────────
    # Use IF NOT EXISTS — the CE migration (2026_07_07_ce_query_tables) may have
    # already created these tables when both branches run together (upgrade heads).
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
            user_id         TEXT         NOT NULL,
            organization_id TEXT,
            project_id      TEXT,
            name            VARCHAR(255) NOT NULL,
            sql             TEXT         NOT NULL,
            metadata        JSONB,
            created_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMPTZ  DEFAULT CURRENT_TIMESTAMP
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

    # ── dashboard widgets (v2 layout engine) ──────────────────────────────────
    op.create_table(
        "dashboard_widgets",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("dashboard_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("page_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("widget_type", sa.String(length=50), nullable=False),
        sa.Column("chart_type", sa.String(length=50), nullable=True),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("data_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("style_config", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("x", sa.Integer(), server_default="0", nullable=False),
        sa.Column("y", sa.Integer(), server_default="0", nullable=False),
        sa.Column("width", sa.Integer(), server_default="4", nullable=False),
        sa.Column("height", sa.Integer(), server_default="3", nullable=False),
        sa.Column("z_index", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_visible", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_locked", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("is_resizable", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_draggable", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("last_data_refresh", sa.DateTime(timezone=True), nullable=True),
        sa.Column("data_cache_ttl", sa.Integer(), server_default="300", nullable=True),
        sa.Column("query_execution_time", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["dashboard_id"], ["dashboards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["page_id"], ["dashboard_pages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dashboard_widgets_dashboard_id", "dashboard_widgets", ["dashboard_id"])

    # ── audit logs ────────────────────────────────────────────────────────────
    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("category", sa.String(length=64), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("resource_type", sa.String(length=64), nullable=True),
        sa.Column("resource_id", sa.String(length=255), nullable=True),
        sa.Column("action", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("user_agent", sa.String(length=255), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_audit_logs_org_created", "audit_logs", ["org_id", "created_at"])
    op.create_index("ix_audit_logs_category", "audit_logs", ["category"])

    # ── streaming ingestion ───────────────────────────────────────────────────
    op.create_table(
        "stream_definitions",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("data_source_id", sa.String(), nullable=False),
        sa.Column("kafka_brokers", sa.Text(), nullable=True),
        sa.Column("topic", sa.String(length=255), nullable=True),
        sa.Column("target_table", sa.String(length=255), nullable=True),
        sa.Column("ch_kafka_table", sa.String(length=255), nullable=True),
        sa.Column("ch_mv_name", sa.String(length=255), nullable=True),
        sa.Column("streaming_mode", sa.String(length=32), server_default="realtime", nullable=False),
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["data_source_id"], ["data_sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_stream_definitions_org_id", "stream_definitions", ["org_id"])

    # ── chat node memory + saved assets ───────────────────────────────────────
    op.create_table(
        "chat_node",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("predecessor_node_id", sa.Integer(), nullable=True),
        sa.Column("node_key", sa.String(), nullable=False),
        sa.Column("node_name", sa.String(), nullable=False),
        sa.Column("input", sa.Text(), nullable=False),
        sa.Column("output", sa.Text(), nullable=False),
        sa.Column("execution_metadata", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversation.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["message.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_node_conversation_id", "chat_node", ["conversation_id"])

    op.create_table(
        "saved_asset",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("asset_type", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("content", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("thumbnail", sa.Text(), nullable=True),
        sa.Column("data_source_id", sa.String(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversation.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["message_id"], ["message.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_asset_conversation_id", "saved_asset", ["conversation_id"])

    # ── dbt sync + usage records ──────────────────────────────────────────────
    op.create_table(
        "dbt_sync_state",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("dbt_project_name", sa.String(length=255), nullable=True),
        sa.Column("models_count", sa.Integer(), server_default="0", nullable=True),
        sa.Column("metrics_imported", sa.Integer(), server_default="0", nullable=True),
        sa.Column("dimensions_imported", sa.Integer(), server_default="0", nullable=True),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sync_status", sa.String(length=32), server_default="success", nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_dbt_sync_state_project_id", "dbt_sync_state", ["project_id"])

    op.create_table(
        "usage_records",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=True),
        sa.Column("record_type", sa.String(length=64), nullable=False),
        sa.Column("quantity", sa.Integer(), server_default="0", nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_usage_records_org_id", "usage_records", ["organization_id"])

    # ── onboarding analytics ──────────────────────────────────────────────────
    op.create_table(
        "onboarding_analytics",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("event", sa.String(length=128), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_onboarding_analytics_user_id", "onboarding_analytics", ["user_id"])

    op.create_table(
        "onboarding_friction_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("step", sa.String(length=128), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_onboarding_friction_logs_user_id", "onboarding_friction_logs", ["user_id"])


def downgrade() -> None:
    if not _is_ee_enabled():
        return

    op.drop_index("ix_onboarding_friction_logs_user_id", table_name="onboarding_friction_logs")
    op.drop_table("onboarding_friction_logs")
    op.drop_index("ix_onboarding_analytics_user_id", table_name="onboarding_analytics")
    op.drop_table("onboarding_analytics")
    op.drop_index("ix_usage_records_org_id", table_name="usage_records")
    op.drop_table("usage_records")
    op.drop_index("ix_dbt_sync_state_project_id", table_name="dbt_sync_state")
    op.drop_table("dbt_sync_state")
    op.drop_index("ix_saved_asset_conversation_id", table_name="saved_asset")
    op.drop_table("saved_asset")
    op.drop_index("ix_chat_node_conversation_id", table_name="chat_node")
    op.drop_table("chat_node")
    op.drop_index("ix_stream_definitions_org_id", table_name="stream_definitions")
    op.drop_table("stream_definitions")
    op.drop_index("ix_audit_logs_category", table_name="audit_logs")
    op.drop_index("ix_audit_logs_org_created", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_dashboard_widgets_dashboard_id", table_name="dashboard_widgets")
    op.drop_table("dashboard_widgets")
    op.drop_index("idx_query_snapshots_scope", table_name="query_snapshots")
    op.drop_table("query_snapshots")
    op.drop_index("idx_query_schedules_scope", table_name="query_schedules")
    op.drop_table("query_schedules")
    op.drop_index("idx_query_execution_history_scope", table_name="query_execution_history")
    op.drop_table("query_execution_history")
    op.drop_index("idx_saved_query_versions_query_id", table_name="saved_query_versions")
    op.drop_table("saved_query_versions")
    op.drop_index("idx_saved_queries_scope", table_name="saved_queries")
    op.drop_table("saved_queries")
    op.drop_index("idx_query_tabs_scope", table_name="query_tabs")
    op.drop_table("query_tabs")
    op.drop_column("organizations", "max_projects")
    op.drop_column("organizations", "trial_ends_at")
    op.drop_column("organizations", "ai_credits_limit")
    op.drop_column("organizations", "ai_credits_used")
    op.drop_column("organizations", "plan_type")
    op.drop_column("organizations", "slug")
