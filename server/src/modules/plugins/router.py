"""FastAPI router for Plug-in management, active discovery, and asset serving."""

from __future__ import annotations

import logging
import mimetypes
from typing import List, Optional, Union
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.plugins import service
from src.modules.plugins.registry import registry
from src.modules.plugins.schemas import (
    ActivePluginsResponse,
    PluginEnablementUpdate,
    PluginStateResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()
auth_scheme = JWTCookieBearer()


def _extract_caller(
    current_token: Union[str, dict],
    request: Optional[Request] = None,
) -> tuple[str, Optional[str], dict]:
    payload = current_token if isinstance(current_token, dict) else {}
    user_id = str(
        payload.get("id")
        or payload.get("user_id")
        or payload.get("sub")
        or (current_token if isinstance(current_token, str) else "")
    )
    org_id = str(payload.get("organization_id") or payload.get("org_id") or "").strip() or None
    if not org_id and request is not None:
        header_org = (
            request.headers.get("X-Organization-Id")
            or request.headers.get("x-organization-id")
            or request.query_params.get("organization_id")
        )
        if header_org:
            org_id = str(header_org).strip() or None
    return user_id, org_id, payload


async def _require_plugin_admin(
    user_id: str,
    org_id: Optional[str],
    payload: dict,
    db: Optional[AsyncSession] = None,
) -> None:
    explicit_role = str(payload.get("role") or "").strip().lower()
    if not explicit_role and db is not None and user_id:
        try:
            import uuid as _uuid
            from sqlalchemy import select as _select
            from src.modules.user.models import User as _User

            uid_obj = _uuid.UUID(str(user_id))
            res = await db.execute(_select(_User.role).where(_User.id == uid_obj))
            role_val = res.scalar_one_or_none()
            if isinstance(role_val, str):
                explicit_role = role_val.strip().lower()
        except Exception:
            pass

    if explicit_role in ("viewer", "member", "guest", "readonly"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator permission required to manage plug-ins",
        )
    try:
        await require_permission(
            user_id,
            "plugin:manage",
            organization_id=org_id,
            project_id=None,
        )
    except HTTPException as exc:
        if exc.status_code == status.HTTP_403_FORBIDDEN:
            # Fall back to org:edit when plugin:manage is not yet seeded in RBAC
            await require_permission(
                user_id,
                "org:edit",
                organization_id=org_id,
                project_id=None,
            )
        else:
            raise


@router.get("/active", response_model=ActivePluginsResponse)
async def get_active_plugins(
    request: Request,
    current_token: Union[str, dict] = Depends(auth_scheme),
    db: AsyncSession = Depends(get_async_session),
) -> ActivePluginsResponse:
    """Return all Active plug-in contributions and soft-disabled chart/db types for the caller."""
    _, org_id, _ = _extract_caller(current_token, request)
    scope_key = service.resolve_scope_key(org_id)
    return await service.get_active_contributions(db, scope_key=scope_key, organization_id=org_id)


@router.get("", response_model=List[PluginStateResponse])
async def list_plugins(
    request: Request,
    current_token: Union[str, dict] = Depends(auth_scheme),
    db: AsyncSession = Depends(get_async_session),
) -> List[PluginStateResponse]:
    """List all Installed plug-ins with Entitled, Enabled, and Active states (admin only)."""
    user_id, org_id, payload = _extract_caller(current_token, request)
    await _require_plugin_admin(user_id, org_id, payload, db=db)
    scope_key = service.resolve_scope_key(org_id)
    return await service.get_plugin_states(db, scope_key=scope_key, organization_id=org_id)


@router.put("/{plugin_id}/enablement", response_model=PluginStateResponse)
async def update_plugin_enablement(
    plugin_id: str,
    body: PluginEnablementUpdate,
    request: Request,
    current_token: Union[str, dict] = Depends(auth_scheme),
    db: AsyncSession = Depends(get_async_session),
) -> PluginStateResponse:
    """Enable or disable an Installed plug-in for the caller's organization/instance (admin only)."""
    user_id, org_id, payload = _extract_caller(current_token, request)
    await _require_plugin_admin(user_id, org_id, payload, db=db)

    manifest = registry.get_manifest(plugin_id)
    if manifest is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plug-in '{plugin_id}' is not installed",
        )

    scope_key = service.resolve_scope_key(org_id)
    await service.set_plugin_enablement(
        db,
        scope_key=scope_key,
        plugin_id=manifest.id,
        enabled=body.enabled,
        config=body.config,
        user_id=user_id or None,
    )

    states = await service.get_plugin_states(db, scope_key=scope_key, organization_id=org_id)
    for st in states:
        if st.id == manifest.id:
            return st

    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plug-in state not found")


@router.api_route("/{plugin_id}/assets/{version}/{file_path:path}", methods=["GET", "HEAD"])
async def get_plugin_asset(
    plugin_id: str,
    version: str,
    file_path: str,
) -> FileResponse:
    """Serve prebuilt ESM visual bundles and static assets (public, immutable cache by version)."""
    manifest = registry.get_manifest(plugin_id)
    if manifest is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plugin '{plugin_id}' not found",
        )

    if manifest.version != version:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plugin version '{version}' does not match installed version '{manifest.version}'",
        )

    decoded_path = unquote(file_path or "")
    if (
        not decoded_path
        or "\0" in decoded_path
        or "\\" in decoded_path
        or decoded_path.startswith("/")
        or ".." in decoded_path.split("/")
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: invalid or traversal path",
        )

    assets_root = registry.get_assets_dir(manifest.id)
    if not assets_root or not assets_root.is_dir():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Plugin does not expose an assets directory",
        )

    try:
        resolved_root = assets_root.resolve()
        target_file = (resolved_root / decoded_path).resolve()
        if not target_file.is_relative_to(resolved_root):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: path traversal detected",
            )
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    if not target_file.exists() or not target_file.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    suffix = target_file.suffix.lower()
    if suffix in (".js", ".mjs"):
        content_type = "text/javascript; charset=utf-8"
    elif suffix == ".css":
        content_type = "text/css; charset=utf-8"
    elif suffix == ".svg":
        content_type = "image/svg+xml"
    elif suffix == ".json":
        content_type = "application/json"
    else:
        guessed, _ = mimetypes.guess_type(str(target_file))
        content_type = guessed or "application/octet-stream"

    return FileResponse(
        path=str(target_file),
        media_type=content_type,
        headers={
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )
