"""Add report_templates - named, saved Custom executive-report templates.

Report templates are lightweight compared to dashboard_templates (a handful
of CSS-var-shaped overrides - font pairing, density, accent color - not a
full widget layout), so this gets its own small table rather than being
folded into a shared "templates" table with dashboards. Named saves are
org-scoped (a team's custom look is a shared asset, the same visibility
model as dashboards/reports themselves), not per-user.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "2026_08_25_report_templates"
down_revision = "2026_08_23_backfill_query_grant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_templates",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("vars", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("current_timestamp"),
            nullable=True,
        ),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false"), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_report_templates_organization_id", "report_templates", ["organization_id"], unique=False)
    # Case-insensitive uniqueness per org, only while the row is live - lets a
    # deleted template's name be reused without a partial-unique-index conflict.
    op.execute(
        "CREATE UNIQUE INDEX ix_report_templates_org_name_live "
        "ON report_templates (organization_id, lower(name)) "
        "WHERE is_deleted IS NOT TRUE"
    )


def downgrade() -> None:
    op.drop_index("ix_report_templates_org_name_live", table_name="report_templates")
    op.drop_index("ix_report_templates_organization_id", table_name="report_templates")
    op.drop_table("report_templates")
