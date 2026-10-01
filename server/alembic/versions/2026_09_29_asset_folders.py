"""One folder tree per project for every asset type.

Creates ``asset_folders``; charts and dashboards file into it through their existing
``collection_id`` (re-pointed from chart_collections / dashboard_collections, which held no
rows); saved queries, notebooks, sheets, models and AI decisions gain ``folder_id``. Every
link is ON DELETE SET NULL: deleting a folder unfiles its work, it never deletes it. The old
collection tables are left in place (empty) so a downgrade can point back at them.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "2026_09_29_asset_folders"
down_revision = "2026_09_29_asset_visibility"
branch_labels = None
depends_on = None

REPOINT = {"charts": "chart_collections", "dashboards": "dashboard_collections"}
FOLDER_ID = ("saved_queries", "notebooks", "workbooks", "ml_models", "ai_decision_definitions")


def _tables() -> set:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _fks_to(table: str, column: str, target: str) -> list:
    return [fk["name"] for fk in sa.inspect(op.get_bind()).get_foreign_keys(table)
            if fk["referred_table"] == target and fk["constrained_columns"] == [column] and fk.get("name")]


def upgrade() -> None:
    uuid = postgresql.UUID(as_uuid=True)
    op.create_table(
        "asset_folders",
        sa.Column("id", uuid, primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("parent_id", uuid, sa.ForeignKey("asset_folders.id", ondelete="SET NULL"), nullable=True),
        sa.Column("organization_id", uuid, nullable=True),
        sa.Column("project_id", uuid, nullable=True),
        sa.Column("user_id", uuid, nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_asset_folders_id", "asset_folders", ["id"])
    op.create_index("ix_asset_folders_parent_id", "asset_folders", ["parent_id"])
    op.create_index("ix_asset_folders_organization_id", "asset_folders", ["organization_id"])
    op.create_index("ix_asset_folders_project_id", "asset_folders", ["project_id"])
    op.create_index("ix_asset_folders_user_id", "asset_folders", ["user_id"])
    op.create_index("ix_asset_folders_scope", "asset_folders", ["organization_id", "project_id", "parent_id"])

    tables = _tables()
    for table, old in REPOINT.items():
        if table not in tables:
            continue
        for name in _fks_to(table, "collection_id", old):
            op.drop_constraint(name, table, type_="foreignkey")
        # Nothing was filed in the old tables; anything pointing elsewhere is unfiled.
        op.execute(sa.text(f"UPDATE {table} SET collection_id = NULL WHERE collection_id IS NOT NULL"))
        op.create_foreign_key(f"fk_{table}_collection_asset_folder", table, "asset_folders",
                              ["collection_id"], ["id"], ondelete="SET NULL")

    for table in FOLDER_ID:
        if table not in tables:
            continue
        op.add_column(table, sa.Column("folder_id", uuid, nullable=True))
        op.create_foreign_key(f"fk_{table}_folder", table, "asset_folders", ["folder_id"], ["id"], ondelete="SET NULL")
        op.create_index(f"ix_{table}_folder_id", table, ["folder_id"])


def downgrade() -> None:
    tables = _tables()
    for table in FOLDER_ID:
        if table in tables:
            op.drop_index(f"ix_{table}_folder_id", table_name=table)
            op.drop_constraint(f"fk_{table}_folder", table, type_="foreignkey")
            op.drop_column(table, "folder_id")
    for table, old in REPOINT.items():
        if table in tables:
            op.drop_constraint(f"fk_{table}_collection_asset_folder", table, type_="foreignkey")
            op.execute(sa.text(f"UPDATE {table} SET collection_id = NULL WHERE collection_id IS NOT NULL"))
            op.create_foreign_key(None, table, old, ["collection_id"], ["id"], ondelete="SET NULL")
    op.drop_table("asset_folders")
