"""Encrypt delivery addresses already stored on alerts and in their history

Revision ID: 2026_11_02_alert_channel_secrets
Revises: 2026_11_02_alert_last_error
Create Date: 2026-11-02
"""
import json
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_11_02_alert_channel_secrets"
down_revision: Union[str, None] = "2026_11_02_alert_last_error"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger(__name__)


def upgrade() -> None:
    try:
        from ee.modules.alerts.channel_secrets import seal
    except ImportError:  # Community has no alerts
        return
    bind = op.get_bind()
    for row in bind.execute(sa.text("SELECT id, channels FROM alert_rules WHERE channels IS NOT NULL")).fetchall():
        channels = json.loads(row.channels) if isinstance(row.channels, str) else row.channels
        if isinstance(channels, list) and channels:
            bind.execute(sa.text("UPDATE alert_rules SET channels = CAST(:c AS jsonb) WHERE id = :id"),
                         {"c": json.dumps(seal(channels)), "id": row.id})
    for row in bind.execute(sa.text("SELECT id, snapshot FROM asset_revisions WHERE asset_type = 'alert'")).fetchall():
        snapshot = json.loads(row.snapshot) if isinstance(row.snapshot, str) else row.snapshot
        if isinstance(snapshot, dict) and snapshot.get("channels"):
            snapshot["channels"] = seal(snapshot["channels"])
            bind.execute(sa.text("UPDATE asset_revisions SET snapshot = CAST(:s AS jsonb) WHERE id = :id"),
                         {"s": json.dumps(snapshot), "id": row.id})


def downgrade() -> None:
    pass  # sealed values still work; nothing to undo
