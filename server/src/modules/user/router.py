"""
User API
FastAPI router for user profile operations backed by the `users` table.
Mounted at /api/users in core/api.py.
"""

import json
import logging
import os
import secrets
import uuid as _uuid
import base64
from datetime import datetime
from typing import List, Optional, Union

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.user.service import UserService
from src.modules.user.schemas import UserProfileUpdate, UserProfileResponse
from src.core.edition import is_ee_enabled
from src.modules.user.avatar_storage_service import (
    AvatarStorageService,
    S3AvatarStorageService,
    ALLOWED_CONTENT_TYPES,
    MAX_AVATAR_SIZE_BYTES,
    compress_image_to_webp,
    generate_avatar_s3_url,
    generate_avatar_sas_url,
    is_avatar_data_uri,
)
from src.modules.user.utils import mask_key
from src.modules.user.user_setting_repository import UserSettingRepository
from src.modules.notifications.preferences import (
    NotificationPreferencesPayload,
    load_notification_prefs_merged,
    load_notification_prefs_raw,
    save_notification_prefs,
)
from src.modules.data.utils.credentials import decrypt_credentials, encrypt_credentials

_user_settings_repo = UserSettingRepository()

logger = logging.getLogger(__name__)

router = APIRouter()


async def _resolve_avatar_display_url(avatar_url: str) -> str:
    if not avatar_url or is_avatar_data_uri(avatar_url):
        return avatar_url

    try:
        from src.core.system_settings.runtime_config import get_effective_storage_config

        storage_config = await get_effective_storage_config()
        if (
            storage_config.get("enabled")
            and str(storage_config.get("backend") or "").strip().lower() == "s3"
        ):
            return generate_avatar_s3_url(avatar_url, config=storage_config)
    except Exception:
        logger.debug(
            "Runtime avatar storage config unavailable; using env/default URL resolver",
            exc_info=True,
        )

    return generate_avatar_sas_url(avatar_url)


def _require_user_id(current_token: Union[str, dict]) -> str:
    token_dict = current_token if isinstance(current_token, dict) else {}
    uid = (
        token_dict.get("id")
        or token_dict.get("user_id")
        or token_dict.get("sub")
    )
    if not uid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User ID not found in token",
        )
    return str(uid)


async def _store_avatar_as_data_uri(
    db: AsyncSession,
    user_id: str,
    file_content: bytes,
) -> dict:
    """Store a compressed avatar directly in users.avatar_url."""
    webp_bytes = compress_image_to_webp(file_content)
    data_uri = f"data:image/webp;base64,{base64.b64encode(webp_bytes).decode()}"
    logger.info(
        "Avatar compressed: %d bytes -> %d bytes (data URI)",
        len(file_content),
        len(webp_bytes),
    )
    svc = UserService(db)
    updated = await svc.update_profile(user_id=user_id, data={"avatar_url": data_uri})
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return updated


