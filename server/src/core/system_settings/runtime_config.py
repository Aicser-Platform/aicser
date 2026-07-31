"""Resolve runtime config from admin settings with environment fallbacks."""

from __future__ import annotations

import asyncio
import json
import os
import smtplib
import ssl
import urllib.request
from typing import Any

import boto3
from botocore.config import Config

from src.modules.data.utils.credentials import decrypt_credentials, encrypt_credentials
from src.core.system_settings.repository import SystemSettingRepository

EMAIL_SETTING_KEY = "runtime.email"
STORAGE_SETTING_KEY = "runtime.storage"
MASKED_SECRET_PREFIX = "••••"

_repo = SystemSettingRepository()


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "").strip().lower()
    if not value:
        return default
    return value in ("1", "true", "yes", "on")


def _mask_secret(value: Any) -> str:
    raw = str(value or "")
    if not raw:
        return ""
    suffix = raw[-4:] if len(raw) >= 4 else raw
    return f"{MASKED_SECRET_PREFIX}{suffix}"


def _strip_empty(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value not in (None, "")}


async def _get_admin_setting(key: str) -> dict[str, Any] | None:
    row = await _repo.get_setting(key)
    if not row or not isinstance(row.value, dict):
        return None
    return decrypt_credentials(row.value)


def _email_from_env() -> dict[str, Any]:
    provider = os.getenv("EMAIL_PROVIDER", "").strip().lower()
    smtp_from = os.getenv("SMTP_FROM", "").strip() or os.getenv("SMTP_SENDER", "").strip()
    smtp = {
        "provider": "smtp",
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "587") or "587"),
        "username": os.getenv("SMTP_USER", "").strip() or os.getenv("SMTP_USERNAME", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", "").strip(),
        "from": smtp_from,
        "use_tls": _env_bool("SMTP_USE_TLS", True),
        "use_ssl": _env_bool("SMTP_USE_SSL", (os.getenv("SMTP_PORT", "") or "") == "465"),
    }
    resend = {
        "provider": "resend",
        "api_key": os.getenv("RESEND_API_KEY", "").strip(),
        "from": os.getenv("RESEND_FROM", "").strip(),
    }
    if provider == "resend":
        config = resend
    elif provider == "smtp":
        config = smtp
    elif smtp["host"] and smtp["from"]:
        config = smtp
    elif resend["api_key"] and resend["from"]:
        config = resend
    else:
        return {"enabled": False, "configured": False, "source": "none", "provider": provider or "disabled"}

    configured = _email_configured(config)
    return {"enabled": configured, "configured": configured, "source": "env", **config}


def _storage_from_env() -> dict[str, Any]:
    backend = os.getenv("STORAGE_BACKEND", "").strip().lower()
    if not backend:
        return {"enabled": False, "configured": False, "source": "none", "backend": "disabled"}
    config = {
        "enabled": True,
        "source": "env",
        "backend": backend,
        "provider": os.getenv("S3_PROVIDER", "aws").strip() or "aws",
        "endpoint_url": os.getenv("S3_ENDPOINT_URL", "").strip(),
        "access_key_id": os.getenv("S3_ACCESS_KEY_ID", "").strip(),
        "secret_access_key": os.getenv("S3_SECRET_ACCESS_KEY", "").strip(),
        "bucket_name": os.getenv("S3_BUCKET_NAME", "").strip(),
        "region": os.getenv("S3_REGION", "us-east-1").strip() or "us-east-1",
    }
    configured = _storage_configured(config)
    return {**config, "configured": configured, "enabled": configured}


def _email_configured(config: dict[str, Any]) -> bool:
    provider = str(config.get("provider") or "").lower()
    if provider == "smtp":
        return bool(config.get("host") and config.get("from"))
    if provider == "resend":
        return bool(config.get("api_key") and config.get("from"))
    return False


def _storage_configured(config: dict[str, Any]) -> bool:
    backend = str(config.get("backend") or "").lower()
    if backend == "s3":
        return bool(
            config.get("access_key_id")
            and config.get("secret_access_key")
            and config.get("bucket_name")
        )
    if backend in ("azure_blob", "postgresql"):
        return True
    return False


