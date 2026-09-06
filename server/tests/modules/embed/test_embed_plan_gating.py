"""Regression tests for plan-gating on embed token creation/editing/viewing.

Root cause: embed:create/embed:manage (src/modules/embed/router.py) were
gated only by RBAC role via enforce_permission -- never by subscription
plan. A Free-org admin could mint unlimited white-labeled embed tokens
identical to what a paying Team/Enterprise org gets, because nothing ever
checked ee/modules/pricing/plans.py's embed_analytics / embed_white_label
features. These tests exercise the two new gate helpers in isolation
(org_entitlement itself is mocked -- it's DB-backed and already implicitly
covered by feature_gate's own usage elsewhere) to lock in: which HTTP status
and feature name each denial carries, and that a plan-entitled request
passes through unchanged.
"""

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from src.modules.embed import router as embed_router
from src.modules.embed.schemas import EmbedTheme


@pytest.mark.asyncio
async def test_require_embed_analytics_raises_402_when_not_entitled(monkeypatch):
    monkeypatch.setattr(
        embed_router, "org_entitlement",
        AsyncMock(return_value=(False, "Feature 'embed_analytics' requires a higher plan.")),
    )

    with pytest.raises(HTTPException) as exc_info:
        await embed_router._require_embed_analytics_entitlement("org-1", db=AsyncMock())

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail["feature"] == "embed_analytics"
    assert exc_info.value.detail["upgrade_required"] is True


@pytest.mark.asyncio
async def test_require_embed_analytics_passes_when_entitled(monkeypatch):
    monkeypatch.setattr(embed_router, "org_entitlement", AsyncMock(return_value=(True, "")))

    # Must not raise.
    await embed_router._require_embed_analytics_entitlement("org-1", db=AsyncMock())


@pytest.mark.asyncio
async def test_white_label_theme_passes_through_when_not_requested(monkeypatch):
    """A theme that never sets hide_aicser_branding shouldn't trigger an
    entitlement check at all -- Pro-tier orgs (no white-label) must still be
    able to set primary_color/logo_url."""
    org_entitlement_mock = AsyncMock()
    monkeypatch.setattr(embed_router, "org_entitlement", org_entitlement_mock)

    theme = EmbedTheme(primary_color="#00c2cb")
    result = await embed_router._enforce_white_label_entitlement(theme, "org-1", db=AsyncMock())

    assert result is theme
    org_entitlement_mock.assert_not_called()


@pytest.mark.asyncio
async def test_white_label_theme_raises_402_when_not_entitled(monkeypatch):
    monkeypatch.setattr(
        embed_router, "org_entitlement",
        AsyncMock(return_value=(False, "Feature 'embed_white_label' requires a higher plan.")),
    )

    theme = EmbedTheme(hide_aicser_branding=True)
    with pytest.raises(HTTPException) as exc_info:
        await embed_router._enforce_white_label_entitlement(theme, "org-1", db=AsyncMock())

    assert exc_info.value.status_code == 402
    assert exc_info.value.detail["feature"] == "embed_white_label"


@pytest.mark.asyncio
async def test_white_label_theme_passes_when_entitled(monkeypatch):
    monkeypatch.setattr(embed_router, "org_entitlement", AsyncMock(return_value=(True, "")))

    theme = EmbedTheme(hide_aicser_branding=True)
    result = await embed_router._enforce_white_label_entitlement(theme, "org-1", db=AsyncMock())

    assert result is theme
    assert result.hide_aicser_branding is True


@pytest.mark.asyncio
async def test_none_theme_is_a_no_op():
    result = await embed_router._enforce_white_label_entitlement(None, "org-1", db=AsyncMock())
    assert result is None
