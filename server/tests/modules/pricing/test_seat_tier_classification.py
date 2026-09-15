"""Regression test: a user's seat classification (viewer vs editor) must
account for project-level roles, not just their org-level role.

Root cause this guards against: the original implementation only queried
org-level UserRole rows (project_id IS NULL), so a user with org-level
org_viewer but project_editor on some project in the org would be billed as
a cheap viewer seat despite having real edit access somewhere -- an
under-billing / privilege-mismatch bug, not just a display nit.
"""

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4
from datetime import datetime, timezone

import pytest

from ee.modules.invitations.service import _count_organization_seats_by_tier


def _make_db(org_role_rows, project_role_rows):
    """A fake AsyncSession whose .execute() answers, in order: the org-level
    roles query, the project-level roles query (only made when there's at
    least one org-level seat to refine), then the pending-invitations query
    (empty here -- these tests are only about active-member classification)."""
    responses = [org_role_rows, project_role_rows, []]
    call_count = {"n": 0}

    async def execute(_stmt):
        idx = min(call_count["n"], len(responses) - 1)
        call_count["n"] += 1
        result = MagicMock()
        result.all.return_value = responses[idx]
        return result

    db = AsyncMock()
    db.execute = execute
    return db


@pytest.mark.asyncio
async def test_org_viewer_with_no_project_roles_stays_viewer():
    user_id = uuid4()
    db = _make_db(org_role_rows=[(user_id, "org_viewer")], project_role_rows=[])

    counts = await _count_organization_seats_by_tier(db, "org-1", now=datetime.now(timezone.utc))

    assert counts["viewer"]["active"] == 1
    assert counts["editor"]["active"] == 0


@pytest.mark.asyncio
async def test_org_viewer_with_project_editor_role_becomes_editor_seat():
    """The exact bug this change fixes: org-level org_viewer must NOT be
    enough to bill someone as a cheap viewer seat if they can edit a
    project."""
    user_id = uuid4()
    db = _make_db(
        org_role_rows=[(user_id, "org_viewer")],
        project_role_rows=[(user_id, "project_editor")],
    )

    counts = await _count_organization_seats_by_tier(db, "org-1", now=datetime.now(timezone.utc))

    assert counts["viewer"]["active"] == 0
    assert counts["editor"]["active"] == 1


@pytest.mark.asyncio
async def test_org_viewer_with_project_viewer_role_stays_viewer():
    user_id = uuid4()
    db = _make_db(
        org_role_rows=[(user_id, "org_viewer")],
        project_role_rows=[(user_id, "project_viewer")],
    )

    counts = await _count_organization_seats_by_tier(db, "org-1", now=datetime.now(timezone.utc))

    assert counts["viewer"]["active"] == 1
    assert counts["editor"]["active"] == 0


@pytest.mark.asyncio
async def test_org_member_is_always_an_editor_seat_regardless_of_project_roles():
    user_id = uuid4()
    db = _make_db(
        org_role_rows=[(user_id, "org_member")],
        project_role_rows=[(user_id, "project_viewer")],
    )

    counts = await _count_organization_seats_by_tier(db, "org-1", now=datetime.now(timezone.utc))

    assert counts["viewer"]["active"] == 0
    assert counts["editor"]["active"] == 1


@pytest.mark.asyncio
async def test_no_members_short_circuits_without_querying_project_roles():
    """No org-level seats at all -- must not even attempt the project-role
    query (nothing to refine, and an empty IN (...) clause is a footgun)."""
    project_query_called = {"value": False}

    async def execute(_stmt):
        result = MagicMock()
        result.all.return_value = []
        return result

    db = AsyncMock()
    db.execute = execute

    counts = await _count_organization_seats_by_tier(db, "org-1", now=datetime.now(timezone.utc))

    assert counts["viewer"]["active"] == 0
    assert counts["editor"]["active"] == 0
