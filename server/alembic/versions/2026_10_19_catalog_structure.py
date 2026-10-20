"""Catalog structure: business domains, tags, glossary terms, friendly names and stewards

``catalog_annotations``: how an asset is filed (one row per asset the catalog lists).
``glossary_terms``: business terms defined once and linked to assets and columns.

Revision ID: 2026_10_19_catalog_structure
Revises: 2026_10_18_decision_source
Create Date: 2026-10-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "2026_10_19_catalog_structure"
down_revision: Union[str, None] = "2026_10_18_decision_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(name: str) -> bool:
    return name in sa.inspect(op.get_bind()).get_table_names()


def upgrade() -> None:
    if not _has_table("catalog_annotations"):
        op.create_table(
            "catalog_annotations",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
            sa.Column("asset_kind", sa.String(32), nullable=False),
            sa.Column("asset_ref", sa.String(512), nullable=False),
            sa.Column("domain", sa.String(120), nullable=True),
            sa.Column("tags", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("terms", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("display_name", sa.String(255), nullable=True),
            sa.Column("steward_user_id", UUID(as_uuid=True), nullable=True),
            sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("organization_id", "asset_kind", "asset_ref", name="uq_catalog_annotation_asset"),
        )
        op.create_index("ix_catalog_annotations_organization_id", "catalog_annotations", ["organization_id"])
        op.create_index("ix_catalog_annotations_domain", "catalog_annotations", ["domain"])
    if not _has_table("glossary_terms"):
        op.create_table(
            "glossary_terms",
            sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
            sa.Column("organization_id", UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(160), nullable=False),
            sa.Column("definition", sa.Text(), nullable=True),
            sa.Column("synonyms", JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
            sa.Column("domain", sa.String(120), nullable=True),
            sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
            sa.Column("owner_user_id", UUID(as_uuid=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
            sa.UniqueConstraint("organization_id", "name", name="uq_glossary_term_name"),
        )
        op.create_index("ix_glossary_terms_organization_id", "glossary_terms", ["organization_id"])


def downgrade() -> None:
    if _has_table("glossary_terms"):
        op.drop_table("glossary_terms")
    if _has_table("catalog_annotations"):
        op.drop_table("catalog_annotations")
