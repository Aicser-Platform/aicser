"""resolve_report_branding is the report embed route's only path to an org's
name/logo - it must never require a permission check (the route is public/
token-gated) and must fail safe (empty branding, not an exception) when the
org id is missing or the org can't be found.
"""

import os

# src/modules/organizations/__init__.py only rewrites its __path__ to the EE
# implementation (service.py, branding.py, ...) when is_ee_enabled() is true -
# must be set before the first import of src.modules.organizations or its
# submodules resolve to CE's empty stub package instead (see
# test_get_organization_members.py for the same requirement).
os.environ.setdefault("AISER_EDITION", "enterprise")

from types import SimpleNamespace  # noqa: E402
from unittest.mock import AsyncMock, patch  # noqa: E402

import pytest  # noqa: E402

from ee.modules.organizations.branding import resolve_report_branding  # noqa: E402

# branding.py resolves OrganizationService via `from src.modules.organizations.service
# import OrganizationService` (the src.* alias, same convention as the rest of this
# EE package) - patch.object against that exact module object rather than a dotted
# string, since string-based patch() resolution walks getattr() on the dynamically
# aliased `src.modules.organizations` package and doesn't reliably trigger the
# real import of its `service` submodule.
import src.modules.organizations.service as org_service_module  # noqa: E402


@pytest.mark.asyncio
async def test_returns_empty_branding_when_no_organization_id():
    result = await resolve_report_branding(None)
    assert result == {"name": None, "logo_url": None}


@pytest.mark.asyncio
async def test_returns_empty_branding_when_organization_not_found():
    with patch.object(org_service_module.OrganizationService, "get_organization", new=AsyncMock(return_value=None)):
        result = await resolve_report_branding("org-missing")
    assert result == {"name": None, "logo_url": None}


@pytest.mark.asyncio
async def test_prefers_direct_logo_url_and_org_name():
    org = SimpleNamespace(name="Acme Corp", logo_url="https://cdn.example.com/logo.png", settings={})
    with patch.object(org_service_module.OrganizationService, "get_organization", new=AsyncMock(return_value=org)):
        result = await resolve_report_branding("org-1")
    assert result == {"name": "Acme Corp", "logo_url": "https://cdn.example.com/logo.png"}


@pytest.mark.asyncio
async def test_falls_back_to_settings_branding_when_no_direct_logo_url():
    org = SimpleNamespace(
        name="Acme Corp",
        logo_url=None,
        settings={"branding": {"logo_url": "https://cdn.example.com/settings-logo.png", "app_name": "Acme"}},
    )
    with patch.object(org_service_module.OrganizationService, "get_organization", new=AsyncMock(return_value=org)):
        result = await resolve_report_branding("org-1")
    assert result == {"name": "Acme", "logo_url": "https://cdn.example.com/settings-logo.png"}


@pytest.mark.asyncio
async def test_handles_none_settings():
    org = SimpleNamespace(name="Acme Corp", logo_url=None, settings=None)
    with patch.object(org_service_module.OrganizationService, "get_organization", new=AsyncMock(return_value=org)):
        result = await resolve_report_branding("org-1")
    assert result == {"name": "Acme Corp", "logo_url": None}
