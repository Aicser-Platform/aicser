"""add oauth_connector_connections (CRM/ERP/ITSM delegated OAuth2)

Revision ID: 2026_09_04_oauth_connector
Revises: 2026_08_23_backfill_query_grant
Create Date: 2026-09-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "2026_09_04_oauth_connector"
down_revision: Union[str, None] = "2026_08_23_backfill_query_grant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "oauth_connector_connections",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("vendor", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("connected_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("client_id", sa.Text(), nullable=False),
        sa.Column("client_secret", sa.Text(), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("access_token", sa.Text(), nullable=True),
        sa.Column("refresh_token", sa.Text(), nullable=True),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("instance_url", sa.Text(), nullable=True),
        sa.Column("scopes", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("is_sandbox", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("status", sa.Enum("pending", "active", "error", "revoked", name="oauth_connector_status_enum"), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("extra_metadata", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "vendor", "name", name="uq_oauth_connector_org_vendor_name"),
    )
    op.create_index("ix_oauth_connector_connections_organization_id", "oauth_connector_connections", ["organization_id"])
    op.create_index("ix_oauth_connector_connections_project_id", "oauth_connector_connections", ["project_id"])
    op.create_index("ix_oauth_connector_connections_vendor", "oauth_connector_connections", ["vendor"])
    op.create_index("ix_oauth_connector_connections_status", "oauth_connector_connections", ["status"])
    op.create_index("ix_oauth_connector_connections_org_vendor", "oauth_connector_connections", ["organization_id", "vendor"])


def downgrade() -> None:
    op.drop_index("ix_oauth_connector_connections_org_vendor", table_name="oauth_connector_connections")
    op.drop_index("ix_oauth_connector_connections_status", table_name="oauth_connector_connections")
    op.drop_index("ix_oauth_connector_connections_vendor", table_name="oauth_connector_connections")
    op.drop_index("ix_oauth_connector_connections_project_id", table_name="oauth_connector_connections")
    op.drop_index("ix_oauth_connector_connections_organization_id", table_name="oauth_connector_connections")
    op.drop_table("oauth_connector_connections")
    op.execute(sa.text("DROP TYPE IF EXISTS oauth_connector_status_enum"))
