from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
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
    locked_filters: Optional[List[Dict[str, Any]]] = None,
    download: str = "none",
    once: bool = False,
) -> Dict[str, Any]:
    extra: Dict[str, Any] = {"locked_filters": locked_filters} if locked_filters else {}
    if download != "none":
        extra["download"] = download
    if once:
        # Signed per-visitor links open once: the page trades the link for a session and a
        # copied or logged URL is useless afterwards (Looker's nonce, Tableau's single-use JWT).
        extra["once"] = True
    return {
        **extra,
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


def _embed_signing_key() -> str:
    """A key only embed tokens use, derived from JWT_SECRET_KEY: even where that secret is
    configured to the same value as a sign-in secret (JWT_SECRET, SECRET_KEY), an embed token
    can't verify as a sign-in token."""
    import hashlib
    import hmac

    return hmac.new(settings.JWT_SECRET_KEY.encode(), b"aicser-embed-token-v1", hashlib.sha256).hexdigest()


def sign_embed_token(payload: Dict[str, Any]) -> str:
    return jwt.encode(payload, _embed_signing_key(), algorithm=EMBED_ALGORITHM)


def decode_embed_token(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, _embed_signing_key(), algorithms=[EMBED_ALGORITHM])
    except JWTError as exc:
        if "expired" in str(exc).lower():
            raise
        # Links created before the derived key keep working until they expire or are revoked
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
    if "report" in scopes and resource_id:
        urls["report"] = f"{base}/embed/report/{resource_id}?token={token}"
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
    theme: Optional[Dict[str, Any]] = None,
    locked_filters: Optional[List[Dict[str, Any]]] = None,
    expires_in_minutes: Optional[int] = None,
    kind: str = "manual",
    download: str = "none",
) -> Dict[str, Any]:
    """``locked_filters`` pin every query made with this token to one of the host app's customers
    (see embed/locked_filters.py). ``kind="signed"`` marks short-lived tokens minted by a host
    server per end user; they open once, and expired ones are pruned so the list can't grow
    without bound. ``download`` is what visitors may save: nothing, a picture, or the data
    behind each chart."""
    from src.modules.embed.limits import DOWNLOAD_LEVELS

    if download not in DOWNLOAD_LEVELS:
        raise HTTPException(status_code=400, detail="download must be none, image or data.")
    # SECURITY: a resource-scoped token (dashboard/chart/report) with no
    # resource_id used to verify successfully against *any* resource of that
    # type (verify_dashboard_read_access's `"" in ("", str(dashboard_id))`
    # check was always True when the token carried no resource_id) — a
    # cross-tenant data leak, not just a UX gap. Reject at creation instead of
    # relying solely on the read-side check to catch it.
    _RESOURCE_SCOPED = {"dashboard", "chart", "report"}
    if not resource_id and any(s in _RESOURCE_SCOPED for s in scopes):
        raise HTTPException(
            status_code=400,
            detail="A specific dashboard, chart, or report must be selected for this embed scope.",
        )

    from src.modules.embed.locked_filters import sanitize as _sanitize_locked

    try:
        locked = _sanitize_locked(locked_filters) if locked_filters else []
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    token_id = str(uuid.uuid4())
    created_at = _now()
    expires_at = created_at + (
        timedelta(minutes=expires_in_minutes) if expires_in_minutes else timedelta(hours=expires_in_hours)
    )
    domains = [d.strip().lower() for d in (allowed_domains or []) if d and d.strip()]

    payload = _build_payload(
        token_id=token_id,
        user_id=user_id,
        org_id=org_id,
        scopes=scopes,
        resource_id=resource_id,
        allowed_domains=domains,
        expires_at=expires_at,
        locked_filters=[{"field": f["field"], "value": f["values"]} for f in locked] or None,
        download=download,
        once=kind == "signed",
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
        "theme": theme,
        "kind": kind,
        "download": download,
        "locked_fields": sorted({f["field"] for f in locked}) or None,
    }

    records = await _load_records(user_id)
    now_iso = _iso(_now())
    # Signed per-customer tokens and render tokens are short-lived: drop the expired ones as new
    # ones are minted, so the list can't grow without bound.
    records = [
        r for r in records
        if not (r.get("kind") in ("signed", "export") and str(r.get("expires_at") or "") < now_iso)
    ]
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


