"""Regression test for get_current_user_id (ee/modules/authentication/rbac/router.py),
the auth dependency used by every project, invitation, platform/audit, and RBAC
role-assignment endpoint.

It used to call extract_user_id_from_token(token) directly -- a function that only
verifies Supabase-issued RS256 tokens (via JWKS) or, gated to development only,
unverified claims. It had NO path at all for a locally-issued HS256 token
(settings.SECRET_KEY / create_access_token), which is exactly what
POST /auth/register and /auth/login hand back. Every endpoint depending on this
function 401'd for any user authenticated that way, with a perfectly valid
token -- reproduced live: POST /api/organizations worked (uses JWTCookieBearer,
which tries local HS256 first) but POST /api/projects immediately after, with
the identical token, 401'd with "Supabase JWKS verification failed: JWT header
missing kid".

Fixed by delegating to JWTCookieBearer, the same verified extraction used
everywhere else in the app.
"""

from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.authentication.service import create_access_token
from src.modules.authentication.rbac.router import get_current_user_id


@pytest.mark.asyncio
async def test_unwraps_a_verified_payload():
    """get_current_user_id's own logic: given whatever JWTCookieBearer
    verified and handed back, correctly extract and return the sub claim.
    (The actual verification step is exercised for real, unmocked, in
    test_jwt_cookie_bearer_itself_verifies_the_local_token_end_to_end below
    -- that one is the real regression proof.)"""
    user_id = str(uuid4())
    result = await get_current_user_id(
        payload={"id": user_id, "user_id": user_id, "sub": user_id, "email": "regress@example.com"}
    )
    assert result == user_id


@pytest.mark.asyncio
async def test_jwt_cookie_bearer_itself_verifies_the_local_token_end_to_end():
    """No mocking of the verification step -- proves a real create_access_token
    token round-trips through the actual JWTCookieBearer.__call__ that
    get_current_user_id now delegates to, exactly as it did for the
    organizations endpoints that never had this bug."""
    from types import SimpleNamespace

    from src.modules.authentication.deps.auth_bearer import JWTCookieBearer

    user_id = str(uuid4())
    token = create_access_token(user_id=user_id, email="regress2@example.com")

    request = SimpleNamespace(
        headers={"Authorization": f"Bearer {token}"},
        cookies={},
    )

    payload = await JWTCookieBearer()(request)

    assert payload.get("sub") == user_id


@pytest.mark.asyncio
async def test_rejects_missing_token():
    with pytest.raises(HTTPException) as exc:
        await get_current_user_id(payload=None)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_payload_without_sub_claim():
    with pytest.raises(HTTPException) as exc:
        await get_current_user_id(payload={"email": "no-sub@example.com"})
    assert exc.value.status_code == 401
