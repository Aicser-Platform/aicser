"""Unit tests for the local feed-thumbnail media storage service."""
from __future__ import annotations

import io

import pytest
from PIL import Image

from src.modules.media.storage_service import (
    MAX_THUMBNAIL_SIZE_BYTES,
    LocalMediaStorageService,
)


def _make_png_bytes(size=(320, 200)) -> bytes:
    img = Image.new("RGB", size, color=(255, 0, 0))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _disable_db_backup(monkeypatch):
    monkeypatch.setattr(LocalMediaStorageService, "_should_use_db_backup", lambda self: False)


@pytest.mark.asyncio
async def test_save_thumbnail_accepts_valid_png(tmp_path, monkeypatch):
    from src.core.config import settings

    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))

    service = LocalMediaStorageService()
    url = await service.save_thumbnail(_make_png_bytes(), "image/png")

    assert url.startswith("/media/feed-thumbnails/")
    assert url.endswith(".webp")

    filename = url.rsplit("/", 1)[-1]
    saved_path = tmp_path / "feed_thumbnails" / filename
    assert saved_path.exists()

    with Image.open(saved_path) as saved_img:
        assert saved_img.format == "WEBP"
        assert max(saved_img.size) <= 960

    stored = await service.get_thumbnail(filename)
    assert stored is not None
    stored_bytes, content_type = stored
    assert stored_bytes == saved_path.read_bytes()
    assert content_type == "image/webp"


@pytest.mark.asyncio
async def test_save_thumbnail_rejects_wrong_content_type(tmp_path, monkeypatch):
    from src.core.config import settings

    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))

    service = LocalMediaStorageService()
    with pytest.raises(ValueError, match="Unsupported image type"):
        await service.save_thumbnail(b"not-an-image", "application/pdf")


@pytest.mark.asyncio
async def test_save_thumbnail_rejects_oversized_file(tmp_path, monkeypatch):
    from src.core.config import settings

    monkeypatch.setattr(settings, "UPLOAD_DIR", str(tmp_path))

    service = LocalMediaStorageService()
    oversized = b"0" * (MAX_THUMBNAIL_SIZE_BYTES + 1)
    with pytest.raises(ValueError, match="File too large"):
        await service.save_thumbnail(oversized, "image/png")
