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
from uuid import uuid4

from PIL import Image

from src.core.config import settings

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


class LocalMediaStorageService:
    """Local-disk storage for feed card thumbnail images (CE)."""

    def _thumbnail_dir(self) -> str:
        upload_dir = os.path.join(settings.UPLOAD_DIR, THUMBNAIL_SUBDIR)
        os.makedirs(upload_dir, exist_ok=True)
        return upload_dir

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

        webp_content = await asyncio.to_thread(self._compress_to_webp, file_content)
        logger.info(
            "🖼️ Feed thumbnail compressed: %d bytes → %d bytes (WebP)",
            len(file_content),
            len(webp_content),
        )

        filename = f"{uuid4()}.webp"
        file_path = os.path.join(self._thumbnail_dir(), filename)

        def _write() -> None:
            with open(file_path, "wb") as f:
                f.write(webp_content)

        await asyncio.to_thread(_write)
        logger.info(f"✅ Feed thumbnail saved: {filename}")

        return f"/media/feed-thumbnails/{filename}"
