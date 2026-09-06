"""Regression test: POST /data/retention/cleanup had no auth dependency of
its own and trusted a caller-supplied organization_id for a destructive
operation (deletes/deactivates that org's file data sources).

Two-layer vulnerability, found during a GDPR/zero-trust audit:
1. Community Edition (no EE submodule): data_rbac_guard (the router-wide
   dependency, src/modules/data/router.py's `APIRouter(dependencies=[...])`)
   no-ops entirely when `is_ee_enabled()` is False — so the endpoint was
   fully unauthenticated, any anonymous request could delete any org's data.
2. Enterprise Edition: data_rbac_guard authorizes the caller against THEIR
   OWN organization_id (read from their JWT payload), but the endpoint then
   read organization_id from the REQUEST BODY and acted on THAT instead — a
   classic IDOR/broken-object-level-authorization bug. An authenticated user
   with legitimate data:delete permission in a tiny org could pass any other
   org's id in the body and trigger cross-tenant data destruction.

Fixed by requiring a valid session (JWTCookieBearer) and always scoping the
cleanup to the authenticated caller's own organization_id from their JWT,
rejecting (403) any request body organization_id that doesn't match. The
scheduled cron path (shared/jobs/tasks.py's run_data_retention_cleanup)
already covers the legitimate all-orgs bulk case by calling
DataRetentionService directly, bypassing this HTTP endpoint entirely — so
this endpoint never needs to support an arbitrary/cross-org target.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.modules.data.router import cleanup_file_data_retention


def _payload(org_id) -> dict:
    return {"sub": "user-1", "organization_id": org_id}


@pytest.mark.asyncio
async def test_rejects_request_body_org_id_that_does_not_match_caller():
    with patch(
        "src.modules.data.router.DataRetentionService.cleanup_expired_file_sources",
        new=AsyncMock(return_value=0),
    ):
        with pytest.raises(HTTPException) as exc_info:
            await cleanup_file_data_retention(
                request={"organization_id": 999},
                current_token=_payload(org_id=1),
                db=AsyncMock(),
            )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_no_organization_in_jwt_is_rejected():
    with pytest.raises(HTTPException) as exc_info:
        await cleanup_file_data_retention(
            request={},
            current_token=_payload(org_id=None),
            db=AsyncMock(),
        )
    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_matching_org_id_in_body_is_allowed():
    fake_cleanup = AsyncMock(return_value=3)
    with patch(
        "src.modules.data.router.DataRetentionService.cleanup_expired_file_sources", new=fake_cleanup
    ):
        result = await cleanup_file_data_retention(
            request={"organization_id": 1},
            current_token=_payload(org_id=1),
            db=AsyncMock(),
        )
    assert result["success"] is True
    assert result["organization_id"] == 1
    fake_cleanup.assert_awaited_once()
    assert fake_cleanup.await_args.kwargs.get("organization_id") == 1


@pytest.mark.asyncio
async def test_omitted_body_org_id_defaults_to_callers_own_org():
    """The body's organization_id is advisory-only now — omitting it must
    still scope correctly to the caller's own org, not operate unscoped."""
    fake_cleanup = AsyncMock(return_value=0)
    with patch(
        "src.modules.data.router.DataRetentionService.cleanup_expired_file_sources", new=fake_cleanup
    ):
        result = await cleanup_file_data_retention(
            request={},
            current_token=_payload(org_id=7),
            db=AsyncMock(),
        )
    assert result["organization_id"] == 7
    assert fake_cleanup.await_args.kwargs.get("organization_id") == 7
