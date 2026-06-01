from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from jose import JWTError, jwt

from src.core.config import settings
from src.modules.user.user_setting_repository import UserSettingRepository

EMBED_SETTING_KEY = "embed_jwt_tokens"
EMBED_TOKEN_TYPE = "embed"
EMBED_ALGORITHM = "HS256"
DEFAULT_EXPIRY_HOURS = 720

_user_settings_repo = UserSettingRepository()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _token_preview(token: str) -> str:
    if len(token) <= 12:
        return "••••"
    return f"••••{token[-8:]}"


async def _load_records(user_id: str) -> List[Dict[str, Any]]:
    raw = await _user_settings_repo.get_setting(user_id, EMBED_SETTING_KEY)
    if not raw or not raw.value:
        return []
    try:
        data = json.loads(raw.value)
        return data if isinstance(data, list) else []
    except Exception:
        return []


async def _save_records(user_id: str, records: List[Dict[str, Any]]) -> None:
    await _user_settings_repo.set_setting(user_id, EMBED_SETTING_KEY, json.dumps(records))


def _build_payload(
    *,
    token_id: str,
    user_id: str,
    org_id: Optional[str],
    scopes: List[str],
    resource_id: Optional[str],
    allowed_domains: List[str],
    expires_at: datetime,
) -> Dict[str, Any]:
    return {
        "jti": token_id,
        "sub": str(user_id),
        "org_id": org_id,
        "type": EMBED_TOKEN_TYPE,
        "scopes": scopes,
        "resource_id": resource_id,
        "allowed_domains": allowed_domains,
        "exp": int(expires_at.timestamp()),
        "iat": int(_now().timestamp()),
    }


def sign_embed_token(payload: Dict[str, Any]) -> str:
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=EMBED_ALGORITHM)


def decode_embed_token(token: str) -> Dict[str, Any]:
    payload = jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[EMBED_ALGORITHM])
    if payload.get("type") != EMBED_TOKEN_TYPE:
        raise JWTError("Invalid embed token type")
    return payload


def _build_embed_urls(token: str, scopes: List[str], resource_id: Optional[str]) -> Dict[str, str]:
    base = (settings.FRONTEND_URL or "http://localhost:3000").rstrip("/")
    urls: Dict[str, str] = {}
    if "dashboard" in scopes and resource_id:
        urls["dashboard"] = f"{base}/embed/dashboard/{resource_id}?token={token}"
    if "chart" in scopes and resource_id:
        urls["chart"] = f"{base}/embed/chart/{resource_id}?token={token}"
    if "chat" in scopes:
        urls["chat"] = f"{base}/embed/chat?token={token}"
    return urls


async def create_embed_token(
    *,
    user_id: str,
    org_id: Optional[str],
    name: str,
    scopes: List[str],
    resource_id: Optional[str] = None,
    allowed_domains: Optional[List[str]] = None,
    expires_in_hours: int = DEFAULT_EXPIRY_HOURS,
) -> Dict[str, Any]:
    token_id = str(uuid.uuid4())
    created_at = _now()
    expires_at = created_at + timedelta(hours=expires_in_hours)
    domains = [d.strip().lower() for d in (allowed_domains or []) if d and d.strip()]

    payload = _build_payload(
        token_id=token_id,
        user_id=user_id,
        org_id=org_id,
        scopes=scopes,
        resource_id=resource_id,
        allowed_domains=domains,
        expires_at=expires_at,
    )
    signed = sign_embed_token(payload)

    record = {
        "id": token_id,
        "name": name.strip(),
        "scopes": scopes,
        "resource_id": resource_id,
        "allowed_domains": domains,
        "created_at": _iso(created_at),
        "expires_at": _iso(expires_at),
        "status": "active",
        "org_id": org_id,
    }

    records = await _load_records(user_id)
    records.append(record)
    await _save_records(user_id, records)

    return {
        **record,
        "token": signed,
        "token_preview": _token_preview(signed),
        "embed_urls": _build_embed_urls(signed, scopes, resource_id),
    }


async def list_embed_tokens(user_id: str) -> List[Dict[str, Any]]:
    records = await _load_records(user_id)
    return [
        {
            **record,
            "token_preview": record.get("token_preview") or "••••",
        }
        for record in records
    ]


async def revoke_embed_token(user_id: str, token_id: str) -> bool:
    records = await _load_records(user_id)
    updated: List[Dict[str, Any]] = []
    found = False
    for record in records:
        if record.get("id") == token_id:
            found = True
            if record.get("status") != "revoked":
                record = {**record, "status": "revoked", "revoked_at": _iso(_now())}
        updated.append(record)
    if not found:
        return False
    await _save_records(user_id, updated)
    return True


async def verify_embed_token(token: str, *, required_scope: Optional[str] = None) -> Dict[str, Any]:
    payload = decode_embed_token(token)
    token_id = payload.get("jti")
    user_id = payload.get("sub")
    if not token_id or not user_id:
        raise JWTError("Invalid embed token payload")

    records = await _load_records(str(user_id))
    record = next((r for r in records if r.get("id") == token_id), None)
    if not record or record.get("status") != "active":
        raise JWTError("Embed token revoked or not found")

    scopes = payload.get("scopes") or []
    if required_scope and required_scope not in scopes:
        raise JWTError(f"Missing required scope: {required_scope}")

    exp = payload.get("exp")
    expires_at = datetime.fromtimestamp(exp, tz=timezone.utc) if exp else None
    return {
        "valid": True,
        "scopes": scopes,
        "resource_id": payload.get("resource_id"),
        "user_id": str(user_id),
        "org_id": payload.get("org_id"),
        "allowed_domains": payload.get("allowed_domains") or [],
        "expires_at": expires_at,
        "jti": token_id,
    }
