"""ee_wire_ce_fks

Wire FK constraints from CE tables (dashboards, charts, etc.) to EE tables
(projects, organizations, conversation). Only runs on EE installs because this
file is on the ee branch. depends_on ensures CE migration 4aa4ed67bea3
(which adds the project_id columns) has been applied first.

Revision ID: e1f2a3b4c5d6
Revises: f11a9f2c63b1
Create Date: 2026-05-08

"""
import os
from typing import Sequence, Union

from alembic import op


def _is_ee_enabled() -> bool:
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    return edition in {"enterprise", "ee"} or bool(os.getenv("AISER_EDITION_LICENSE_KEY", "").strip())


revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, None] = 'f11a9f2c63b1'
branch_labels: Union[str, Sequence[str], None] = None
# Guarantees 4aa4ed67bea3 (add_project_id_to_dashboards) is applied before
# this EE migration, regardless of branch traversal order.
depends_on: Union[str, Sequence[str], None] = ('4aa4ed67bea3',)


def upgrade() -> None:
    if not _is_ee_enabled():
        return

    # dashboards.project_id → projects.id
    op.create_foreign_key('fk_dashboards_project_id', 'dashboards', 'projects', ['project_id'], ['id'])

    # charts.project_id → projects.id
    op.create_foreign_key('fk_charts_project_id', 'charts', 'projects', ['project_id'], ['id'])

    # charts.conversation_id → conversation.id
    op.create_foreign_key('fk_charts_conversation_id', 'charts', 'conversation', ['conversation_id'], ['id'])

    # connector_runtime_jobs.project_id → projects.id
    op.create_foreign_key('fk_connector_jobs_project_id', 'connector_runtime_jobs', 'projects', ['project_id'], ['id'])

    # data_sources.project_id → projects.id
    op.create_foreign_key('fk_data_sources_project_id', 'data_sources', 'projects', ['project_id'], ['id'])

    # file_storage.project_id → projects.id
    op.create_foreign_key('fk_file_storage_project_id', 'file_storage', 'projects', ['project_id'], ['id'])

    # project_data_source.project_id → projects.id
    op.create_foreign_key('fk_project_ds_project_id', 'project_data_source', 'projects', ['project_id'], ['id'])

    # dashboard_shares.organization_id → organizations.id
    op.create_foreign_key('fk_dashboard_shares_org_id', 'dashboard_shares', 'organizations', ['organization_id'], ['id'])

    # feed_posts.project_id → projects.id
    op.create_foreign_key('fk_feed_posts_project_id', 'feed_posts', 'projects', ['project_id'], ['id'])

    # feed_posts.organization_id → organizations.id
    op.create_foreign_key('fk_feed_posts_org_id', 'feed_posts', 'organizations', ['organization_id'], ['id'])

    # feed_events.project_id → projects.id
    op.create_foreign_key('fk_feed_events_project_id', 'feed_events', 'projects', ['project_id'], ['id'])

    # feed_events.organization_id → organizations.id
    op.create_foreign_key('fk_feed_events_org_id', 'feed_events', 'organizations', ['organization_id'], ['id'])

    # feed_collections.project_id → projects.id
    op.create_foreign_key('fk_feed_collections_project_id', 'feed_collections', 'projects', ['project_id'], ['id'])

    # feed_collections.organization_id → organizations.id
    op.create_foreign_key('fk_feed_collections_org_id', 'feed_collections', 'organizations', ['organization_id'], ['id'])


def downgrade() -> None:
    if not _is_ee_enabled():
        return

    op.drop_constraint('fk_feed_collections_org_id', 'feed_collections', type_='foreignkey')
    op.drop_constraint('fk_feed_collections_project_id', 'feed_collections', type_='foreignkey')
    op.drop_constraint('fk_feed_events_org_id', 'feed_events', type_='foreignkey')
    op.drop_constraint('fk_feed_events_project_id', 'feed_events', type_='foreignkey')
    op.drop_constraint('fk_feed_posts_org_id', 'feed_posts', type_='foreignkey')
    op.drop_constraint('fk_feed_posts_project_id', 'feed_posts', type_='foreignkey')
    op.drop_constraint('fk_dashboard_shares_org_id', 'dashboard_shares', type_='foreignkey')
    op.drop_constraint('fk_project_ds_project_id', 'project_data_source', type_='foreignkey')
    op.drop_constraint('fk_file_storage_project_id', 'file_storage', type_='foreignkey')
    op.drop_constraint('fk_data_sources_project_id', 'data_sources', type_='foreignkey')
    op.drop_constraint('fk_connector_jobs_project_id', 'connector_runtime_jobs', type_='foreignkey')
    op.drop_constraint('fk_charts_conversation_id', 'charts', type_='foreignkey')
    op.drop_constraint('fk_charts_project_id', 'charts', type_='foreignkey')
    op.drop_constraint('fk_dashboards_project_id', 'dashboards', type_='foreignkey')
