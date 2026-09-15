"""Backfill query permission onto existing project data-source grants with no RLS policy.

grant_project_access() previously withheld `query` from every default project grant
unconditionally, to avoid handing a standing bypass to any RLS policy added later.
That left every project member other than a data source's creator unable to query
it via the normal chat/dashboard/query-editor paths whenever no RLS policy exists
for it yet (the common case) - reported by self-host customers as "not authorized
to query this data source" for MySQL and other connectors. The application code now
grants `query` by default only when no active RLS policy exists (see
data_source_access_service.py grant_project_access / _has_active_rls_policy); this
migration applies that same rule once to grants created before the fix, so upgrading
repairs already-affected data sources without requiring an admin to touch anything.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "2026_08_23_backfill_query_grant"
down_revision: Union[str, Sequence[str], None] = "2026_08_23_llm_conv_id"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE data_source_access_grants g
            SET permissions = g.permissions || '["query"]'::jsonb
            WHERE g.grantee_type = 'project'
              AND g.is_active = true
              AND g.is_deleted = false
              AND NOT (g.permissions @> '["query"]'::jsonb)
              AND NOT EXISTS (
                  SELECT 1 FROM data_source_rls_policies p
                  WHERE p.data_source_id = g.data_source_id
                    AND p.enabled = true
                    AND p.is_active = true
                    AND p.is_deleted = false
              )
            """
        )
    )


def downgrade() -> None:
    # Not reversible in a targeted way (can't distinguish backfilled `query` entries
    # from ones an admin deliberately added by hand afterward) - no-op by design.
    pass
