"""Unit tests for src/modules/authentication/router.py::_reject_if_sso_only.

An EE deployment with AUTH_PROVIDER explicitly set to 'supabase' or 'keycloak'
must not let /auth/login or /auth/register silently create a local-password
account — identity for that deployment is fully owned by the SSO provider.
Unset AUTH_PROVIDER (or 'local'), and CE regardless of AUTH_PROVIDER, must be
untouched.
"""

import pytest
from fastapi import HTTPException

from src.modules.authentication.router import _reject_if_sso_only


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("AISER_EDITION", raising=False)
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)
    monkeypatch.delenv("AUTH_PROVIDER", raising=False)


def test_ce_never_gated_even_with_sso_auth_provider_set(monkeypatch):
    monkeypatch.setenv("AUTH_PROVIDER", "supabase")
    _reject_if_sso_only()  # no AISER_EDITION set -> CE -> must not raise


def test_ee_defaults_to_local_when_auth_provider_unset(monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    _reject_if_sso_only()


def test_ee_explicit_local_auth_provider_not_gated(monkeypatch):
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setenv("AUTH_PROVIDER", "local")
    _reject_if_sso_only()


@pytest.mark.parametrize("provider", ["supabase", "keycloak"])
def test_ee_sso_auth_provider_rejects_local_login(monkeypatch, provider):
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setenv("AUTH_PROVIDER", provider)

    with pytest.raises(HTTPException) as exc_info:
        _reject_if_sso_only()

    assert exc_info.value.status_code == 400
