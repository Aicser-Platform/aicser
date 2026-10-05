"""lake registry: per-layer Iceberg namespaces, bigint byte_size, one active version

Brings the pipeline's Silver/Gold output in line with ee/modules/warehouse/CONTRACT.md:

- data_lake_objects.byte_size becomes BIGINT (Gold tables pass 2 GB; the Warehouse's
  scan-size guard sums it).
- Iceberg tables move from namespace org_<hex> to org_<hex>_<layer>. A SqlCatalog rename
  is only a change to its iceberg_tables row (metadata files don't name the table), so the
  rows are updated in whichever schema holds them, and data_lake_objects.object_key follows.
- Older active Silver/Gold versions of the same object_key are marked superseded, as
  LoadStage now does on each load. Downgrade leaves them superseded.

Revision ID: 2026_10_02_lake_registry
Revises: 2026_10_01_share_gold_charts
Create Date: 2026-10-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "2026_10_02_lake_registry"
down_revision: Union[str, None] = "2026_10_01_share_gold_charts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD_KEY = r"^org_[0-9a-f]{32}\.[^.]+$"
_NEW_NS = r"^org_[0-9a-f]{32}_(bronze|silver|gold)$"


def _catalog_schemas(bind) -> list:
    """Schemas holding pyiceberg's SqlCatalog tables (iceberg_catalog, or public on
    installs where that schema didn't exist when the catalog was first used)."""
    found = []
    for schema in ("iceberg_catalog", "public"):
        has_tables = bind.execute(sa.text(f"SELECT to_regclass('{schema}.iceberg_tables')")).scalar()
        has_props = bind.execute(sa.text(f"SELECT to_regclass('{schema}.iceberg_namespace_properties')")).scalar()
        if has_tables:
            found.append((schema, bool(has_props)))
    return found


def upgrade() -> None:
    bind = op.get_bind()

    op.alter_column("data_lake_objects", "byte_size", type_=sa.BigInteger(), existing_nullable=True)

    for schema, has_props in _catalog_schemas(bind):
        # Registered tables: the layer comes from the registry row
        bind.execute(sa.text(f"""
            UPDATE {schema}.iceberg_tables t
            SET table_namespace = t.table_namespace || '_' || m.layer
            FROM (
                SELECT DISTINCT object_key, layer::text AS layer
                FROM data_lake_objects
                WHERE format = 'iceberg' AND object_key ~ :old_key
            ) m
            WHERE t.catalog_name = 'aiser'
              AND m.object_key = t.table_namespace || '.' || t.table_name
        """), {"old_key": _OLD_KEY})
        # Unregistered tables: LoadStage names them <layer>_<source>_<table>
        bind.execute(sa.text(f"""
            UPDATE {schema}.iceberg_tables
            SET table_namespace = table_namespace || '_' || split_part(table_name, '_', 1)
            WHERE catalog_name = 'aiser'
              AND table_namespace ~ '^org_[0-9a-f]{{32}}$'
              AND split_part(table_name, '_', 1) IN ('bronze', 'silver', 'gold')
        """))
        if has_props:
            bind.execute(sa.text(f"""
                INSERT INTO {schema}.iceberg_namespace_properties
                    (catalog_name, namespace, property_key, property_value)
                SELECT DISTINCT 'aiser', table_namespace, 'exists', 'true'
                FROM {schema}.iceberg_tables
                WHERE catalog_name = 'aiser' AND table_namespace ~ :new_ns
                ON CONFLICT DO NOTHING
            """), {"new_ns": _NEW_NS})

    bind.execute(sa.text("""
        UPDATE data_lake_objects
        SET object_key = split_part(object_key, '.', 1) || '_' || layer::text
                         || '.' || split_part(object_key, '.', 2)
        WHERE format = 'iceberg' AND object_key ~ :old_key
    """), {"old_key": _OLD_KEY})

    bind.execute(sa.text("""
        UPDATE data_lake_objects d
        SET status = 'superseded'
        FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY organization_id, object_key
                ORDER BY created_at DESC NULLS LAST, id
            ) AS rn
            FROM data_lake_objects
            WHERE status = 'active' AND layer IN ('silver', 'gold')
        ) r
        WHERE d.id = r.id AND r.rn > 1
    """))


def downgrade() -> None:
    bind = op.get_bind()

    bind.execute(sa.text("""
        UPDATE data_lake_objects
        SET object_key = regexp_replace(split_part(object_key, '.', 1), '_(bronze|silver|gold)$', '')
                         || '.' || split_part(object_key, '.', 2)
        WHERE format = 'iceberg'
          AND split_part(object_key, '.', 1) ~ :new_ns
    """), {"new_ns": _NEW_NS})

    for schema, _ in _catalog_schemas(bind):
        bind.execute(sa.text(f"""
            UPDATE {schema}.iceberg_tables
            SET table_namespace = regexp_replace(table_namespace, '_(bronze|silver|gold)$', '')
            WHERE catalog_name = 'aiser' AND table_namespace ~ :new_ns
        """), {"new_ns": _NEW_NS})

    op.alter_column("data_lake_objects", "byte_size", type_=sa.Integer(), existing_nullable=True)
