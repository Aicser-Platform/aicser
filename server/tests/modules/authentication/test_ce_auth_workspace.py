"""CE auth provisions workspace (org + RBAC roles) on register/login/me."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest


@pytest.mark.asyncio
async def test_ce_register_calls_workspace_provision(monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "community")

    from src.modules.authentication.router import _ensure_auth_workspace
    from src.modules.user.models import User

    user = User(email="new@example.com", username="new")
    user.id = uuid4()

    with patch(
        "src.modules.organizations.user_workspace.ensure_user_workspace",
        new_callable=AsyncMock,
    ) as ensure:
        await _ensure_auth_workspace(user)
        ensure.assert_awaited_once_with(str(user.id), "new@example.com")
