"""SCIM provisioning: org SCIM tokens, identity groups + members, SCIM-managed user links."""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_24_scim_identity"
down_revision = "2026_09_24_ai_decisions_tool"
branch_labels = None
depends_on = None

_UUID = postgresql.UUID(as_uuid=True)
_NOW = sa.text("CURRENT_TIMESTAMP")


def upgrade() -> None:
    op.create_table(
        "scim_tokens",
        sa.Column("id", _UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", _UUID, nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("display_hint", sa.String(32), nullable=False),
        sa.Column("secret_hash", sa.String(64), nullable=False),
        sa.Column("created_by", _UUID, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scim_tokens_org", "scim_tokens", ["organization_id"])
    op.create_table(
        "identity_groups",
        sa.Column("id", _UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", _UUID, nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("role_name", sa.String(64), nullable=True),
        sa.Column("source", sa.String(16), server_default=sa.text("'scim'"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "display_name", name="uq_identity_groups_org_name"),
    )
    op.create_table(
        "identity_group_members",
        sa.Column("group_id", _UUID, sa.ForeignKey("identity_groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.PrimaryKeyConstraint("group_id", "user_id"),
    )
    op.create_index("ix_identity_group_members_user", "identity_group_members", ["user_id"])
    op.create_table(
        "scim_user_links",
        sa.Column("id", _UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("organization_id", _UUID, nullable=False),
        sa.Column("user_id", _UUID, nullable=False),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_scim_user_links_org_user"),
    )


def downgrade() -> None:
    op.drop_table("scim_user_links")
    op.drop_index("ix_identity_group_members_user", table_name="identity_group_members")
    op.drop_table("identity_group_members")
    op.drop_table("identity_groups")
    op.drop_index("ix_scim_tokens_org", table_name="scim_tokens")
    op.drop_table("scim_tokens")
