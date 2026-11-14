"""Alerts: one incident per breach, reminders, recovery, and delete with Undo

``alert_events`` becomes an incident: ``occurrences`` (checks that found it still breached),
``last_seen_at``, ``last_notified_at`` (reminders), ``peak_value``. It resolves when the number
recovers. ``alert_rules.deleted_at``: removed rules can be restored (Undo). Word operators ("lt") become
the symbols they mean; the evaluator used to read them all as ">".

Existing repeat events are folded into one incident per rule: the newest open event stays open
(first seen, last seen and the count carried onto it), the others are marked ``merged``. Nothing
is deleted.

Revision ID: 2026_10_29_alert_incidents
Revises: 2026_10_29_org_llm_spend
Create Date: 2026-10-29
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_29_alert_incidents"
down_revision: Union[str, None] = "2026_10_29_org_llm_spend"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _cols(bind, table: str) -> set:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "alert_events" in tables:
        have = _cols(bind, "alert_events")
        if "occurrences" not in have:
            op.add_column("alert_events", sa.Column("occurrences", sa.Integer, nullable=False, server_default=sa.text("1")))
        if "last_seen_at" not in have:
            op.add_column("alert_events", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
        if "last_notified_at" not in have:
            op.add_column("alert_events", sa.Column("last_notified_at", sa.DateTime(timezone=True), nullable=True))
        if "peak_value" not in have:
            op.add_column("alert_events", sa.Column("peak_value", sa.Float, nullable=True))
        bind.execute(sa.text("UPDATE alert_events SET last_seen_at = triggered_at, last_notified_at = triggered_at, "
                             "peak_value = evaluated_value WHERE last_seen_at IS NULL"))
        # Fold repeats: per rule, the newest open event carries the first time, last time and count.
        bind.execute(sa.text("""
            WITH open_events AS (
                SELECT id, rule_id, triggered_at,
                       row_number() OVER (PARTITION BY rule_id ORDER BY last_seen_at DESC, id) AS n,
                       min(triggered_at) OVER (PARTITION BY rule_id) AS first_at,
                       max(triggered_at) OVER (PARTITION BY rule_id) AS last_at,
                       count(*) OVER (PARTITION BY rule_id) AS total
                FROM alert_events WHERE status IN ('firing', 'acknowledged')
            )
            UPDATE alert_events e SET triggered_at = o.first_at, last_seen_at = o.last_at,
                   last_notified_at = o.last_at, occurrences = o.total
            FROM open_events o WHERE e.id = o.id AND o.n = 1 AND o.total > 1
        """))
        bind.execute(sa.text("""
            UPDATE alert_events e SET status = 'merged', resolved_at = COALESCE(e.resolved_at, now())
            -- last_seen_at, not triggered_at: the kept event now carries the first time as its start.
            FROM (SELECT id, row_number() OVER (PARTITION BY rule_id ORDER BY last_seen_at DESC, id) AS n
                  FROM alert_events WHERE status IN ('firing', 'acknowledged')) o
            WHERE e.id = o.id AND o.n > 1
        """))
    if "alert_rules" in tables:
        # Word operators ("lt") were read as ">" by the evaluator; store the symbol they mean.
        for word, symbol in (("gt", ">"), ("gte", ">="), ("ge", ">="), ("lt", "<"), ("lte", "<="), ("le", "<="),
                             ("eq", "=="), ("ne", "!="), ("neq", "!=")):
            bind.execute(sa.text("UPDATE alert_rules SET threshold_operator = :s WHERE lower(threshold_operator) = :w"),
                         {"s": symbol, "w": word})
    if "alert_rules" in tables and "deleted_at" not in _cols(bind, "alert_rules"):
        op.add_column("alert_rules", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "alert_rules" in tables and "deleted_at" in _cols(bind, "alert_rules"):
        op.drop_column("alert_rules", "deleted_at")
    if "alert_events" in tables:
        have = _cols(bind, "alert_events")
        for col in ("peak_value", "last_notified_at", "last_seen_at", "occurrences"):
            if col in have:
                op.drop_column("alert_events", col)
