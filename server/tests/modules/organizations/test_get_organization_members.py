"""Members endpoint must emit one person per user, not one row per role."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")

for _azure_mod in (
    "azure",
    "azure.core",
    "azure.core.exceptions",
    "azure.identity",
    "azure.storage",
    "azure.storage.blob",
):
    sys.modules.setdefault(_azure_mod, MagicMock())

pytest.importorskip("ee.modules.organizations.service")

from src.modules.organizations.service import _collapse_member_rows


async def _collapse(rows):
    return _collapse_member_rows(rows, {})


@pytest.mark.asyncio
async def test_a_member_with_several_roles_appears_once(monkeypatch):
    """The join emits one row per role assignment. Six roles must not become six people."""
    user_id = uuid4()
    early, late = uuid4(), uuid4()
    rows = [
        SimpleNamespace(
            user_id=user_id, email="a@example.com", first_name="A", last_name="B",
            avatar_url=None, is_active=True, role_id=late, role_name="org_viewer",
            role_scope="organization", role_display_name="Viewer",
            assigned_at=datetime(2026, 2, 1, tzinfo=timezone.utc),
        ),
        SimpleNamespace(
            user_id=user_id, email="a@example.com", first_name="A", last_name="B",
            avatar_url=None, is_active=True, role_id=early, role_name="org_admin",
            role_scope="organization", role_display_name="Admin",
            assigned_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        ),
    ]
    members = await _collapse(rows)

    assert len(members) == 1
    assert members[0]["email"] == "a@example.com"
    # Existing fields come from the earliest assignment, so the shape is stable.
    assert members[0]["role_id"] == str(early)
    assert members[0]["role_name"] == "org_admin"
    # The full set is still available to anyone who wants it.
    assert {role["name"] for role in members[0]["roles"]} == {"org_admin", "org_viewer"}
