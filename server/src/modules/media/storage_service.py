"""
Local-disk storage service for feed card thumbnail images.

CE stores thumbnails on local disk under
  <UPLOAD_DIR>/feed_thumbnails/<uuid>.webp
and serves them back via the /media static mount (see src/main.py).
"""

import asyncio
import io
import logging
import os
import re
from uuid import uuid4
from typing import Optional, Tuple

from PIL import Image
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from src.core.config import settings
from src.db.session import async_session
from src.modules.data.models import FileStorage

logger = logging.getLogger(__name__)


ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
}

MAX_THUMBNAIL_SIZE_BYTES = 3 * 1024 * 1024  # 3 MB
THUMBNAIL_MAX_DIMENSION = 960              # px — longest side capped at this
THUMBNAIL_WEBP_QUALITY = 80                # 0-100; good size/quality balance for previews

THUMBNAIL_SUBDIR = "feed_thumbnails"
THUMBNAIL_OBJECT_PREFIX = "media/feed-thumbnails/"
THUMBNAIL_FILENAME_RE = re.compile(r"^[a-f0-9-]{36}\.webp$")


class LocalMediaStorageService:
    """Local-disk storage for feed card thumbnail images (CE)."""

    def _thumbnail_dir(self) -> str:
        upload_dir = os.path.join(settings.UPLOAD_DIR, THUMBNAIL_SUBDIR)
        os.makedirs(upload_dir, exist_ok=True)
        return upload_dir

    def _thumbnail_path(self, filename: str) -> str:
        return os.path.join(self._thumbnail_dir(), filename)

    def _object_key(self, filename: str) -> str:
        return f"{THUMBNAIL_OBJECT_PREFIX}{filename}"

    def _should_use_db_backup(self) -> bool:
        return bool(settings.DATABASE_URL) or settings.ENVIRONMENT == "production"

    def _compress_to_webp(self, file_content: bytes) -> bytes:
        """Resize to THUMBNAIL_MAX_DIMENSION and convert to WebP."""
        with Image.open(io.BytesIO(file_content)) as img:
            # Palette mode → RGBA to preserve transparency; everything else → RGB
            if img.mode == "P":
                img = img.convert("RGBA")
            elif img.mode not in ("RGB", "RGBA"):
                img = img.convert("RGB")

            img.thumbnail((THUMBNAIL_MAX_DIMENSION, THUMBNAIL_MAX_DIMENSION), Image.LANCZOS)

            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=THUMBNAIL_WEBP_QUALITY, method=6)
            return buf.getvalue()

    async def save_thumbnail(self, file_content: bytes, content_type: str) -> str:
        """
        Validate, compress, and persist a feed card thumbnail image to local disk.

        Returns a relative URL path (e.g. "/media/feed-thumbnails/<uuid>.webp").
        Raises ValueError for invalid content-type/size.
        """
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ValueError(
                f"Unsupported image type '{content_type}'. "
                f"Allowed: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
            )

        if len(file_content) > MAX_THUMBNAIL_SIZE_BYTES:
            raise ValueError(
                f"File too large ({len(file_content)} bytes). "
                f"Maximum is {MAX_THUMBNAIL_SIZE_BYTES} bytes (3 MB)."
            )

        webp_content = self._compress_to_webp(file_content)
        logger.info(
            "🖼️ Feed thumbnail compressed: %d bytes → %d bytes (WebP)",
            len(file_content),
            len(webp_content),
        )

        filename = f"{uuid4()}.webp"
        file_path = self._thumbnail_path(filename)

        with open(file_path, "wb") as f:
            f.write(webp_content)
        await self._persist_thumbnail(filename, webp_content)
        logger.info(f"✅ Feed thumbnail saved: {filename}")

        return f"/media/feed-thumbnails/{filename}"

    async def _persist_thumbnail(self, filename: str, webp_content: bytes) -> None:
        """Best-effort persistent backup for ephemeral production filesystems."""
        if not self._should_use_db_backup():
            return

        object_key = self._object_key(filename)

        async def _write_db() -> None:
            async with async_session() as session:
                stmt = insert(FileStorage).values(
                    object_key=object_key,
                    file_data=webp_content,
                    file_size=len(webp_content),
                    content_type="image/webp",
                    original_filename=filename,
                    project_id=None,
                    is_active=True,
                )
                stmt = stmt.on_conflict_do_update(
                    index_elements=[FileStorage.object_key],
                    set_={
                        "file_data": webp_content,
                        "file_size": len(webp_content),
                        "content_type": "image/webp",
                        "original_filename": filename,
                        "is_active": True,
                    },
                )
                await session.execute(stmt)
                await session.commit()

        try:
            await asyncio.wait_for(_write_db(), timeout=2.0)
        except Exception as exc:
            logger.warning("Feed thumbnail DB backup skipped: %s", exc)

    async def get_thumbnail(self, filename: str) -> Optional[Tuple[bytes, str]]:
        if not THUMBNAIL_FILENAME_RE.match(filename):
            return None

        file_path = self._thumbnail_path(filename)
        if os.path.isfile(file_path):
            try:
                with open(file_path, "rb") as f:
                    return f.read(), "image/webp"
            except Exception as exc:
                logger.warning("Failed to read feed thumbnail from disk: %s", exc)

        if not self._should_use_db_backup():
            return None

        async def _read_db() -> Optional[Tuple[bytes, str]]:
            async with async_session() as session:
                result = await session.execute(
                    select(FileStorage).where(
                        FileStorage.object_key == self._object_key(filename),
                        FileStorage.is_active == True,
                    )
                )
                stored = result.scalar_one_or_none()
                if not stored:
                    return None
                return stored.file_data, stored.content_type or "image/webp"

        try:
            return await asyncio.wait_for(_read_db(), timeout=2.0)
        except Exception as exc:
            logger.warning("Failed to read feed thumbnail from DB backup: %s", exc)
            return None
