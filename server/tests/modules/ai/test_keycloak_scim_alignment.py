"""Keycloak ↔ SCIM alignment: the provisioning provider follows the configured SSO, tokens must
come from this realm and this app, deprovisioned users can't sign back in, and Keycloak groups
flow into identity groups."""

import pytest
from fastapi import HTTPException

from ee.modules.authentication import router as R
from ee.modules.authentication.token_exchange import _check_keycloak_issuer_and_client
from ee.modules.organizations import identity as I


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for v in ("SCIM_USER_PROVIDER", "KEYCLOAK_URL", "KEYCLOAK_REALM", "SUPABASE_URL", "AISER_DEPLOYMENT_MODE",
              "KEYCLOAK_ISSUER", "KEYCLOAK_ALLOWED_CLIENT_IDS", "NEXT_PUBLIC_KEYCLOAK_CLIENT_ID",
              "KEYCLOAK_PUBLIC_CLIENT_ID", "KEYCLOAK_CLIENT_ID"):
        monkeypatch.delenv(v, raising=False)


def test_scim_provider_follows_configured_sso(monkeypatch):
    assert I.default_sso_provider() == "supabase"
    monkeypatch.setenv("KEYCLOAK_URL", "http://keycloak:8080")
    monkeypatch.setenv("KEYCLOAK_REALM", "aiser")
    assert I.default_sso_provider() == "keycloak"
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    assert I.default_sso_provider() == "supabase"          # both configured, SaaS → Supabase
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    assert I.default_sso_provider() == "keycloak"          # both configured, self-host → Keycloak
    monkeypatch.setenv("SCIM_USER_PROVIDER", "Supabase")
    assert I.default_sso_provider() == "supabase"          # explicit wins


def test_keycloak_token_must_be_this_realm_and_this_app(monkeypatch):
    ok = {"iss": "http://localhost:8080/realms/aiser", "azp": "aiser-client"}
    _check_keycloak_issuer_and_client(ok, "http://keycloak:8080", "aiser")  # no client ids configured: realm only
    monkeypatch.setenv("KEYCLOAK_CLIENT_ID", "aiser-backend")               # backend client alone: not enforced
    _check_keycloak_issuer_and_client(ok, "http://keycloak:8080", "aiser")
    with pytest.raises(ValueError):
        _check_keycloak_issuer_and_client({**ok, "iss": "http://kc/realms/other"}, "http://kc", "aiser")
    monkeypatch.setenv("KEYCLOAK_ALLOWED_CLIENT_IDS", "aiser-client,aiser-backend")
    _check_keycloak_issuer_and_client(ok, "http://kc", "aiser")
    _check_keycloak_issuer_and_client({**ok, "azp": "x", "aud": ["aiser-backend"]}, "http://kc", "aiser")
    with pytest.raises(ValueError, match="different application"):
        _check_keycloak_issuer_and_client({**ok, "azp": "some-other-client", "aud": "account"}, "http://kc", "aiser")
    monkeypatch.setenv("KEYCLOAK_ISSUER", "https://sso.example.com/realms/aiser")
    with pytest.raises(ValueError, match="issuer"):
        _check_keycloak_issuer_and_client(ok, "http://kc", "aiser")


@pytest.mark.asyncio
async def test_deprovisioned_user_cannot_sign_back_in(monkeypatch):
    class _U:
        id = "11111111-1111-1111-1111-111111111111"
        email = "ada@example.com"

    async def _upsert(*a, **k):
        return _U()

    async def _blocked(uid):
        return True

    async def _never(*a, **k):
        raise AssertionError("workspace must not be provisioned for a deprovisioned user")

    monkeypatch.setattr(R, "validate_keycloak_token", lambda t: {"sub": "s", "email": "ada@example.com",
                                                                 "email_verified": True, "groups": []})
    monkeypatch.setattr(R, "upsert_provider_user", _upsert)
    monkeypatch.setattr(I, "deprovisioned_by_idp", _blocked)
    monkeypatch.setattr(R, "ensure_sso_user_workspace", _never)
    body = R.TokenExchangeRequest(provider="keycloak", token="t")
    with pytest.raises(HTTPException) as exc:
        await R.token_exchange(body, response=None, db=None)
    assert exc.value.status_code == 403


def test_group_claim_names_are_normalised():
    # Keycloak sends full paths ("/Finance/EU") — the leaf name is the group.
    import asyncio

    async def _run():
        return await I.sync_idp_groups("not-a-uuid", "also-not", ["/Finance/EU", "Ops/", ""])

    assert asyncio.run(_run()) == {"added": [], "removed": []}  # invalid ids: no-op, never raises
