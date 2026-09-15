"""Add semantic_column_classifications table for LLM-based column classification cache.

Today's column classification (data_profiler.py's _classify_columns) is a
heuristic: real PK/FK schema metadata (when available) plus name-pattern and
structural signals (_ID_PATTERNS, _looks_like_code_column). It works, but the
proper fix -- flagged twice by the user -- is a cached, LLM-based per-column
semantic classification: ask an LLM to look at each column (name, type,
sample values) and classify it as metric/dimension/identifier/timestamp with
a confidence score and reasoning, batched into one call per data source, and
cache the result so it isn't re-computed (and re-billed) on every query.

This table is that cache. It is scoped per data source and keyed by
schema_fingerprint -- a hash of the data source's column names+types (see
column_semantic_classifier.compute_schema_fingerprint) -- so a schema change
(added/removed/retyped column) simply stops matching any cached row for that
data source, which the read path (semantic_layer_db.get_column_classifications)
treats as a cache miss: the heuristic in data_profiler.py keeps serving
requests instantly while a background job (see src/shared/jobs/tasks.py's
classify_data_source_columns) recomputes and repopulates the cache. Rows for
columns dropped from the schema are simply never returned again (fingerprint
mismatch) rather than being eagerly deleted -- cheap, and the next successful
classification run naturally overwrites/refreshes the live column set.

Unique on (data_source_id, table_name, column_name) so a re-classification
run upserts in place (ON CONFLICT) instead of accumulating duplicate rows.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "semcolclass1"
down_revision: Union[str, None] = "aiqualmetric1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "semantic_column_classifications",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("data_source_id", sa.String(), sa.ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False),
        # md5 hex of the data source's full column name+type signature at the
        # time this row was written -- see compute_schema_fingerprint(). The
        # read path filters on (data_source_id, schema_fingerprint) against
        # the CURRENT live fingerprint, so a stale row (old fingerprint) is
        # simply invisible to reads rather than needing an explicit
        # invalidation pass.
        sa.Column("schema_fingerprint", sa.String(length=32), nullable=False),
        sa.Column("table_name", sa.String(), nullable=False),
        sa.Column("column_name", sa.String(), nullable=False),
        # Observed type string at classification time -- informational/debugging only.
        sa.Column("column_type", sa.String(), nullable=True),
        # 'metric' | 'dimension' | 'identifier' | 'timestamp'
        sa.Column("classification", sa.String(length=20), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("reasoning", sa.Text(), nullable=True),
        # Provenance -- always 'llm' today, but kept open (not a hardcoded
        # constant) in case a future source ever populates this same cache.
        sa.Column("source", sa.String(length=20), server_default="llm", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.current_timestamp()),
        sa.UniqueConstraint("data_source_id", "table_name", "column_name", name="uq_semantic_col_class_col"),
    )
    op.create_index(
        "ix_semantic_col_class_ds_fingerprint",
        "semantic_column_classifications",
        ["data_source_id", "schema_fingerprint"],
    )


def downgrade() -> None:
    op.drop_index("ix_semantic_col_class_ds_fingerprint", table_name="semantic_column_classifications")
    op.drop_table("semantic_column_classifications")
