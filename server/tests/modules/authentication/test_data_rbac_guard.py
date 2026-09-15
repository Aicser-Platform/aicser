"""Router-level RBAC guard for /data — wired as `APIRouter(dependencies=[Depends(data_rbac_guard)])`.

Mirrors the already-shipped `legacy_charts_rbac_guard` pattern: EE-only, method-aware
(GET->data:view, POST/PUT/PATCH->data:edit, DELETE->data:delete), 401 unauthenticated,
403 without the permission, pass-through when authorized or when EE is disabled.

Imported via the `src.` CE/EE shim (importing `ee.modules.authentication.rbac.guard`
directly as the first import trips a circular import in `ee/modules/authentication/rbac/__init__.py`).
Under EE, the shim re-exports the real function object as-is rather than wrapping it, so
`data_rbac_guard.__globals__` is genuinely `ee.modules.authentication.rbac.guard` — patches
below target that module (and `ee.modules...rbac_service.RBACService`, which is what
`require_permission()` inside it explicitly imports), not the `src.`-namespaced duplicates
that Python's namespace-package path-extension trick creates as separate module objects.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.modules.authentication.rbac.guard import data_rbac_guard


def _request(method: str = "GET", path: str = "/data/sources"):
    return SimpleNamespace(method=method, url=SimpleNamespace(path=path))


@pytest.mark.asyncio
async def test_ce_skips_guard_entirely():
    with patch("ee.modules.authentication.rbac.guard.is_ee_enabled", return_value=False):
        # No token at all — would 401 under EE, must be a no-op under CE.
        await data_rbac_guard(_request())


@pytest.mark.asyncio
async def test_missing_token_is_unauthenticated():
    # data_rbac_guard no longer accepts current_token as a parameter (see
    # _resolve_token's docstring: an un-Depends-marked current_token param on
    # a router-level Depends(...) guard gets silently bound to the request
    # body by FastAPI on POST/PUT/PATCH, replacing real auth with whatever
    # JSON the client sent) - it always resolves the token itself internally
    # via _resolve_token(request), which this mocks by patching what that
    # calls (JWTCookieBearer.__call__), not by injecting a parameter.
    with patch("ee.modules.authentication.rbac.guard.is_ee_enabled", return_value=True), patch(
        "src.modules.authentication.deps.auth_bearer.JWTCookieBearer.__call__",
        new=AsyncMock(side_effect=HTTPException(status_code=401, detail="Authentication required.")),
    ):
        with pytest.raises(HTTPException) as exc:
            await data_rbac_guard(_request())
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_authenticated_without_permission_is_forbidden():
    with patch("ee.modules.authentication.rbac.guard.is_ee_enabled", return_value=True), patch(
        "ee.modules.authentication.rbac.guard._resolve_token",
        new=AsyncMock(return_value={"sub": "user-1"}),
    ), patch(
        "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=False),
    ) as mock_check:
        with pytest.raises(HTTPException) as exc:
            await data_rbac_guard(_request("GET"))
    assert exc.value.status_code == 403
    mock_check.assert_awaited_once()
    kwargs = mock_check.await_args.kwargs
    permission_code = kwargs.get("permission_code") or mock_check.await_args.args[1]
    assert permission_code == "data:view"


@pytest.mark.asyncio
async def test_authenticated_with_permission_passes_through():
    with patch("ee.modules.authentication.rbac.guard.is_ee_enabled", return_value=True), patch(
        "ee.modules.authentication.rbac.guard._resolve_token",
        new=AsyncMock(return_value={"sub": "user-1"}),
    ), patch(
        "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ):
        await data_rbac_guard(_request("GET"))  # must not raise


@pytest.mark.asyncio
async def test_method_maps_to_edit_permission_for_writes():
    with patch("ee.modules.authentication.rbac.guard.is_ee_enabled", return_value=True), patch(
        "ee.modules.authentication.rbac.guard._resolve_token",
        new=AsyncMock(return_value={"sub": "user-1"}),
    ), patch(
        "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ) as mock_check:
        await data_rbac_guard(_request("POST"))
    kwargs = mock_check.await_args.kwargs
    permission_code = kwargs.get("permission_code") or mock_check.await_args.args[1]
    assert permission_code == "data:edit"


@pytest.mark.asyncio
async def test_method_maps_to_delete_permission_for_delete():
    with patch("ee.modules.authentication.rbac.guard.is_ee_enabled", return_value=True), patch(
        "ee.modules.authentication.rbac.guard._resolve_token",
        new=AsyncMock(return_value={"sub": "user-1"}),
    ), patch(
        "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
        new=AsyncMock(return_value=True),
    ) as mock_check:
        await data_rbac_guard(_request("DELETE"))
    kwargs = mock_check.await_args.kwargs
    permission_code = kwargs.get("permission_code") or mock_check.await_args.args[1]
    assert permission_code == "data:delete"


def test_data_router_has_rbac_guard_dependency():
    """Guards against the wiring on the live /data router being silently dropped."""
    from src.modules.data.router import router

    dep_calls = [dep.dependency for dep in router.dependencies]
    assert data_rbac_guard in dep_calls
