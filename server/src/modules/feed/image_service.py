"""Images in feed posts: validate, re-encode, store in object storage, serve per viewer.

Upload happens before the post exists, so an image starts unlinked (only its uploader can see
it, e.g. the composer preview) and publish_asset links it to the post. From then on a viewer
sees it exactly when they can see the post (FeedService._can_view_post).

Every upload is decoded and re-encoded to WebP: that strips EXIF (GPS, device), neutralises
polyglot files, and caps dimensions. Storage is the same backend CSV and knowledge uploads use
(S3 / Azure Blob / PostgreSQL, with fallback) — see upload_datasource_storage_service.py.
"""

from __future__ import annotations

import io
import logging
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.feed.models import FeedPost, FeedPostImage

logger = logging.getLogger(__name__)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_PIXELS = 40_000_000  # decompression-bomb guard (e.g. 8000 x 5000)
MAX_DIMENSION = 2048
MAX_IMAGES_PER_POST = 4
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"}


def reencode_image(raw: bytes) -> Tuple[bytes, int, int]:
    """Decode, orient, downscale and re-encode to WebP. Raises ValueError for non-images."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    if not raw:
        raise ValueError("The file is empty")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise ValueError("Images can be up to 10 MB")
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            w, h = probe.size
            if w * h > MAX_PIXELS:
                raise ValueError("The image is too large (over 40 megapixels)")
            probe.verify()
        with Image.open(io.BytesIO(raw)) as img:
            img.seek(0)  # animated GIF/WebP: first frame
            img = ImageOps.exif_transpose(img)
            img = img.convert("RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB")
            img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="WEBP", quality=85, method=4)
            return buf.getvalue(), img.width, img.height
    except (UnidentifiedImageError, OSError, SyntaxError) as exc:
        raise ValueError("That file isn't a supported image (PNG, JPEG, WebP or GIF)") from exc


def image_url(image_id: Any, public: bool = False) -> str:
    return f"/api/feed/{'public/' if public else ''}images/{image_id}"


def serialize_images(rows: Sequence[FeedPostImage], public: bool = False) -> List[Dict[str, Any]]:
    return [
        {"id": str(r.id), "url": image_url(r.id, public), "width": r.width, "height": r.height, "alt": r.alt_text}
        for r in sorted(rows, key=lambda r: r.position or 0)
    ]


async def store_upload(
    db: AsyncSession,
    raw: bytes,
    content_type: str,
    uploader_id: UUID,
    organization_id: Optional[str],
    alt_text: Optional[str] = None,
) -> FeedPostImage:
    if (content_type or "").lower() not in ALLOWED_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Only PNG, JPEG, WebP or GIF images can be attached")
    try:
        webp, width, height = reencode_image(raw)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    image_id = uuid.uuid4()
    object_key = await UploadDatasourceStorageService().store_file(
        file_content=webp,
        project_id=None,
        original_filename=f"feed-image-{image_id}.webp",
        content_type="image/webp",
        source_id=f"feed-image-{image_id}",
        organization_id=organization_id,
        user_id=str(uploader_id),
    )
    row = FeedPostImage(
        id=image_id,
        uploader_id=uploader_id,
        organization_id=_as_uuid(organization_id),
        object_key=object_key,
        content_type="image/webp",
        width=width,
        height=height,
        size_bytes=len(webp),
        alt_text=(alt_text or "").strip()[:300] or None,
    )
    db.add(row)
    await db.flush()
    return row


async def link_images(db: AsyncSession, post: FeedPost, image_ids: Sequence[UUID], author_id: UUID) -> None:
    """Make `image_ids` (in order) the post's images. Only the author's own unlinked uploads
    (or images already on this post) can be used, so nobody can pull someone else's image in."""
    ids = list(dict.fromkeys(image_ids))[:MAX_IMAGES_PER_POST]
    rows = (await db.execute(select(FeedPostImage).where(FeedPostImage.id.in_(ids)))).scalars().all() if ids else []
    by_id = {r.id: r for r in rows}
    for image_id in ids:
        r = by_id.get(image_id)
        if not r or r.uploader_id != author_id or (r.post_id is not None and r.post_id != post.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="One of the images can't be attached")
    # Replace-on-update, like attachments: images dropped from the post are detached.
    await db.execute(
        update(FeedPostImage).where(FeedPostImage.post_id == post.id, FeedPostImage.id.notin_(ids or [uuid.uuid4()]))
        .values(post_id=None)
    )
    for position, image_id in enumerate(ids):
        r = by_id[image_id]
        r.post_id = post.id
        r.position = position
        r.organization_id = post.organization_id or r.organization_id


async def images_for_posts(db: AsyncSession, post_ids: Sequence[UUID]) -> Dict[UUID, List[FeedPostImage]]:
    if not post_ids:
        return {}
    rows = (await db.execute(select(FeedPostImage).where(FeedPostImage.post_id.in_(list(post_ids))))).scalars().all()
    out: Dict[UUID, List[FeedPostImage]] = {}
    for r in rows:
        out.setdefault(r.post_id, []).append(r)
    return out


async def read_image(db: AsyncSession, image_id: UUID, viewer_id: Optional[UUID], can_view_post) -> bytes:
    """Bytes of an image the viewer may see; 404 otherwise (never reveal that it exists)."""
    row = await db.get(FeedPostImage, image_id)
    not_found = HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Image not found")
    if row is None:
        raise not_found
    if row.post_id is None:
        if not viewer_id or row.uploader_id != viewer_id:
            raise not_found
    else:
        post = await db.get(FeedPost, row.post_id)
        if post is None or not await can_view_post(post, viewer_id):
            raise not_found
    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    return await UploadDatasourceStorageService().get_file(row.object_key, None)


def _as_uuid(value: Any) -> Optional[UUID]:
    try:
        return UUID(str(value)) if value else None
    except (TypeError, ValueError):
        return None


async def object_keys_for_post(db: AsyncSession, post_id: UUID) -> List[str]:
    rows = (await db.execute(select(FeedPostImage.object_key).where(FeedPostImage.post_id == post_id))).scalars().all()
    return [k for k in rows if k]


async def delete_objects(keys: Sequence[str]) -> int:
    """Remove image files from object storage (best effort: the rows are already gone)."""
    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    svc, removed = UploadDatasourceStorageService(), 0
    for key in keys:
        try:
            if await svc.delete_file(key, None):
                removed += 1
        except Exception as exc:  # pragma: no cover - storage outage
            logger.warning("Feed image %s not removed from storage: %s", key, exc)
    return removed


async def purge_orphan_images(db: AsyncSession, older_than_hours: int = 24) -> int:
    """Uploads never attached to a published post (composer abandoned) — delete after a day."""
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import delete as _delete

    cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
    rows = (await db.execute(select(FeedPostImage.id, FeedPostImage.object_key).where(
        FeedPostImage.post_id.is_(None), FeedPostImage.created_at < cutoff))).all()
    if not rows:
        return 0
    await db.execute(_delete(FeedPostImage).where(FeedPostImage.id.in_([r[0] for r in rows])))
    await db.commit()
    await delete_objects([r[1] for r in rows])
    return len(rows)
