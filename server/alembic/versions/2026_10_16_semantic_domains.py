"""Business domains for semantic models, with one Core model per organization."""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "2026_10_16_semantic_domains"
down_revision: Union[str, None] = "2026_10_16_prep_recipes"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "semantic_domains",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("organization_id", uuid, nullable=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_core", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("owner_id", uuid, nullable=True),
        sa.Column("steward_ids", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("created_by", uuid, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "name", name="uq_semantic_domain_org_name"),
    )
    op.create_index("ix_semantic_domains_organization_id", "semantic_domains", ["organization_id"])
    op.create_table(
        "semantic_domain_sources",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("domain_id", uuid, sa.ForeignKey("semantic_domains.id", ondelete="CASCADE"), nullable=False),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by", uuid, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("domain_id", "data_source_id", name="uq_semantic_domain_source"),
    )
    op.create_index("ix_semantic_domain_sources_source", "semantic_domain_sources", ["data_source_id"])


def downgrade() -> None:
    op.drop_index("ix_semantic_domain_sources_source", table_name="semantic_domain_sources")
    op.drop_table("semantic_domain_sources")
    op.drop_index("ix_semantic_domains_organization_id", table_name="semantic_domains")
    op.drop_table("semantic_domains")
