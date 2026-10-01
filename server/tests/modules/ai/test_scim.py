"""SCIM: IdP filter syntax, RFC 7643 resource shapes, token format, and the email-verified
rule that decides whether a sign-in may claim a SCIM-provisioned account."""

import types

import pytest

from ee.modules.authentication.token_exchange import _supabase_email_verified
from ee.modules.organizations import identity as I
from ee.modules.organizations import scim as S


def test_filters_idps_send():
    assert S.parse_filter('userName eq "Ada@Example.com"') == ("username", "Ada@Example.com")
    assert S.parse_filter('externalId eq "00u1"') == ("externalid", "00u1")
    assert S.parse_filter('displayName eq "Finance \\"EU\\""') == ("displayname", 'Finance "EU"')
    assert S.parse_filter(None) is None
    with pytest.raises(ValueError):
        S.parse_filter('userName sw "a"')


def test_user_and_group_resources_follow_rfc7643():
    u = types.SimpleNamespace(id="11111111-1111-1111-1111-111111111111", email="ada@example.com",
                              username="ada", first_name="Ada", last_name="Lovelace")
    link = types.SimpleNamespace(external_id="00u1", active=False)
    r = S.user_resource(u, link, "https://x/scim/v2")
    assert r["schemas"] == [S.USER_SCHEMA] and r["userName"] == "ada@example.com"
    assert r["active"] is False and r["externalId"] == "00u1"
    assert r["meta"]["location"].endswith(f"/Users/{u.id}")
    g = types.SimpleNamespace(id="g1", external_id=None, display_name="Finance")
    gr = S.group_resource(g, [u.id], "https://x/scim/v2")
    assert gr["members"][0]["value"] == u.id and gr["schemas"] == [S.GROUP_SCHEMA]


def test_email_of_prefers_primary():
    assert S._email_of({"emails": [{"value": "b@x.io"}, {"value": "A@X.io", "primary": True}]}) == "a@x.io"
    assert S._email_of({"userName": "C@x.io"}) == "c@x.io"


def test_token_format_and_hash_only():
    tid, full, h, hint = I.new_token()
    assert full.startswith("scim_") and I._TOKEN_RE.match(full)
    assert full.split("_", 2)[2] not in h and len(h) == 64 and hint.startswith("scim_…")


@pytest.mark.asyncio
async def test_malformed_tokens_rejected_without_db():
    assert await I.verify_scim_token("aicser_abc") is None
    assert await I.verify_scim_token("") is None


def test_only_verified_emails_may_claim_scim_accounts():
    assert _supabase_email_verified({"user_metadata": {"email_verified": True}})
    assert _supabase_email_verified({"email_confirmed_at": "2026-09-24T00:00:00Z"})
    assert _supabase_email_verified({"app_metadata": {"provider": "sso:abc"}})
    assert not _supabase_email_verified({"user_metadata": {}, "app_metadata": {"provider": "email"}})
