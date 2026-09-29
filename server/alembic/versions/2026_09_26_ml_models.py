"""Models: guided ML models, their versions and prediction logs."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_26_ml_models"
down_revision = "2026_09_26_warehouse_engine"
branch_labels = None
depends_on = None


def _base():
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
    ]


def upgrade() -> None:
    op.create_table(
        "ml_models",
        *_base(),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("task", sa.String(20), nullable=False),
        sa.Column("data_source_id", sa.String(), nullable=False),
        sa.Column("table_name", sa.String(256), nullable=False),
        sa.Column("target", sa.String(128), nullable=False),
        sa.Column("features", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("production_version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("endpoint_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("capture_rate", sa.Float(), nullable=False, server_default="0.1"),
    )
    op.create_index("ix_ml_models_id", "ml_models", ["id"])
    op.create_index("ix_ml_models_organization_id", "ml_models", ["organization_id"])
    op.create_index("ix_ml_models_project_id", "ml_models", ["project_id"])
    op.create_table(
        "ml_model_versions",
        *_base(),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ml_models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="queued"),
        sa.Column("stage", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("training_rows", sa.Integer(), nullable=True),
        sa.Column("metrics", postgresql.JSONB(), nullable=True),
        sa.Column("importance", postgresql.JSONB(), nullable=True),
        sa.Column("profile", postgresql.JSONB(), nullable=True),
        sa.Column("classes", postgresql.JSONB(), nullable=True),
        sa.Column("artifact_path", sa.Text(), nullable=True),
        sa.Column("artifact_sha256", sa.String(64), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_ml_model_versions_id", "ml_model_versions", ["id"])
    op.create_index("ix_ml_model_versions_model_id", "ml_model_versions", ["model_id"])
    op.create_index("ix_ml_model_versions_model_version", "ml_model_versions", ["model_id", "version"], unique=True)
    op.create_table(
        "ml_prediction_logs",
        *_base(),
        sa.Column("model_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("ml_models.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("rows", sa.Integer(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("sample", postgresql.JSONB(), nullable=True),
    )
    op.create_index("ix_ml_prediction_logs_id", "ml_prediction_logs", ["id"])
    op.create_index("ix_ml_prediction_logs_model_id", "ml_prediction_logs", ["model_id"])
    op.create_index("ix_ml_prediction_logs_model_created", "ml_prediction_logs", ["model_id", "created_at"])


def downgrade() -> None:
    op.drop_table("ml_prediction_logs")
    op.drop_table("ml_model_versions")
    op.drop_table("ml_models")
