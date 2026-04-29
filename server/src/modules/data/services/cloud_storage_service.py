"""
Cloud Storage Service
Handles file uploads to S3, Azure Blob Storage, and local storage
"""

import logging
import os
import boto3
from azure.storage.blob import BlobServiceClient
from typing import Dict, Any, Optional
from datetime import datetime, timedelta
from src.core.config import settings

logger = logging.getLogger(__name__)


class CloudStorageService:
    """Service for handling cloud storage operations"""

    def __init__(self):
        self.provider = settings.CLOUD_STORAGE_PROVIDER
        self.enabled = settings.CLOUD_STORAGE_ENABLED

        # Initialize cloud storage clients
        if self.enabled and self.provider == "s3":
            self._init_s3_client()
        elif self.enabled and self.provider == "azure":
            self._init_azure_client()

    def _init_s3_client(self):
        """Initialize AWS S3 client"""
        try:
            self.s3_client = boto3.client(
                "s3",
                aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
                aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
                region_name=settings.AWS_REGION,
            )
            self.bucket_name = settings.S3_BUCKET_NAME
            logger.info(f"✅ S3 client initialized for bucket: {self.bucket_name}")
        except Exception as e:
            logger.error(f"❌ Failed to initialize S3 client: {str(e)}")
            self.enabled = False

    def _init_azure_client(self):
        """Initialize Azure Blob Storage client"""
        try:
            if settings.AZURE_STORAGE_CONNECTION_STRING:
                self.blob_service_client = BlobServiceClient.from_connection_string(
                    settings.AZURE_STORAGE_CONNECTION_STRING
                )
            else:
                account_url = f"https://{settings.AZURE_STORAGE_ACCOUNT_NAME}.{settings.AZURE_STORAGE_ENDPOINT_SUFFIX}"
                self.blob_service_client = BlobServiceClient(
                    account_url=account_url,
                    credential=settings.AZURE_STORAGE_ACCOUNT_KEY,
                )

            self.container_name = settings.AZURE_STORAGE_CONTAINER_NAME
            logger.info(
                f"✅ Azure Blob Storage client initialized for container: {self.container_name}"
            )
        except Exception as e:
            logger.error(f"❌ Failed to initialize Azure client: {str(e)}")
            self.enabled = False

    async def upload_file(
        self,
        file_content: bytes,
        filename: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Upload file to cloud storage"""
        try:
            if not self.enabled:
                return await self._upload_local(file_content, filename, metadata)

            if self.provider == "s3":
                return await self._upload_to_s3(file_content, filename, metadata)
            elif self.provider == "azure":
                return await self._upload_to_azure(file_content, filename, metadata)
            else:
                return await self._upload_local(file_content, filename, metadata)

        except Exception as e:
            logger.error(f"❌ File upload failed: {str(e)}")
            return {"success": False, "error": str(e), "fallback_to_local": True}

    async def _upload_to_s3(
        self,
        file_content: bytes,
        filename: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Upload file to S3"""
        try:
            # Generate unique key
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            key = f"uploads/{timestamp}_{filename}"

            # Prepare metadata
            s3_metadata = {
                "original_filename": filename,
                "upload_timestamp": timestamp,
                "content_type": self._get_content_type(filename),
                "file_size": str(len(file_content)),
            }

            if metadata:
                s3_metadata.update(metadata)

            # Upload to S3
            self.s3_client.put_object(
                Bucket=self.bucket_name,
                Key=key,
                Body=file_content,
                Metadata=s3_metadata,
                ContentType=self._get_content_type(filename),
            )

            # Generate URL
            url = f"https://{self.bucket_name}.s3.{settings.AWS_REGION}.amazonaws.com/{key}"

            logger.info(f"✅ File uploaded to S3: {key}")

            return {
                "success": True,
                "url": url,
                "key": key,
                "bucket": self.bucket_name,
                "provider": "s3",
                "metadata": s3_metadata,
            }

        except Exception as e:
            logger.error(f"❌ S3 upload failed: {str(e)}")
            raise

    async def _upload_to_azure(
        self,
        file_content: bytes,
        filename: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Upload file to Azure Blob Storage"""
        try:
            # Generate unique blob name
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            blob_name = f"uploads/{timestamp}_{filename}"

            # Get blob client
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name, blob=blob_name
            )

            # Prepare metadata
            blob_metadata = {
                "original_filename": filename,
                "upload_timestamp": timestamp,
                "content_type": self._get_content_type(filename),
                "file_size": str(len(file_content)),
            }

            if metadata:
                blob_metadata.update(metadata)

            # Upload to Azure
            blob_client.upload_blob(
                file_content,
                metadata=blob_metadata,
                content_settings=self._get_content_settings(filename),
                overwrite=True,
            )

            # Generate URL
            url = blob_client.url

            logger.info(f"✅ File uploaded to Azure: {blob_name}")

            return {
                "success": True,
                "url": url,
                "blob_name": blob_name,
                "container": self.container_name,
                "provider": "azure",
                "metadata": blob_metadata,
            }

        except Exception as e:
            logger.error(f"❌ Azure upload failed: {str(e)}")
            raise

    async def _upload_local(
        self,
        file_content: bytes,
        filename: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Upload file to local storage (fallback)"""
        try:
            # Ensure upload directory exists
            upload_dir = settings.UPLOAD_DIR
            os.makedirs(upload_dir, exist_ok=True)

            # Generate unique filename
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            unique_filename = f"{timestamp}_{filename}"
            file_path = os.path.join(upload_dir, unique_filename)

            # Save file
            with open(file_path, "wb") as f:
                f.write(file_content)

            logger.info(f"✅ File uploaded locally: {file_path}")

            return {
                "success": True,
                "file_path": file_path,
                "filename": unique_filename,
                "provider": "local",
                "size": len(file_content),
            }

        except Exception as e:
            logger.error(f"❌ Local upload failed: {str(e)}")
            raise

    async def delete_file(self, file_identifier: str) -> Dict[str, Any]:
        """Delete file from cloud storage"""
        try:
            if not self.enabled:
                return await self._delete_local(file_identifier)

            if self.provider == "s3":
                return await self._delete_from_s3(file_identifier)
            elif self.provider == "azure":
                return await self._delete_from_azure(file_identifier)
            else:
                return await self._delete_local(file_identifier)

        except Exception as e:
            logger.error(f"❌ File deletion failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def _delete_from_s3(self, key: str) -> Dict[str, Any]:
        """Delete file from S3"""
        try:
            self.s3_client.delete_object(Bucket=self.bucket_name, Key=key)
            logger.info(f"✅ File deleted from S3: {key}")
            return {"success": True, "provider": "s3"}
        except Exception as e:
            logger.error(f"❌ S3 deletion failed: {str(e)}")
            raise

    async def _delete_from_azure(self, blob_name: str) -> Dict[str, Any]:
        """Delete file from Azure Blob Storage"""
        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name, blob=blob_name
            )
            blob_client.delete_blob()
            logger.info(f"✅ File deleted from Azure: {blob_name}")
            return {"success": True, "provider": "azure"}
        except Exception as e:
            logger.error(f"❌ Azure deletion failed: {str(e)}")
            raise

    async def _delete_local(self, file_path: str) -> Dict[str, Any]:
        """Delete file from local storage"""
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"✅ File deleted locally: {file_path}")
                return {"success": True, "provider": "local"}
            else:
                return {"success": False, "error": "File not found"}
        except Exception as e:
            logger.error(f"❌ Local deletion failed: {str(e)}")
            raise

    def _get_content_type(self, filename: str) -> str:
        """Get content type based on file extension"""
        ext = filename.lower().split(".")[-1]
        content_types = {
            "csv": "text/csv",
            "json": "application/json",
            "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "xls": "application/vnd.ms-excel",
            "parquet": "application/octet-stream",
            "txt": "text/plain",
        }
        return content_types.get(ext, "application/octet-stream")

    def _get_content_settings(self, filename: str):
        """Get Azure content settings"""
        from azure.storage.blob import ContentSettings

        content_type = self._get_content_type(filename)
        return ContentSettings(content_type=content_type)

    async def get_file_url(self, file_identifier: str) -> str:
        """Get public URL for file"""
        try:
            if not self.enabled:
                return f"/uploads/{file_identifier}"

            if self.provider == "s3":
                return f"https://{self.bucket_name}.s3.{settings.AWS_REGION}.amazonaws.com/{file_identifier}"
            elif self.provider == "azure":
                return f"https://{settings.AZURE_STORAGE_ACCOUNT_NAME}.{settings.AZURE_STORAGE_ENDPOINT_SUFFIX}/{self.container_name}/{file_identifier}"
            else:
                return f"/uploads/{file_identifier}"

        except Exception as e:
            logger.error(f"❌ Failed to get file URL: {str(e)}")
            return f"/uploads/{file_identifier}"

    async def cleanup_old_files(self, days: int = None) -> Dict[str, Any]:
        """Clean up old files based on retention policy"""
        try:
            if not self.enabled:
                return {"success": True, "message": "Cloud storage not enabled"}

            retention_days = days or settings.CLOUD_STORAGE_RETENTION_DAYS
            cutoff_date = datetime.now() - timedelta(days=retention_days)

            if self.provider == "s3":
                return await self._cleanup_s3_old_files(cutoff_date)
            elif self.provider == "azure":
                return await self._cleanup_azure_old_files(cutoff_date)
            else:
                return {
                    "success": True,
                    "message": "No cleanup needed for local storage",
                }

        except Exception as e:
            logger.error(f"❌ Cleanup failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def _cleanup_s3_old_files(self, cutoff_date: datetime) -> Dict[str, Any]:
        """Clean up old files from S3"""
        try:
            # List objects in bucket
            response = self.s3_client.list_objects_v2(Bucket=self.bucket_name)

            deleted_count = 0
            for obj in response.get("Contents", []):
                if obj["LastModified"].replace(tzinfo=None) < cutoff_date:
                    self.s3_client.delete_object(
                        Bucket=self.bucket_name, Key=obj["Key"]
                    )
                    deleted_count += 1

            logger.info(f"✅ Cleaned up {deleted_count} old files from S3")
            return {"success": True, "deleted_count": deleted_count, "provider": "s3"}

        except Exception as e:
            logger.error(f"❌ S3 cleanup failed: {str(e)}")
            raise

    async def _cleanup_azure_old_files(self, cutoff_date: datetime) -> Dict[str, Any]:
        """Clean up old files from Azure Blob Storage"""
        try:
            container_client = self.blob_service_client.get_container_client(
                self.container_name
            )

            deleted_count = 0
            for blob in container_client.list_blobs():
                if blob.last_modified.replace(tzinfo=None) < cutoff_date:
                    container_client.delete_blob(blob.name)
                    deleted_count += 1

            logger.info(f"✅ Cleaned up {deleted_count} old files from Azure")
            return {
                "success": True,
                "deleted_count": deleted_count,
                "provider": "azure",
            }

        except Exception as e:
            logger.error(f"❌ Azure cleanup failed: {str(e)}")
            raise


# Global instance
cloud_storage_service = CloudStorageService()
