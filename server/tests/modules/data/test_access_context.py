# server/tests/modules/data/test_access_context.py
import os

import pytest

os.environ["DEBUG"] = "false"

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")

from ee.modules.data.services.access_context import (
    ALLOWED_CLAIM_KEYS,
    AccessContext,
    SystemAccessContext,
)


def test_from_token_payload_extracts_user_id():
    ctx = AccessContext.from_token_payload({"sub": "user-1", "organization_id": "org-1"})
    assert ctx.user_id == "user-1"
    assert ctx.organization_id == "org-1"


def test_from_token_payload_prefers_explicit_scope_over_claims():
    ctx = AccessContext.from_token_payload(
        {"sub": "user-1", "organization_id": "org-from-token"},
        organization_id="org-explicit",
        project_id="proj-explicit",
    )
    assert ctx.organization_id == "org-explicit"
    assert ctx.project_id == "proj-explicit"


def test_claims_are_allowlisted():
    ctx = AccessContext.from_token_payload(
        {
            "sub": "user-1",
            "organization_id": "org-1",
            "role": "attacker-supplied",
            "region": "EMEA",
            "tenant_id": "spoofed",
        }
    )
    assert set(ctx.claims) <= ALLOWED_CLAIM_KEYS
    assert "role" not in ctx.claims
    assert "region" not in ctx.claims
    assert "tenant_id" not in ctx.claims


def test_missing_user_id_is_rejected():
    with pytest.raises(ValueError, match="user_id"):
        AccessContext.from_token_payload({"organization_id": "org-1"})


def test_access_context_is_frozen():
    ctx = AccessContext.from_token_payload({"sub": "user-1"})
    with pytest.raises(Exception):
        ctx.user_id = "user-2"  # type: ignore[misc]


def test_system_context_requires_reason():
    with pytest.raises(ValueError, match="reason"):
        SystemAccessContext(reason="")


def test_system_context_is_not_an_access_context():
    # A system context must not be usable anywhere a user context is expected;
    # keeping them distinct types is what prevents "blank user_id" from looking safe.
    assert not isinstance(SystemAccessContext(reason="mv_refresh"), AccessContext)
