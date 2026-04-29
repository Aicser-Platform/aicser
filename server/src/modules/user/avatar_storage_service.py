"""
Azure Blob Storage service for user profile avatar uploads.
Stores images under  avatars/<user_id>/<uuid>.<ext>
"""

import asyncio
import io
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

from PIL import Image

from azure.identity import DefaultAzureCredential
from azure.storage.blob import (
    BlobServiceClient,
    BlobSasPermissions,
    ContentSettings,
    generate_blob_sas,
)
from azure.core.exceptions import ResourceNotFoundError, AzureError

logger = logging.getLogger(__name__)


def generate_avatar_sas_url(avatar_url: str, expiry_hours: int = 1) -> str:
    """
    Return a time-limited SAS URL for a private avatar blob.

    Pure crypto operation — reads env vars directly and does NOT open any
    network connection to Azure Storage.  Safe to call even in environments
    where DefaultAzureCredential is not configured.

    Returns the original URL unchanged if any required env var is missing.
    """
    account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY", "")
    container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "")
    account_url = os.getenv("AZURE_STORAGE_ACCOUNT_URL", "").rstrip("/")

    # Derive account name from env var or parse it from the account URL.
    # URL format: https://<account_name>.blob.core.windows.net
    account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "")
    if not account_name and account_url:
        try:
            host = account_url.split("//", 1)[1].split("/")[0]  # e.g. aicserstaging.blob.core.windows.net
            account_name = host.split(".")[0]
        except (IndexError, AttributeError):
            pass

    if not all([account_name, account_key, container_name, account_url]):
        logger.warning("SAS generation skipped: one or more Azure storage env vars are missing")
        return avatar_url

    prefix = f"{account_url}/{container_name}/"
    if not avatar_url.startswith(prefix):
        logger.warning(f"SAS generation skipped: URL does not match expected prefix '{prefix}'")
        return avatar_url

    blob_name = avatar_url[len(prefix):]
    expiry = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
    sas_token = generate_blob_sas(
        account_name=account_name,
        container_name=container_name,
        blob_name=blob_name,
        account_key=account_key,
        permission=BlobSasPermissions(read=True),
        expiry=expiry,
    )
    return f"{account_url}/{container_name}/{blob_name}?{sas_token}"


ALLOWED_CONTENT_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
}


MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB
AVATAR_MAX_DIMENSION = 256              # px — longest side capped at this
AVATAR_WEBP_QUALITY = 85               # 0-100; 85 is a good size/quality balance


