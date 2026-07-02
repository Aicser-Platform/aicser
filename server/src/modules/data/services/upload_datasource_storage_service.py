"""
Datasource upload object storage selector.

Community Edition stores uploaded datasource files in the local PostgreSQL
database. Enterprise Edition supports three backends selected via STORAGE_BACKEND:
  s3          — any S3-compatible provider (AWS, R2, Spaces, MinIO, Railway)
  azure_blob  — Azure Blob Storage (default EE behaviour when STORAGE_BACKEND is unset)
  postgresql  — PostgreSQL BYTEA (CE default, also available in EE)

When STORAGE_BACKEND is unset in EE, the service auto-detects: tries Azure
credentials first, then falls back to PostgreSQL (backward-compatible).
"""

import logging
import os
from typing import Optional

from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)

POSTGRES_OBJECT_PREFIX = "user_files/"
CE_OBJECT_PREFIX = "user_files/ce/"


def _get_backend() -> str:
    return os.getenv("STORAGE_BACKEND", "").lower().strip()


class UploadDatasourceStorageService:
    """Store and retrieve uploaded datasource payloads for the active edition."""

    @property
    def storage_type(self) -> str:
        if not is_ee_enabled():
            return "postgresql"
        backend = _get_backend()
        if backend == "s3":
            return "s3"
        if backend == "azure_blob":
            return "azure_blob"
        if backend == "postgresql":
            return "postgresql"
        # Auto-detect: default to azure_blob for backward-compatibility (EE default)
        return "azure_blob"

    def _use_postgres_for_key(self, object_key: str) -> bool:
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

    def _s3_storage(self):
        from ee.modules.data.services.s3_storage_service import S3StorageService

        return S3StorageService()

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
        backend = self.storage_type

        if backend == "s3":
            logger.info("Using S3 storage for datasource upload")
            return await self._s3_storage().store_file(
                file_content=file_content,
                project_id=project_id,
                original_filename=original_filename,
                content_type=content_type,
                source_id=source_id,
                organization_id=organization_id,
                user_id=user_id,
            )

        if backend == "azure_blob":
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

        logger.info("Using PostgreSQL local storage for datasource upload")
        return await self._postgres_storage().store_file(
            file_content=file_content,
            project_id=project_id,
            original_filename=original_filename,
            content_type=content_type,
        )

    async def get_file(self, object_key: str, project_id: Optional[str]) -> bytes:
        """Retrieve uploaded datasource content from the storage backend."""
        project_id = self._storage_project_id(object_key, project_id)
        # Legacy PostgreSQL keys always go to Postgres regardless of current backend
        if self._use_postgres_for_key(object_key):
            return await self._postgres_storage().get_file(object_key, project_id)

        backend = self.storage_type

        if backend == "s3":
            return await self._s3_storage().get_file(object_key, project_id)

        if backend == "postgresql":
            return await self._postgres_storage().get_file(object_key, project_id)

        return await self._azure_storage().get_file(object_key, project_id)

    async def delete_file(self, object_key: str, project_id: Optional[str]) -> bool:
        """Delete uploaded datasource content from the storage backend."""
        project_id = self._storage_project_id(object_key, project_id)
        if self._use_postgres_for_key(object_key):
            return await self._postgres_storage().delete_file(object_key, project_id)

        backend = self.storage_type

        if backend == "s3":
            return await self._s3_storage().delete_file(object_key, project_id)

        if backend == "postgresql":
            return await self._postgres_storage().delete_file(object_key, project_id)

        return await self._azure_storage().delete_file(object_key, project_id)
