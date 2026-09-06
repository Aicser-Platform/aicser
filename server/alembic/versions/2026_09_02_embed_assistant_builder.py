"""Expand EmbedAssistant into a full custom-assistant builder + internal sharing.

Adds the fields needed to turn EmbedAssistant from a bare embed config into a
real "create a custom AI assistant" builder (system prompt, model/temperature
selection, multi-source data scope, conversation starters, welcome/fallback
messaging, lightweight branding) and a new visibility axis (private/shared/
public) governing the SESSION-authenticated path (see
ee/modules/embed/session_access.py) — orthogonal to the existing auth_mode
column, which governs the token-based external embed path and is untouched.

Also adds embed_assistant_shares, generalizing DashboardShare
(src/modules/dashboards/models.py) with a capability DashboardShare doesn't
have: granting access to everyone with explicit membership in a whole
project, not just a single user. A dedicated table rather than reusing/
altering DashboardShare, which is hard-FK'd to dashboards.id and only
supports a single-user grant.

EE-gated (embed_assistants itself only exists when EE is enabled — see
2026_05_24_knowledge_libraries_embed_assistants.py) and idempotent-on-add
(matches the convention in 2026_07_24_org_project_icon_color.py /
2026_05_30_organization_branding.py) so re-running against a partially
migrated dev database is safe.
"""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision: str = "embedasstext1"
down_revision: Union[str, None] = "kbdocobjkey01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_ee_enabled() -> bool:
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    return edition in {"enterprise", "ee"} or bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip())


def _embed_assistant_columns() -> set[str]:
    bind = op.get_bind()
    return {col["name"] for col in inspect(bind).get_columns("embed_assistants")}


def upgrade() -> None:
    if not _is_ee_enabled():
        return

    # ── EmbedAssistant: builder fields ──────────────────────────────────
    cols = _embed_assistant_columns()
    if "system_prompt" not in cols:
        op.add_column("embed_assistants", sa.Column("system_prompt", sa.Text(), nullable=True))
    if "welcome_message" not in cols:
        op.add_column("embed_assistants", sa.Column("welcome_message", sa.Text(), nullable=True))
    if "fallback_message" not in cols:
        op.add_column("embed_assistants", sa.Column("fallback_message", sa.Text(), nullable=True))
    if "conversation_starters" not in cols:
        op.add_column(
            "embed_assistants",
            sa.Column(
                "conversation_starters",
                postgresql.JSONB(),
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )
    if "icon_emoji" not in cols:
        op.add_column("embed_assistants", sa.Column("icon_emoji", sa.String(length=32), nullable=True))
    if "color" not in cols:
        op.add_column("embed_assistants", sa.Column("color", sa.String(length=16), nullable=True))
    if "preferred_model" not in cols:
        op.add_column("embed_assistants", sa.Column("preferred_model", sa.String(), nullable=True))
    if "temperature" not in cols:
        op.add_column("embed_assistants", sa.Column("temperature", sa.Float(), nullable=True))
    if "data_source_ids" not in cols:
        op.add_column(
            "embed_assistants",
            sa.Column(
                "data_source_ids",
                postgresql.JSONB(),
                nullable=True,
                server_default=sa.text("'[]'::jsonb"),
            ),
        )
    if "visibility" not in cols:
        op.add_column(
            "embed_assistants",
            sa.Column(
                "visibility",
                sa.String(length=16),
                nullable=False,
                server_default=sa.text("'private'"),
            ),
        )

    # ── New table: embed_assistant_shares ───────────────────────────────
    bind = op.get_bind()
    if not inspect(bind).has_table("embed_assistant_shares"):
        op.create_table(
            "embed_assistant_shares",
            sa.Column(
                "id",
                postgresql.UUID(as_uuid=True),
                primary_key=True,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.current_timestamp()),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.func.current_timestamp(),
                onupdate=sa.func.current_timestamp(),
            ),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
            sa.Column("is_deleted", sa.Boolean(), server_default=sa.text("false")),
            sa.Column("assistant_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("shared_by", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("shared_with", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("project_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=True),
            sa.Column("permission", sa.String(length=20), nullable=False, server_default=sa.text("'use'")),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(["assistant_id"], ["embed_assistants.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        )
        op.create_index(
            "ix_embed_assistant_shares_assistant_id",
            "embed_assistant_shares",
            ["assistant_id"],
        )
        op.create_index(
            "ix_embed_assistant_shares_organization_id",
            "embed_assistant_shares",
            ["organization_id"],
        )


def downgrade() -> None:
    if not _is_ee_enabled():
        return

    bind = op.get_bind()
    if inspect(bind).has_table("embed_assistant_shares"):
        op.drop_index("ix_embed_assistant_shares_organization_id", table_name="embed_assistant_shares")
        op.drop_index("ix_embed_assistant_shares_assistant_id", table_name="embed_assistant_shares")
        op.drop_table("embed_assistant_shares")

    cols = _embed_assistant_columns()
    for col in (
        "visibility",
        "data_source_ids",
        "temperature",
        "preferred_model",
        "color",
        "icon_emoji",
        "conversation_starters",
        "fallback_message",
        "welcome_message",
        "system_prompt",
    ):
        if col in cols:
            op.drop_column("embed_assistants", col)
