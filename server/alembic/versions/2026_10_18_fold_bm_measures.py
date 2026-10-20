"""Measures and dimensions live in the semantic model only

Connection metadata (schema.business_metadata) used to keep its own measures and dimensions lists
next to the semantic model. Each measure with a calculation becomes a draft metric on its
connection (unless one of that name exists); measures without one mark their column as an amount,
and dimensions mark their column as a category. The lists are then removed.

Revision ID: 2026_10_18_fold_bm_measures
Revises: 2026_10_18_drop_onboarding
Create Date: 2026-10-18
"""

import hashlib
import json
import uuid
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_18_fold_bm_measures"
down_revision: Union[str, None] = "2026_10_18_drop_onboarding"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _items(value):
    for v in value or []:
        item = v if isinstance(v, dict) else {"name": str(v)}
        name = str(item.get("name") or "").strip()
        if name:
            yield name, item


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(sa.text(
        "SELECT id, schema FROM data_sources "
        "WHERE schema::jsonb -> 'business_metadata' ?| array['measures', 'dimensions']"
    )).all()
    for ds_id, schema in rows:
        schema = schema if isinstance(schema, dict) else json.loads(schema or "{}")
        bm = dict(schema.get("business_metadata") or {})
        roles = dict(bm.get("column_roles") or {})
        descriptions = dict(bm.get("column_descriptions") or {})
        for name, item in _items(bm.get("measures")):
            if item.get("expression"):
                exists = bind.execute(sa.text(
                    "SELECT 1 FROM semantic_metrics WHERE data_source_id = :ds AND lower(name) = lower(:n) AND is_active"
                ), {"ds": ds_id, "n": name}).first()
                if not exists:
                    bind.execute(sa.text(
                        "INSERT INTO semantic_metrics (id, data_source_id, name, expression, description, source) "
                        "VALUES (:id, :ds, :n, :e, :d, 'business_metadata')"
                    ), {"id": str(uuid.UUID(hashlib.md5(f"bm:{ds_id}:{name}".encode()).hexdigest())), "ds": ds_id, "n": name,
                        "e": str(item["expression"]), "d": item.get("description") or ""})
            else:
                roles.setdefault(name, "amount")
            if item.get("description"):
                descriptions.setdefault(name, str(item["description"]))
        for name, item in _items(bm.get("dimensions")):
            roles.setdefault(name, "category")
            if item.get("description"):
                descriptions.setdefault(name, str(item["description"]))
        bm.pop("measures", None)
        bm.pop("dimensions", None)
        if roles:
            bm["column_roles"] = roles
        if descriptions:
            bm["column_descriptions"] = descriptions
        schema["business_metadata"] = bm
        bind.execute(sa.text("UPDATE data_sources SET schema = CAST(:s AS json) WHERE id = :id"),
                     {"s": json.dumps(schema, default=str), "id": ds_id})


def downgrade() -> None:
    # The metrics stay in the semantic model; nothing to restore.
    pass
