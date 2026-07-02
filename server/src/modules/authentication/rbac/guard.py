"""CE import shim — canonical RBAC guards live in ``ee.modules.authentication.rbac.guard``."""

from __future__ import annotations

from typing import Optional, Union

from fastapi import Request

from src.core.edition import is_ee_enabled

try:
    if is_ee_enabled():
        from ee.modules.authentication.rbac.guard import (  # noqa: F401
            data_rbac_guard,
            legacy_charts_rbac_guard,
            permission_for_method,
            require_permission,
            schedule_email_rbac_guard,
            semantic_rbac_guard,
            user_id_from_payload,
        )
    else:
        raise ImportError("EE RBAC disabled")
except ImportError:
    # Community Edition without EE package on disk — guards are no-ops.
    async def require_permission(*_args, **_kwargs) -> None:
        return

    def user_id_from_payload(payload: dict) -> Optional[str]:
        if not payload:
            return None
        return str(payload.get("sub") or payload.get("user_id") or payload.get("id") or "") or None

    def permission_for_method(method: str, *, view: str, edit: str, delete: str) -> str:
        m = (method or "GET").upper()
        if m == "DELETE":
            return delete
        if m in ("POST", "PUT", "PATCH"):
            return edit
        return view

    async def legacy_charts_rbac_guard(request: Request, current_token: Union[str, dict, None] = None) -> None:
        return

    async def data_rbac_guard(request: Request, current_token: Union[str, dict, None] = None) -> None:
        return

    async def schedule_email_rbac_guard(request: Request, current_token: Union[str, dict, None] = None) -> None:
        return

    async def semantic_rbac_guard(request: Request, current_token: Union[str, dict, None] = None) -> None:
        return
