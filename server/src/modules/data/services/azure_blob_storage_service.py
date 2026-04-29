"""
Azure Blob Storage-based object storage service
Stores file binary data in Azure Blob Storage
"""

import asyncio
import logging
import os
import uuid
from typing import Optional
from azure.identity import DefaultAzureCredential
from azure.storage.blob import BlobServiceClient
from azure.core.exceptions import ResourceNotFoundError, AzureError

logger = logging.getLogger(__name__)


class AzureBlobStorageService:
    """Azure Blob Storage-based object storage service"""
    
    def __init__(self):
        """Initialize Azure Blob Storage client"""
        account_url = os.getenv("AZURE_STORAGE_ACCOUNT_URL", "")
        if not account_url:
            raise ValueError("AZURE_STORAGE_ACCOUNT_URL environment variable is required")
        
        container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "")
        if not container_name:
            raise ValueError("AZURE_STORAGE_CONTAINER_NAME environment variable is required")
        
        self.container_name = container_name
        token_credential = DefaultAzureCredential()
        
        self.blob_service_client = BlobServiceClient(
            account_url=account_url,
            credential=token_credential
        )
        
        # Ensure container exists (idempotent) - run sync initialization
        self._ensure_container_exists()
    
    def _ensure_container_exists(self):
        """Ensure the container exists, create if it doesn't"""
        try:
            container_client = self.blob_service_client.get_container_client(self.container_name)
            if not container_client.exists():
                container_client.create_container()
                logger.info(f"✅ Created Azure Blob Storage container: {self.container_name}")
            else:
                logger.debug(f"Container {self.container_name} already exists")
        except AzureError as e:
            logger.error(f"❌ Failed to ensure container exists: {str(e)}")
            raise
    
    def generate_object_key(
        self,
        project_id: str,
        filename: str,
        source_id: str,
        organization_id: Optional[str] = None,
    ) -> str:
        """Generate object key following the canonical path hierarchy."""
        if organization_id:
            return f"orgs/{organization_id}/projects/{project_id}/data-sources/{source_id}/compressed/{filename}"
        return f"projects/{project_id}/data-sources/{source_id}/compressed/{filename}"

    
    async def store_file(
        self,
        file_content: bytes,
        project_id: str,
        original_filename: str,
        content_type: str,
        source_id: str,
        organization_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> str:
        """Store file in Azure Blob Storage and return object_key"""
        object_key = self.generate_object_key(project_id, original_filename, source_id, organization_id)

        
        try:
            # Run sync operations in thread pool to avoid blocking
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=object_key
            )
            
            # Check if blob already exists (shouldn't happen with unique source_id, but be safe)
            exists = await asyncio.to_thread(blob_client.exists)
            if exists:
                logger.warning(f"⚠️ Blob already exists at {object_key}, generating new source_id")
                new_source_id = str(uuid.uuid4())
                object_key = self.generate_object_key(project_id, original_filename, new_source_id, organization_id)
                blob_client = self.blob_service_client.get_blob_client(
                    container=self.container_name,
                    blob=object_key
                )
            
            # Upload blob with metadata
            # Use a lambda to properly pass keyword arguments
            def _upload():
                from azure.storage.blob import ContentSettings
                return blob_client.upload_blob(
                    data=file_content,
                    content_settings=ContentSettings(content_type=content_type),
                    metadata={
                        "original_filename": original_filename,
                        "project_id": project_id,
                        "organization_id": organization_id or "",
                        "source_id": source_id,
                        "user_id": user_id or "",
                    },

                    overwrite=False
                )
            
            await asyncio.to_thread(_upload)
            
            logger.info(f"✅ Stored file in Azure Blob Storage: {object_key} ({len(file_content)} bytes)")
            return object_key
            
        except AzureError as e:
            logger.error(f"❌ Failed to store file in Azure Blob Storage: {str(e)}")
            raise
    
    async def get_file(self, object_key: str, project_id: str) -> bytes:
        """Retrieve file from Azure Blob Storage
        
        Note: project_id is passed for consistency with the interface, but ownership
        verification should be done at the application layer using data_sources.project_id
        """

        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=object_key
            )
            
            # Check existence and download in thread pool
            exists = await asyncio.to_thread(blob_client.exists)
            if not exists:
                raise ValueError(f"File not found: {object_key}")
            
            # Download blob content
            def _download():
                blob_data = blob_client.download_blob()
                return blob_data.readall()
            
            file_content = await asyncio.to_thread(_download)
            
            logger.info(f"✅ Retrieved file from Azure Blob Storage: {object_key}")
            return file_content
            
        except ResourceNotFoundError:
            logger.error(f"❌ Blob not found: {object_key}")
            raise ValueError(f"File not found: {object_key}")
        except AzureError as e:
            logger.error(f"❌ Failed to retrieve file from Azure Blob Storage: {str(e)}")
            raise
    
    async def delete_file(self, object_key: str, project_id: str) -> bool:
        """Delete file from Azure Blob Storage (hard delete)
        
        Note: Soft-delete semantics should be implemented at the application layer
        (e.g., mark data source inactive). This performs a hard delete of the blob.
        """

        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=object_key
            )
            
            exists = await asyncio.to_thread(blob_client.exists)
            if not exists:
                logger.warning(f"⚠️ File not found for deletion: {object_key}")
                return False
            
            # Delete blob
            def _delete():
                return blob_client.delete_blob()
            await asyncio.to_thread(_delete)
            
            logger.warning(f"✅ Deleted file from Azure Blob Storage: {object_key}")
            return True
            
        except ResourceNotFoundError:
            logger.warning(f"⚠️ File not found for deletion: {object_key}")
            return False
        except AzureError as e:
            logger.error(f"❌ Failed to delete file from Azure Blob Storage: {str(e)}")
            raise