class AvatarStorageService:
    """Azure Blob Storage service for profile avatar images."""

    def __init__(self) -> None:
        account_url = os.getenv("AZURE_STORAGE_ACCOUNT_URL", "")
        if not account_url:
            raise ValueError("AZURE_STORAGE_ACCOUNT_URL environment variable is required")

        container_name = os.getenv("AZURE_STORAGE_CONTAINER_NAME", "")
        if not container_name:
            raise ValueError("AZURE_STORAGE_CONTAINER_NAME environment variable is required")

        self.account_url = account_url.rstrip("/")
        self.container_name = container_name
        self.account_name = os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "")
        self.account_key = os.getenv("AZURE_STORAGE_ACCOUNT_KEY", "")

        self.blob_service_client = BlobServiceClient(
            account_url=account_url,
            credential=DefaultAzureCredential(),
        )
        self._ensure_container_exists()

    # ── internal helpers ─────────────────────────────────────────────────────

    def _ensure_container_exists(self) -> None:
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

    def _compress_to_webp(self, file_content: bytes) -> bytes:
        """Resize to AVATAR_MAX_DIMENSION and convert to WebP."""
        with Image.open(io.BytesIO(file_content)) as img:
            # Palette mode → RGBA to preserve transparency; everything else → RGB
            if img.mode == "P":
                img = img.convert("RGBA")
            elif img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")

            img.thumbnail((AVATAR_MAX_DIMENSION, AVATAR_MAX_DIMENSION), Image.LANCZOS)

            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=AVATAR_WEBP_QUALITY, method=6)
            return buf.getvalue()

    def _generate_user_blob_name(self, org_id: str, user_id: str) -> str:
        return f"orgs/{org_id}/users/{user_id}/avatars/avatar.webp"

    def _generate_org_blob_name(self, org_id: str) -> str:
        return f"orgs/{org_id}/avatars/avatar.webp"

    def _blob_name_from_url(self, avatar_url: str) -> Optional[str]:
        """Extract blob name from a previously stored avatar URL."""
        prefix = f"{self.account_url}/{self.container_name}/"
        if avatar_url.startswith(prefix):
            return avatar_url[len(prefix):]
        return None

    def generate_sas_url(self, avatar_url: str, expiry_hours: int = 1) -> str:
        """
        Return a time-limited SAS URL for a private blob.

        Falls back to the original URL if account credentials are not
        available (e.g. in local dev without a real storage account).
        """
        if not self.account_name or not self.account_key:
            logger.warning("SAS generation skipped: AZURE_STORAGE_ACCOUNT_NAME/KEY not set")
            return avatar_url

        blob_name = self._blob_name_from_url(avatar_url)
        if not blob_name:
            return avatar_url

        expiry = datetime.now(timezone.utc) + timedelta(hours=expiry_hours)
        sas_token = generate_blob_sas(
            account_name=self.account_name,
            container_name=self.container_name,
            blob_name=blob_name,
            account_key=self.account_key,
            permission=BlobSasPermissions(read=True),
            expiry=expiry,
        )
        return f"{self.account_url}/{self.container_name}/{blob_name}?{sas_token}"

    # ── public API ───────────────────────────────────────────────────────────

    async def upload_avatar(
        self,
        file_content: bytes,
        org_id: str,
        content_type: str,
        user_id: Optional[str] = None,
    ) -> str:
        """
        Validate and upload a profile avatar image.

        Pass user_id for a user avatar (orgs/{org_id}/users/{user_id}/avatars/avatar.webp).
        Omit user_id for an org avatar (orgs/{org_id}/avatars/avatar.webp).

        Returns the public URL of the stored blob.
        Raises ValueError for invalid type/size, AzureError on storage failure.
        """
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ValueError(
                f"Unsupported image type '{content_type}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
            )

        if len(file_content) > MAX_AVATAR_SIZE_BYTES:
            raise ValueError(
                f"File too large ({len(file_content)} bytes). Maximum is {MAX_AVATAR_SIZE_BYTES} bytes (5 MB)."
            )

        blob_name = (
            self._generate_user_blob_name(org_id, user_id)
            if user_id
            else self._generate_org_blob_name(org_id)
        )

        # Resize and convert to WebP regardless of the original format
        webp_content = await asyncio.to_thread(self._compress_to_webp, file_content)
        logger.info(
            "🖼️ Avatar compressed: %d bytes → %d bytes (WebP)",
            len(file_content),
            len(webp_content),
        )

        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name,
            )

            def _upload() -> None:
                metadata = {"org_id": org_id}
                if user_id:
                    metadata["user_id"] = user_id
                blob_client.upload_blob(
                    data=webp_content,
                    content_settings=ContentSettings(content_type="image/webp"),
                    metadata=metadata,
                    overwrite=True,
                )

            await asyncio.to_thread(_upload)

            public_url = f"{self.account_url}/{self.container_name}/{blob_name}"
            logger.info(f"✅ Avatar uploaded: {blob_name}")
            return public_url

        except AzureError as e:
            logger.error(f"❌ Failed to upload avatar: {str(e)}")
            raise

    async def delete_avatar(self, avatar_url: str) -> bool:
        """
        Delete a previously stored avatar blob by its URL.
        Returns True if deleted, False if the blob didn't exist.
        """
        blob_name = self._blob_name_from_url(avatar_url)
        if not blob_name:
            logger.warning(f"⚠️ Cannot parse blob name from URL: {avatar_url}")
            return False

        try:
            blob_client = self.blob_service_client.get_blob_client(
                container=self.container_name,
                blob=blob_name,
            )

            exists = await asyncio.to_thread(blob_client.exists)
            if not exists:
                logger.warning(f"⚠️ Avatar blob not found for deletion: {blob_name}")
                return False

            await asyncio.to_thread(blob_client.delete_blob)
            logger.info(f"✅ Deleted avatar: {blob_name}")
            return True

        except ResourceNotFoundError:
            logger.warning(f"⚠️ Avatar blob not found for deletion: {blob_name}")
            return False
        except AzureError as e:
            logger.error(f"❌ Failed to delete avatar blob: {str(e)}")
            raise