@router.get("/profile", response_model=UserProfileResponse)
async def get_profile(
    current_token: dict = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Return the current user's profile from the users table."""
    user_id = _require_user_id(current_token)
    svc = UserService(db)
    profile = await svc.get_profile(user_id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Replace raw private object URLs with signed display URLs when needed.
    if profile.get("avatar_url"):
        profile["avatar_url"] = await _resolve_avatar_display_url(profile["avatar_url"])

    return profile


@router.put("/profile", response_model=UserProfileResponse)
async def update_profile(
    payload: UserProfileUpdate,
    current_token: dict = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Update the current user's profile in the users table."""
    user_id = _require_user_id(current_token)
    svc = UserService(db)
    updated = await svc.update_profile(
        user_id=user_id,
        data=payload.model_dump(exclude_unset=True),
    )
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return updated


@router.post("/profile/avatar", response_model=UserProfileResponse)
async def upload_avatar(
    file: UploadFile = File(...),
    current_token: dict = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Upload a new profile avatar image and persist its URL on the user's profile."""
    user_id = _require_user_id(current_token)

    # Validate content type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported image type '{content_type}'. Allowed: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}",
        )

    file_content = await file.read()

    # Validate size
    if len(file_content) > MAX_AVATAR_SIZE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large ({len(file_content)} bytes). Maximum allowed is 5 MB.",
        )

    # CE: store avatar as a base64 WebP data URI directly in the database.
    if not is_ee_enabled():
        return await _store_avatar_as_data_uri(db, user_id, file_content)

    # EE: S3/Azure store a stable object URL in users.avatar_url and profile
    # reads return a signed display URL when needed. Self-host PostgreSQL keeps
    # the compressed data URI in the user row, same as CE.
    storage_backend = os.getenv("STORAGE_BACKEND", "").strip().lower()
    storage_config = None
    try:
        from src.core.system_settings.runtime_config import get_effective_storage_config

        effective_storage = await get_effective_storage_config()
        effective_backend = str(effective_storage.get("backend") or "").strip().lower()
        if effective_storage.get("enabled") and effective_backend:
            storage_backend = effective_backend
            if effective_backend == "s3":
                storage_config = effective_storage
    except Exception:
        logger.debug(
            "Runtime storage config unavailable; using env avatar storage backend",
            exc_info=True,
        )

    if storage_backend == "postgresql":
        return await _store_avatar_as_data_uri(db, user_id, file_content)

    # Look up the user's organization so we can place the avatar under orgs/{org_id}/.
    from sqlalchemy import text

    org_row = await db.execute(
        text(
            "SELECT organization_id FROM user_roles "
            "WHERE user_id = :uid AND is_active = true AND organization_id IS NOT NULL "
            "LIMIT 1"
        ),
        {"uid": user_id},
    )
    org_id_row = org_row.fetchone()
    org_id = str(org_id_row[0]) if org_id_row else user_id  # fallback to user_id if no org

    try:
        avatar_svc = (
            S3AvatarStorageService(config=storage_config)
            if storage_backend == "s3"
            else AvatarStorageService()
        )
    except ValueError as e:
        logger.error(f"Avatar storage not configured: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Avatar storage is not configured on this server.",
        )

    # Upload (overwrite=True replaces the existing blob at the fixed path — no delete needed)
    avatar_url = await avatar_svc.upload_avatar(
        file_content=file_content,
        org_id=org_id,
        user_id=user_id,
        content_type=content_type,
    )

    svc = UserService(db)
    updated = await svc.update_profile(user_id=user_id, data={"avatar_url": avatar_url})
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    # Return a SAS URL so the frontend can immediately display the new avatar.
    if updated.get("avatar_url"):
        updated["avatar_url"] = await _resolve_avatar_display_url(updated["avatar_url"])

    return updated


class BulkProfileItem(BaseModel):
    user_id: str
    email: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    avatar_url: Optional[str] = None


class UserSettingsUpdate(BaseModel):
    language: Optional[str] = None
    timezone: Optional[str] = None
    dateFormat: Optional[str] = None
    timeFormat: Optional[str] = None
    currency: Optional[str] = None
    theme: Optional[str] = None
    autoSave: Optional[bool] = None
    notifications: Optional[bool] = None
    emailUpdates: Optional[bool] = None
    marketingEmails: Optional[bool] = None
    dataSharing: Optional[bool] = None


class ApiKeyCreateRequest(BaseModel):
    name: str


class ProviderKeyPayload(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
    endpoint: Optional[str] = None


class AiModelPreferenceRequest(BaseModel):
    model_id: str


@router.get("/bulk-profiles", response_model=List[BulkProfileItem])
async def get_bulk_profiles(
    user_ids: str = Query(..., description="Comma-separated list of user UUIDs"),
    current_token: dict = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Return basic profile info (name, avatar) for multiple users by user_id.
    Useful for displaying the correct author avatar/name in multi-user conversations."""
    _require_user_id(current_token)  # caller must be authenticated
    ids = [uid.strip() for uid in user_ids.split(",") if uid.strip()]
    if not ids:
        return []
    # Cap to 100 to prevent abuse
    ids = ids[:100]
    svc = UserService(db)
    results = []
    for uid in ids:
        try:
            profile = await svc.get_profile(uid)
            if profile:
                avatar = profile.get("avatar_url")
                if avatar:
                    avatar = await _resolve_avatar_display_url(avatar)
                results.append(BulkProfileItem(
                    user_id=profile.get("user_id") or uid,
                    email=profile.get("email"),
                    first_name=profile.get("first_name"),
                    last_name=profile.get("last_name"),
                    avatar_url=avatar,
                ))
        except Exception:
            pass  # skip missing users silently
    return results


# ─── User settings (user_settings table) ────────────────────────────────────

@router.get("/settings")
async def get_user_settings(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Get all general user settings (language, timezone, theme, etc.) for the current user."""
    user_id = None
    if isinstance(current_token, dict):
        user_id = current_token.get("id") or current_token.get("user_id") or current_token.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User ID not found in token")
    try:
        all_kv = await _user_settings_repo.get_all_settings(str(user_id))
        # Coerce booleans for known keys
        bool_keys = {"autoSave", "notifications", "emailUpdates", "marketingEmails", "dataSharing"}
        out = {}
        for k, v in all_kv.items():
            if k in bool_keys and v is not None:
                out[k] = str(v).lower() in ("true", "1", "yes")
            else:
                out[k] = v
        return {"success": True, "settings": out}
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.patch("/settings")
async def patch_user_settings(
    body: UserSettingsUpdate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Partial update for General settings; keeps Activity bell in sync with notification preferences."""
    user_id = _require_user_id(current_token)
    data = body.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is None:
            continue
        if isinstance(value, bool):
            await _user_settings_repo.set_setting(user_id, key, "true" if value else "false")
        else:
            await _user_settings_repo.set_setting(user_id, key, str(value))
    if "notifications" in data and data["notifications"] is not None:
        prefs = await load_notification_prefs_raw(user_id)
        prefs["push_notifications"] = bool(data["notifications"])
        await save_notification_prefs(user_id, prefs)
    return await get_user_settings(current_token)


@router.get("/settings/notifications")
async def get_notification_preferences(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    user_id = _require_user_id(current_token)
    return await load_notification_prefs_merged(user_id)


@router.put("/settings/notifications")
async def put_notification_preferences(
    body: NotificationPreferencesPayload,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Replace provided notification fields; `push_notifications` syncs General → Notifications in-app toggle."""
    user_id = _require_user_id(current_token)
    payload = body.model_dump(exclude_unset=True)
    prefs = await load_notification_prefs_raw(user_id)
    for k, v in payload.items():
        prefs[k] = bool(v)
    await save_notification_prefs(user_id, prefs)
    if "push_notifications" in payload:
        await _user_settings_repo.set_setting(
            user_id,
            "notifications",
            "true" if payload["push_notifications"] else "false",
        )
    return await load_notification_prefs_merged(user_id)


# ─── Platform API keys & AI provider keys ───────────────────────────────────

@router.get("/api-keys")
async def list_api_keys(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """List platform API keys for the current user (key values are masked)."""
    user_id = _require_user_id(current_token)
    try:
        raw = await _user_settings_repo.get_setting(user_id, "platform_api_keys")
        if not raw or not raw.value:
            return []
        data = json.loads(raw.value)
        return data if isinstance(data, list) else []
    except Exception:
        return []


@router.post("/api-keys")
async def create_api_key(
    payload: ApiKeyCreateRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Create a platform API key. Returns the full key once; store it securely. Server stores only id, name, prefix."""
    user_id = _require_user_id(current_token)
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="name is required")
    key_id = str(_uuid.uuid4())
    secret = secrets.token_urlsafe(32)
    raw = await _user_settings_repo.get_setting(user_id, "platform_api_keys")
    keys_list = []
    if raw and raw.value:
        try:
            keys_list = json.loads(raw.value)
        except Exception:
            pass
    created_at = datetime.utcnow().isoformat() + "Z"
    keys_list.append({
        "id": key_id,
        "name": name,
        "key": mask_key(secret),
        "created_at": created_at,
        "last_used": None,
        "status": "active",
    })
    await _user_settings_repo.set_setting(user_id, "platform_api_keys", json.dumps(keys_list))
    # Return full key only on create; client must save it (we do not store the full key server-side for security)
    return {
        "id": key_id,
        "name": name,
        "key": secret,
        "created_at": created_at,
        "status": "active",
    }


@router.delete("/api-keys/{key_id}")
async def delete_api_key(
    key_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Delete a platform API key by id."""
    user_id = _require_user_id(current_token)
    raw = await _user_settings_repo.get_setting(user_id, "platform_api_keys")
    if not raw or not raw.value:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API key not found")
    keys_list = json.loads(raw.value)
    keys_list = [k for k in keys_list if k.get("id") != key_id]
    await _user_settings_repo.set_setting(user_id, "platform_api_keys", json.dumps(keys_list))
    return {"success": True}


@router.get("/ai-provider-keys")
async def get_ai_provider_keys(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Return AI provider keys with api_key masked. Never returns raw keys."""
    user_id = _require_user_id(current_token)
    all_kv = await _user_settings_repo.get_all_settings(user_id)
    result = {}
    for k, v in all_kv.items():
        if k.startswith("provider_key."):
            provider = k.split(".", 2)[1]
            try:
                data = json.loads(v)
                data = decrypt_credentials(data)
                if isinstance(data, dict) and "api_key" in data:
                    data["api_key"] = mask_key(data["api_key"])
                result[provider] = data
            except Exception:
                pass
    return result


@router.put("/ai-provider-keys/{provider}")
async def save_ai_provider_key(
    provider: str,
    payload: ProviderKeyPayload,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Save AI provider key. Raw key is stored server-side and never logged or returned."""
    user_id = _require_user_id(current_token)
    if not provider:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="provider is required")
    key_normalized = provider.strip().lower().replace(" ", "_")
    api_key_val = (payload.api_key or "").strip()
    endpoint_val = (payload.endpoint or "").strip()
    # If client sends masked value (••••...), keep existing key and only update model/endpoint
    existing_raw = await _user_settings_repo.get_setting(user_id, f"provider_key.{key_normalized}")
    existing: dict = {}
    if existing_raw and existing_raw.value:
        try:
            existing = decrypt_credentials(json.loads(existing_raw.value))
        except Exception:
            pass
    if api_key_val and not api_key_val.startswith("••••"):
        existing["api_key"] = api_key_val
    elif existing.get("api_key"):
        api_key_val = existing["api_key"]
    elif key_normalized != "ollama":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="api_key is required for new provider key")
    if key_normalized == "ollama" and not (endpoint_val or existing.get("endpoint")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="endpoint is required for Ollama")
    store = {
        "model": (payload.model or "").strip() or existing.get("model"),
        "endpoint": endpoint_val or existing.get("endpoint"),
    }
    if api_key_val:
        store["api_key"] = api_key_val
    try:
        store = encrypt_credentials(store)
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        )
    await _user_settings_repo.set_setting(
        user_id, f"provider_key.{key_normalized}", json.dumps(store)
    )
    return {"success": True, "provider": key_normalized}


# ─── AI model preference ─────────────────────────────────────────────────────

@router.put("/preferences/ai-model")
async def set_ai_model_preference(
    payload: AiModelPreferenceRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """
    Save user's preferred AI model.
    Compatibility endpoint used by frontend proxy: PUT /api/users/preferences/ai-model
    Falls back to Redis cache when DB write fails.
    """
    import logging as _logging
    _log = _logging.getLogger(__name__)
    user_id = None
    if isinstance(current_token, dict):
        user_id = current_token.get("id") or current_token.get("user_id") or current_token.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User ID not found in token")
    if not payload.model_id or not payload.model_id.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="model_id is required")

    model_id = payload.model_id.strip()
    # Primary: DB-backed setting
    try:
        saved = await _user_settings_repo.set_setting(str(user_id), "preferred_ai_model", model_id)
        return {"success": True, "preference": {"key": saved.key, "value": saved.value}}
    except Exception as db_err:
        _log.warning("DB setting save failed (using Redis fallback): %s", db_err)
    # Fallback: Redis cache (90-day TTL)
    try:
        from src.core.cache import cache as _cache
        if _cache:
            await _cache.set(f"model_pref:{user_id}", model_id, ttl=86400 * 90)
    except Exception:
        pass
    return {"success": True, "preference": {"key": "preferred_ai_model", "value": model_id}}


@router.get("/preferences/ai-model")
async def get_ai_model_preference(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """
    Get user's preferred AI model.
    Compatibility endpoint for frontend reads — DB primary, Redis fallback.
    """
    user_id = None
    if isinstance(current_token, dict):
        user_id = current_token.get("id") or current_token.get("user_id") or current_token.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User ID not found in token")

    found = await _user_settings_repo.get_setting(str(user_id), "preferred_ai_model")
    return {
        "success": True,
        "model_id": found.value if found else None,
    }


# ─── Team members ────────────────────────────────────────────────────────────

@router.get("/team-members")
async def get_team_members(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Return team members for the current user's organization(s). Used by settings overview and Team tab."""
    user_id = _require_user_id(current_token)
    try:
        from src.db.session import async_session
        from src.modules.authentication.rbac.models import UserRole
        from sqlalchemy import select, and_
        from src.modules.authentication.rbac.database import get_organization_members

        try:
            user_uuid = _uuid.UUID(user_id)
        except (ValueError, TypeError, AttributeError):
            return {"members": []}

        async with async_session() as session:
            org_query = select(UserRole.organization_id).where(
                and_(
                    UserRole.user_id == user_uuid,
                    UserRole.is_active == True,
                    UserRole.is_deleted == False,
                    UserRole.organization_id.isnot(None),
                )
            ).distinct()
            result = await session.execute(org_query)
            org_ids = [str(row[0]) for row in result.fetchall() if row[0]]
            if not org_ids:
                return {"members": []}
            members_list = await get_organization_members(org_ids[0], session)
            out = []
            for m in members_list or []:
                out.append({
                    "id": m.get("user_id"),
                    "user_id": m.get("user_id"),
                    "name": m.get("username") or m.get("email") or "—",
                    "email": m.get("email") or "",
                    "role": m.get("role") or "member",
                    "status": "active",
                    "joined_at": m.get("joined_at") or "",
                })
            return {"members": out}
    except Exception as e:
        logger.exception("get_team_members failed")
        return {"members": []}


# ─── Brand Config (user/org branding for PPTX, dashboards, reports) ───────────

@router.get("/settings/brand")
async def get_brand_config(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Get the user's brand configuration (colors, fonts, logo, PPTX template)."""
    user_id = _require_user_id(current_token)
    try:
        from ee.modules.ai.services.brand_config_service import BrandConfig
        org_id = None
        if isinstance(current_token, dict):
            org_id = current_token.get("organization_id") or current_token.get("org_id")
        brand = await BrandConfig.load(user_id=user_id, org_id=org_id)
        return {"success": True, "brand": brand.to_dict()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/settings/brand")
async def save_brand_config(
    body: dict,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Save user brand configuration."""
    user_id = _require_user_id(current_token)
    try:
        from ee.modules.ai.services.brand_config_service import save_brand_config as _save
        await _save(user_id, body)
        return {"success": True, "message": "Brand configuration saved."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
