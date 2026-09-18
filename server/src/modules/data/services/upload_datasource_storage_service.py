"""
Datasource upload object storage selector.

Community Edition stores uploaded datasource files in the local PostgreSQL
database. Enterprise Edition supports three backends selected via STORAGE_BACKEND:
  s3          — any S3-compatible provider (AWS, R2, Spaces, MinIO, Railway)
  azure_blob  — Azure Blob Storage
  postgresql  — PostgreSQL BYTEA (CE default; also the EE local/docker default)

When STORAGE_BACKEND is unset in EE, auto-detect in order:
  1. S3 credentials present → s3
  2. Azure account URL + container present → azure_blob
  3. otherwise → postgresql (works out of the box for local Docker)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import tempfile
import time
from typing import Optional

from src.core.edition import is_ee_enabled
from src.core.system_settings.runtime_config import get_effective_storage_config

logger = logging.getLogger(__name__)

_LOCAL_CACHE_LOCKS: dict[str, asyncio.Lock] = {}
_LOCAL_CACHE_DIR: Optional[str] = None


def _get_cache_dir() -> str:
    global _LOCAL_CACHE_DIR
    if _LOCAL_CACHE_DIR is None:
        candidates = [
            "/app/uploads/cache",
            os.path.join(tempfile.gettempdir(), "aiser_file_cache"),
        ]
        for c in candidates:
            try:
                os.makedirs(c, exist_ok=True)
                test_file = os.path.join(c, f".writable_test_{os.getpid()}")
                with open(test_file, "w") as f:
                    f.write("1")
                os.unlink(test_file)
                _LOCAL_CACHE_DIR = c
                break
            except Exception:
                continue
        if _LOCAL_CACHE_DIR is None:
            _LOCAL_CACHE_DIR = tempfile.gettempdir()
    return _LOCAL_CACHE_DIR

POSTGRES_OBJECT_PREFIX = "user_files/"
CE_OBJECT_PREFIX = "user_files/ce/"

# Env / credential names must never reach end users in API error text.
_INTERNAL_STORAGE_DETAIL_RE = re.compile(
    r"(?i)\b(?:AZURE_|S3_|STORAGE_BACKEND|environment variable|account[_ ]?key|"
    r"secret[_ ]?access|endpoint_url|bucket_name|AccountIsDisabled)\b"
)


def public_storage_error_message(exc: BaseException | str) -> str:
    """User-safe upload/storage failure text (no env var / credential leaks)."""
    raw = str(exc or "").strip()
    if not raw:
        return "File upload failed. Please try again."
    if _INTERNAL_STORAGE_DETAIL_RE.search(raw):
        return (
            "File storage is not configured on this server. "
            "Ask your admin to enable S3-compatible storage or local database storage, "
            "then try again."
        )
    # Keep short business-facing messages; drop nested exception noise.
    if "File upload failed:" in raw:
        raw = raw.split("File upload failed:", 1)[-1].strip()
    if len(raw) > 220:
        return "File upload failed. Please try again."
    return raw


def _get_backend() -> str:
    return os.getenv("STORAGE_BACKEND", "").lower().strip()


def _s3_credentials_present() -> bool:
    return bool(
        os.getenv("S3_ACCESS_KEY_ID", "").strip()
        and os.getenv("S3_SECRET_ACCESS_KEY", "").strip()
        and os.getenv("S3_BUCKET_NAME", "").strip()
    )


def _azure_credentials_present() -> bool:
    account_url = os.getenv("AZURE_STORAGE_ACCOUNT_URL", "").strip()
    if not account_url:
        account_name = (
            os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "").strip()
            or os.getenv("AZURE_STORAGE_ACCOUNT", "").strip()
        )
        if account_name:
            account_url = f"https://{account_name}.blob.core.windows.net"
    container = (
        os.getenv("AZURE_STORAGE_CONTAINER_NAME", "").strip()
        or os.getenv("AZURE_STORAGE_CONTAINER", "").strip()
    )
    return bool(account_url and container)


def detect_storage_backend() -> str:
    """Resolve EE storage backend from explicit env or available credentials."""
    if not is_ee_enabled():
        return "postgresql"
    backend = _get_backend()
    if backend == "s3":
        return "s3"
    if backend == "azure_blob":
        return "azure_blob"
    if backend == "postgresql":
        return "postgresql"
    if _s3_credentials_present():
        return "s3"
    if _azure_credentials_present():
        return "azure_blob"
    return "postgresql"


class UploadDatasourceStorageService:
    """Store and retrieve uploaded datasource payloads for the active edition."""

    @property
    def storage_type(self) -> str:
        return detect_storage_backend()

    def _use_postgres_for_key(self, object_key: str) -> bool:
        if object_key.startswith("s3://"):
            return False
        return not is_ee_enabled() or object_key.startswith(POSTGRES_OBJECT_PREFIX)

    def _storage_project_id(self, object_key: str, project_id: Optional[str]) -> Optional[str]:
        # CE upload keys are stored without a project_id. Some execution paths
        # pass user_id as a fallback scope, which would incorrectly filter out
        # the stored file row during retrieval.
        if object_key.startswith(CE_OBJECT_PREFIX):
            return None
        return project_id

    def _postgres_storage(self):
        from src.modules.data.services.postgres_storage_service import PostgresStorageService

        return PostgresStorageService()

    def _azure_storage(self):
        from ee.modules.data.services.azure_blob_storage_service import AzureBlobStorageService

        return AzureBlobStorageService()

    def _s3_storage(self, config: dict | None = None):
        from ee.modules.data.services.s3_storage_service import S3StorageService

        return S3StorageService(config=config)

    async def _resolved_backend(self) -> tuple[str, dict | None]:
        if not is_ee_enabled():
            return "postgresql", None
        try:
            config = await get_effective_storage_config()
            backend = str(config.get("backend") or "").lower().strip()
            if config.get("enabled") and backend in ("s3", "azure_blob", "postgresql"):
                # Admin/env may set STORAGE_BACKEND=s3 without credentials yet —
                # fall through to auto-detect so local docker still works.
                if backend == "s3" and not (
                    (config.get("access_key_id") and config.get("secret_access_key") and config.get("bucket_name"))
                    or _s3_credentials_present()
                ):
                    logger.warning(
                        "STORAGE_BACKEND=s3 configured but credentials missing; auto-detecting fallback"
                    )
                    return detect_storage_backend(), None
                if backend == "azure_blob" and not _azure_credentials_present():
                    logger.warning(
                        "STORAGE_BACKEND=azure_blob configured but credentials missing; auto-detecting fallback"
                    )
                    return detect_storage_backend(), None
                return backend, config if backend == "s3" else None
        except Exception:
            logger.exception("Failed to resolve runtime storage config; falling back to env")
        return detect_storage_backend(), None

    async def store_file(
        self,
        file_content: bytes,
        project_id: Optional[str],
        original_filename: str,
        content_type: str,
        source_id: str,
        organization_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> str:
        """Store uploaded datasource content and return its object key."""
        backend, storage_config = await self._resolved_backend()

        async def _store_postgres() -> str:
            logger.info("Using PostgreSQL local storage for datasource upload")
            return await self._postgres_storage().store_file(
                file_content=file_content,
                project_id=project_id,
                original_filename=original_filename,
                content_type=content_type,
            )

        if backend == "s3":
            try:
                logger.info("Using S3 storage for datasource upload")
                return await self._s3_storage(storage_config).store_file(
                    file_content=file_content,
                    project_id=project_id,
                    original_filename=original_filename,
                    content_type=content_type,
                    source_id=source_id,
                    organization_id=organization_id,
                    user_id=user_id,
                )
            except Exception as exc:
                logger.warning(
                    "S3 storage failed (%s); falling back to PostgreSQL",
                    public_storage_error_message(exc),
                    exc_info=True,
                )
                return await _store_postgres()

        if backend == "azure_blob":
            try:
                logger.info("Using Azure Blob Storage for datasource upload")
                return await self._azure_storage().store_file(
                    file_content=file_content,
                    project_id=project_id,
                    original_filename=original_filename,
                    content_type=content_type,
                    source_id=source_id,
                    organization_id=organization_id,
                    user_id=user_id,
                )
            except Exception as exc:
                # Common local-dev case: Azure env present but account disabled/unreachable.
                logger.warning(
                    "Azure blob storage failed (%s); falling back to PostgreSQL",
                    public_storage_error_message(exc),
                    exc_info=True,
                )
                return await _store_postgres()

        return await _store_postgres()

    async def get_file(self, object_key: str, project_id: Optional[str]) -> bytes:
        """Retrieve uploaded datasource content from the storage backend."""
        project_id = self._storage_project_id(object_key, project_id)
        # Legacy PostgreSQL keys always go to Postgres regardless of current backend
        if self._use_postgres_for_key(object_key):
            return await self._postgres_storage().get_file(object_key, project_id)

        backend, storage_config = await self._resolved_backend()

        if backend == "s3":
            return await self._s3_storage(storage_config).get_file(object_key, project_id)

        if backend == "postgresql":
            return await self._postgres_storage().get_file(object_key, project_id)

        return await self._azure_storage().get_file(object_key, project_id)

    async def get_local_file_path(
        self,
        object_key: str,
        project_id: Optional[str],
        suffix: str = "",
        max_age_seconds: int = 1800,
    ) -> str:
        """Retrieve file and cache on local disk, returning a persistent local file path.

        Concurrent requests for the same object_key share an asyncio lock so only
        a single download occurs across parallel queries.
        """
        cache_dir = _get_cache_dir()
        key_hash = hashlib.sha256(f"{project_id or ''}:{object_key}".encode()).hexdigest()
        clean_suffix = suffix if (suffix.startswith(".") or not suffix) else f".{suffix}"
        cache_path = os.path.join(cache_dir, f"{key_hash}{clean_suffix}")

        # 1. Fast path: check existing cache without locking
        if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
            try:
                mtime = os.path.getmtime(cache_path)
                if time.time() - mtime < max_age_seconds:
                    return cache_path
            except Exception:
                pass

        # 2. Synchronized fetch: only one concurrent task downloads the file
        if key_hash not in _LOCAL_CACHE_LOCKS:
            _LOCAL_CACHE_LOCKS[key_hash] = asyncio.Lock()
        lock = _LOCAL_CACHE_LOCKS[key_hash]

        async with lock:
            if os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
                try:
                    mtime = os.path.getmtime(cache_path)
                    if time.time() - mtime < max_age_seconds:
                        return cache_path
                except Exception:
                    pass

            content = await self.get_file(object_key, project_id)
            tmp_write = f"{cache_path}.tmp.{os.getpid()}_{time.time_ns()}"
            with open(tmp_write, "wb") as f:
                f.write(content)
            os.replace(tmp_write, cache_path)
            return cache_path

    async def delete_file(self, object_key: str, project_id: Optional[str]) -> bool:
        """Delete uploaded datasource content from the storage backend."""
        # Evict from local cache if present
        try:
            cache_dir = _get_cache_dir()
            key_hash = hashlib.sha256(f"{project_id or ''}:{object_key}".encode()).hexdigest()
            for fname in os.listdir(cache_dir):
                if fname.startswith(key_hash):
                    try:
                        os.unlink(os.path.join(cache_dir, fname))
                    except Exception:
                        pass
        except Exception:
            pass

        if object_key.startswith("s3://"):
            try:
                from src.modules.data.services.s3_storage_cleanup_service import delete_s3_file
                res = await delete_s3_file(object_key)
                return bool(res.get("success", True))
            except Exception as e:
                logger.warning("Failed direct S3 delete for %s: %s", object_key, e)
                return False

        project_id = self._storage_project_id(object_key, project_id)
        if self._use_postgres_for_key(object_key):
            return await self._postgres_storage().delete_file(object_key, project_id)

        backend, storage_config = await self._resolved_backend()

        if backend == "s3":
            return await self._s3_storage(storage_config).delete_file(object_key, project_id)

        if backend == "postgresql":
            return await self._postgres_storage().delete_file(object_key, project_id)

        return await self._azure_storage().delete_file(object_key, project_id)

