"""Add EmbedAssistant.hide_aicser_branding — Team+ white-label for chat embeds.

Dashboard/chart/report embed tokens already had this exact flag
(EmbedTheme.hide_aicser_branding, src/modules/embed/schemas.py) with a
server-side Team+ entitlement gate (_enforce_white_label_entitlement,
src/modules/embed/router.py) and, as of this session, an actual badge
rendering it (client EmbedBrandingFooter). Embed Assistants (the chat-embed
builder, ee/modules/embed/) had no equivalent field at all — this closes
that gap using the same column shape and the same entitlement feature key
(embed_white_label) so both surfaces are gated identically.

EE-gated and idempotent-on-add, matching 2026_09_02_embed_assistant_builder.py.
"""
import os
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision: str = "embedasstbrand"
down_revision: Union[str, None] = "embedasstext1"
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
    cols = _embed_assistant_columns()
    if "hide_aicser_branding" not in cols:
        op.add_column(
            "embed_assistants",
            sa.Column(
                "hide_aicser_branding",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )


def downgrade() -> None:
    if not _is_ee_enabled():
        return
    cols = _embed_assistant_columns()
    if "hide_aicser_branding" in cols:
        op.drop_column("embed_assistants", "hide_aicser_branding")
