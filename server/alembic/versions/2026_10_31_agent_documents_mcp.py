"""Agent documents with versions, and outside MCP servers

Revision ID: 2026_10_31_agent_docs_mcp
Revises: 2026_10_30_plant
Create Date: 2026-10-31
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql as pg

revision: str = "2026_10_31_agent_docs_mcp"
down_revision: Union[str, None] = "2026_10_30_plant"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    u = pg.UUID(as_uuid=True)
    pk = lambda: sa.Column("id", u, primary_key=True, server_default=sa.text("gen_random_uuid()"))  # noqa: E731
    created = lambda: sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())  # noqa: E731
    op.create_table(
        "agent_documents", pk(),
        sa.Column("organization_id", u, nullable=False, index=True),
        sa.Column("project_id", u, nullable=True, index=True),
        sa.Column("created_by", sa.String(), nullable=False, index=True),
        sa.Column("run_id", u, nullable=True),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        created(),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "agent_document_versions", pk(),
        sa.Column("document_id", u, sa.ForeignKey("agent_documents.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("author", sa.String(20), nullable=False, server_default="agent"),
        sa.Column("note", sa.String(300), nullable=True),
        created(),
        sa.UniqueConstraint("document_id", "version", name="uq_agent_document_version"),
    )
    op.create_table(
        "agent_mcp_servers", pk(),
        sa.Column("organization_id", u, nullable=False, index=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("slug", sa.String(40), nullable=False),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("auth_header", sa.Text(), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("tools", pg.JSONB(), nullable=False, server_default="[]"),
        sa.Column("allowed_tools", pg.JSONB(), nullable=False, server_default="[]"),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
        created(),
        sa.UniqueConstraint("organization_id", "slug", name="uq_agent_mcp_server_slug"),
    )


def downgrade() -> None:
    for table in ("agent_mcp_servers", "agent_document_versions", "agent_documents"):
        op.drop_table(table)
