"""
Datasource upload object storage selector.

Community Edition stores uploaded datasource files in the local PostgreSQL
database. Enterprise Edition keeps using Azure Blob Storage.
"""

import logging
from typing import Optional

from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)


POSTGRES_OBJECT_PREFIX = "user_files/"


class UploadDatasourceStorageService:
    """Store and retrieve uploaded datasource payloads for the active edition."""

    @property
    def storage_type(self) -> str:
        return "azure_blob" if is_ee_enabled() else "postgresql"

    def _use_postgres_for_key(self, object_key: str) -> bool:
        return not is_ee_enabled() or object_key.startswith(POSTGRES_OBJECT_PREFIX)

    def _postgres_storage(self):
        from src.modules.data.services.postgres_storage_service import PostgresStorageService

        return PostgresStorageService()

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
        if is_ee_enabled():
            from ee.modules.data.services.azure_blob_storage_service import AzureBlobStorageService

            logger.info("Using Azure Blob Storage for datasource upload")
            return await AzureBlobStorageService().store_file(
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
        if self._use_postgres_for_key(object_key):
            return await self._postgres_storage().get_file(object_key, project_id)

        from ee.modules.data.services.azure_blob_storage_service import AzureBlobStorageService

        return await AzureBlobStorageService().get_file(object_key, project_id)

    async def delete_file(self, object_key: str, project_id: Optional[str]) -> bool:
        """Delete uploaded datasource content from the storage backend."""
        if self._use_postgres_for_key(object_key):
            return await self._postgres_storage().delete_file(object_key, project_id)

        from ee.modules.data.services.azure_blob_storage_service import AzureBlobStorageService

        return await AzureBlobStorageService().delete_file(object_key, project_id)