async def get_embed_token_record(user_id: str, token_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single embed token record without modifying it — used to
    resolve which org a token belongs to before enforcing org-scoped
    permission/plan checks on update/revoke (mirrors create_embed_token's
    own org-scoping fix; see router.py)."""
    records = await _load_records(user_id)
    return next((r for r in records if r.get("id") == token_id), None)


async def update_embed_token_theme(
    user_id: str, token_id: str, theme: Optional[Dict[str, Any]]
) -> Optional[Dict[str, Any]]:
    """Theme-only edit — reuses the existing signed token/URLs. Returns the
    updated record, or None if no matching token exists for this user."""
    records = await _load_records(user_id)
    updated: List[Dict[str, Any]] = []
    found: Optional[Dict[str, Any]] = None
    for record in records:
        if record.get("id") == token_id:
            record = {**record, "theme": theme}
            found = record
        updated.append(record)
    if found is None:
        return None
    await _save_records(user_id, updated)
    return {**found, "token_preview": found.get("token_preview") or "••••"}


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


def needs_session(payload: Dict[str, Any]) -> bool:
    """A link that opens once, or that only certain sites may show, reads data only through the
    session its page opened: that exchange is where single use and the site check happen."""
    return not payload.get("ses") and bool(payload.get("once") or payload.get("allowed_domains"))


async def _active_record(payload: Dict[str, Any]) -> Dict[str, Any]:
    token_id = payload.get("jti")
    user_id = payload.get("sub")
    if not token_id or not user_id:
        raise JWTError("Invalid embed token payload")
    records = await _load_records(str(user_id))
    record = next((r for r in records if r.get("id") == token_id), None)
    if not record or record.get("status") != "active":
        raise JWTError("Embed token revoked or not found")
    return record


async def verify_embed_token(
    token: str, *, required_scope: Optional[str] = None, allow_link: bool = False
) -> Dict[str, Any]:
    """Check an embed token. A session token (from :func:`open_embed_session`) is what embed
    pages send with their data requests; the link token itself only works where ``allow_link``
    says so, unless it is an unrestricted public link."""
    payload = decode_embed_token(token)
    token_id = payload.get("jti")
    user_id = payload.get("sub")
    record = await _active_record(payload)
    if not allow_link and needs_session(payload):
        raise JWTError("Open this embed through its page")

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
        "theme": record.get("theme"),
        "download": payload.get("download") or "none",
        "locked": bool(payload.get("locked_filters")),
        "session": bool(payload.get("ses")),
    }


class EmbedOriginError(Exception):
    """The page showing the embed isn't one of the token's allowed sites."""


def origin_allowed(origin: str, allowed_domains: List[str]) -> bool:
    """``origin`` (https://app.example.com) is one of the allowed sites or a subdomain of one."""
    from src.core.middleware import _normalize_host

    host = _normalize_host(origin)
    allowed = {_normalize_host(d) for d in allowed_domains if d}
    return bool(host) and (host in allowed or any(host.endswith(f".{d}") for d in allowed if d))


_used_links: Dict[str, float] = {}


def _claim_link(token_id: str, expires_at: int) -> bool:
    """True the first time a single-use link is opened (Redis when available, so every server
    process agrees; otherwise this process's memory)."""
    ttl = max(60, int(expires_at - _now().timestamp()) + 60)
    try:
        from src.core.cache import cache

        rc = cache.redis_client if cache else None
        if rc is not None:
            return bool(rc.set(f"embed_link_used:{token_id}", "1", nx=True, ex=ttl))
    except Exception:
        pass
    now = _now().timestamp()
    for key, until in list(_used_links.items()):
        if until < now:
            _used_links.pop(key, None)
    if token_id in _used_links:
        return False
    _used_links[token_id] = now + ttl
    return True


async def open_embed_session(
    token: str, *, parent_origin: str = "", required_scope: Optional[str] = None
) -> Dict[str, Any]:
    """Trade an embed link for the session its page uses from then on.

    * The site showing the embed (``parent_origin``, read by the page from the browser) must be
      one of the token's allowed sites. Browsers also enforce this through the page's
      frame-ancestors header, which is the check a site can't talk its way around.
    * A signed per-visitor link opens once; a second open (a copied URL, a proxy log) is refused.
    * The session keeps the link's expiry, filters and permissions, and never appears in a URL.
    """
    payload = decode_embed_token(token)
    if payload.get("ses"):
        raise JWTError("Open the embed link, not a session")
    record = await _active_record(payload)
    scopes = payload.get("scopes") or []
    if required_scope and required_scope not in scopes:
        raise JWTError(f"Missing required scope: {required_scope}")
    allowed = payload.get("allowed_domains") or []
    if allowed:
        own = [settings.FRONTEND_URL] if settings.FRONTEND_URL else []  # Aicser's own previews
        if not parent_origin:
            # Opened on its own rather than inside a page: nothing says which site it's on.
            raise EmbedOriginError("This embed only opens inside the website it was made for.")
        if not origin_allowed(parent_origin, allowed + own):
            raise EmbedOriginError("This embed can't be shown on this site.")
    exp = int(payload.get("exp") or 0)
    if payload.get("once") and not _claim_link(str(payload["jti"]), exp):
        raise JWTError("This embed link was already opened. Reload the page to get a new one.")
    session_payload = {k: v for k, v in payload.items() if k != "once"}
    session_payload.update({"ses": 1, "sid": str(uuid.uuid4()), "iat": int(_now().timestamp())})
    return {
        "token": sign_embed_token(session_payload),
        "expires_at": _iso(datetime.fromtimestamp(exp, tz=timezone.utc)) if exp else None,
        "scopes": scopes,
        "resource_id": payload.get("resource_id"),
        "org_id": payload.get("org_id"),
        "allowed_domains": allowed,
        "download": payload.get("download") or "none",
        "theme": record.get("theme"),
        "single_use": bool(payload.get("once")),
        # Aicser's own renders (PDF reports) use embed links too; they aren't audience views.
        "metered": record.get("kind") != "export",
    }