async def get_effective_email_config() -> dict[str, Any]:
    admin = await _get_admin_setting(EMAIL_SETTING_KEY)
    if admin is not None:
        if admin.get("enabled") is False:
            return {"enabled": False, "configured": False, "source": "admin", "provider": admin.get("provider") or "disabled"}
        configured = _email_configured(admin)
        return {"source": "admin", **admin, "enabled": configured, "configured": configured}
    return _email_from_env()


async def get_effective_storage_config() -> dict[str, Any]:
    admin = await _get_admin_setting(STORAGE_SETTING_KEY)
    if admin is not None:
        if admin.get("enabled") is False:
            return {"enabled": False, "configured": False, "source": "admin", "backend": admin.get("backend") or "disabled"}
        configured = _storage_configured(admin)
        return {"source": "admin", **admin, "enabled": configured, "configured": configured}
    return _storage_from_env()


def public_email_status(config: dict[str, Any]) -> dict[str, Any]:
    provider = str(config.get("provider") or "disabled").lower()
    public = {
        "source": config.get("source") or "none",
        "provider": provider,
        "enabled": bool(config.get("enabled")),
        "configured": bool(config.get("configured")),
    }
    if provider == "smtp":
        public.update(
            {
                "host": config.get("host") or "",
                "port": config.get("port") or 587,
                "username": config.get("username") or "",
                "password_configured": bool(config.get("password")),
                "from": config.get("from") or "",
                "use_tls": bool(config.get("use_tls", True)),
                "use_ssl": bool(config.get("use_ssl", False)),
            }
        )
    elif provider == "resend":
        public.update(
            {
                "api_key_configured": bool(config.get("api_key")),
                "from": config.get("from") or "",
            }
        )
    return public


def public_storage_status(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "source": config.get("source") or "none",
        "backend": config.get("backend") or "disabled",
        "provider": config.get("provider") or "",
        "enabled": bool(config.get("enabled")),
        "configured": bool(config.get("configured")),
        "endpoint_url": config.get("endpoint_url") or "",
        "access_key_configured": bool(config.get("access_key_id")),
        "secret_key_configured": bool(config.get("secret_access_key")),
        "bucket_name": config.get("bucket_name") or "",
        "region": config.get("region") or "us-east-1",
    }


async def get_runtime_config_status() -> dict[str, Any]:
    email = await get_effective_email_config()
    storage = await get_effective_storage_config()
    return {
        "email": public_email_status(email),
        "storage": public_storage_status(storage),
    }


async def save_email_config(payload: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    existing = await _get_admin_setting(EMAIL_SETTING_KEY) or {}
    fallback = existing or _email_from_env()
    provider = str(payload.get("provider") or existing.get("provider") or "smtp").strip().lower()
    enabled = bool(payload.get("enabled", True))

    if provider == "resend":
        api_key = str(payload.get("api_key") or "").strip()
        if api_key.startswith(MASKED_SECRET_PREFIX):
            api_key = str(fallback.get("api_key") or "")
        config = _strip_empty(
            {
                "enabled": enabled,
                "provider": "resend",
                "api_key": api_key,
                "from": str(payload.get("from") or "").strip(),
            }
        )
    else:
        password = str(payload.get("password") or "").strip()
        if password.startswith(MASKED_SECRET_PREFIX):
            password = str(fallback.get("password") or "")
        config = _strip_empty(
            {
                "enabled": enabled,
                "provider": "smtp",
                "host": str(payload.get("host") or "").strip(),
                "port": int(payload.get("port") or 587),
                "username": str(payload.get("username") or "").strip(),
                "password": password,
                "from": str(payload.get("from") or "").strip(),
                "use_tls": bool(payload.get("use_tls", True)),
                "use_ssl": bool(payload.get("use_ssl", False)),
            }
        )

    await _repo.set_setting(
        EMAIL_SETTING_KEY,
        encrypt_credentials(config),
        description="Runtime transactional email provider",
        updated_by_user_id=user_id,
    )
    saved = await get_effective_email_config()
    return public_email_status(saved)


async def save_storage_config(payload: dict[str, Any], user_id: str | None = None) -> dict[str, Any]:
    existing = await _get_admin_setting(STORAGE_SETTING_KEY) or {}
    fallback = existing or _storage_from_env()
    backend = str(payload.get("backend") or existing.get("backend") or "s3").strip().lower()
    enabled = bool(payload.get("enabled", True))

    secret = str(payload.get("secret_access_key") or "").strip()
    if secret.startswith(MASKED_SECRET_PREFIX):
        secret = str(fallback.get("secret_access_key") or "")
    access_key = str(payload.get("access_key_id") or "").strip()
    if access_key.startswith(MASKED_SECRET_PREFIX):
        access_key = str(fallback.get("access_key_id") or "")

    config = _strip_empty(
        {
            "enabled": enabled,
            "backend": backend,
            "provider": str(payload.get("provider") or "aws").strip() or "aws",
            "endpoint_url": str(payload.get("endpoint_url") or "").strip(),
            "access_key_id": access_key,
            "secret_access_key": secret,
            "bucket_name": str(payload.get("bucket_name") or "").strip(),
            "region": str(payload.get("region") or "us-east-1").strip() or "us-east-1",
        }
    )
    await _repo.set_setting(
        STORAGE_SETTING_KEY,
        encrypt_credentials(config),
        description="Runtime object storage provider",
        updated_by_user_id=user_id,
    )
    saved = await get_effective_storage_config()
    return public_storage_status(saved)


async def test_email_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    resolved = config or await get_effective_email_config()
    if not resolved.get("enabled") or not _email_configured(resolved):
        return {"success": False, "message": "Email provider is not configured"}

    provider = str(resolved.get("provider") or "").lower()
    if provider == "resend":
        def _test_resend() -> None:
            req = urllib.request.Request(
                "https://api.resend.com/domains",
                headers={"Authorization": f"Bearer {resolved.get('api_key')}"},
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=15) as response:
                if response.status >= 400:
                    raise RuntimeError(f"Resend returned HTTP {response.status}")

        await asyncio.to_thread(_test_resend)
        return {"success": True, "message": "Resend API key is valid"}

    def _test_smtp() -> None:
        host = str(resolved.get("host") or "")
        port = int(resolved.get("port") or 587)
        username = str(resolved.get("username") or "")
        password = str(resolved.get("password") or "")
        use_ssl = bool(resolved.get("use_ssl", False))
        use_tls = bool(resolved.get("use_tls", True))
        context = ssl.create_default_context()
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=15, context=context) as server:
                if username and password:
                    server.login(username, password)
        else:
            with smtplib.SMTP(host, port, timeout=15) as server:
                server.ehlo()
                if use_tls:
                    server.starttls(context=context)
                    server.ehlo()
                if username and password:
                    server.login(username, password)

    await asyncio.to_thread(_test_smtp)
    return {"success": True, "message": "SMTP connection is valid"}


async def test_storage_config(config: dict[str, Any] | None = None) -> dict[str, Any]:
    resolved = config or await get_effective_storage_config()
    if not resolved.get("enabled") or not _storage_configured(resolved):
        return {"success": False, "message": "Storage provider is not configured"}
    if str(resolved.get("backend") or "").lower() != "s3":
        return {"success": True, "message": "Storage backend is configured"}

    def _test_s3() -> None:
        endpoint_url = resolved.get("endpoint_url") or None
        addressing_style = "path" if endpoint_url else "virtual"
        client = boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=resolved.get("access_key_id"),
            aws_secret_access_key=resolved.get("secret_access_key"),
            region_name=resolved.get("region") or "us-east-1",
            config=Config(s3={"addressing_style": addressing_style}),
        )
        client.head_bucket(Bucket=resolved.get("bucket_name"))

    await asyncio.to_thread(_test_s3)
    return {"success": True, "message": "S3 bucket is reachable"}
