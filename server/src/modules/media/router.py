"""API routes for feed card thumbnail uploads.

Mounted at /api/media/feed-thumbnails prefix in the main API router.
"""

import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.media.storage_service import LocalMediaStorageService

logger = logging.getLogger(__name__)

router = APIRouter()

_storage_service = LocalMediaStorageService()


class FeedThumbnailUploadResponse(BaseModel):
    url: str


@router.post("", response_model=FeedThumbnailUploadResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=FeedThumbnailUploadResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
async def upload_feed_thumbnail(
    file: UploadFile = File(...),
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
) -> FeedThumbnailUploadResponse:
    """Upload a static screenshot thumbnail for a feed card (PNG/JPEG/WEBP, <=3MB)."""
    contents = await file.read()
    try:
        url = await _storage_service.save_thumbnail(contents, file.content_type or "")
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception as exc:
        logger.error(f"❌ Failed to save feed thumbnail: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to save thumbnail",
        )

    return FeedThumbnailUploadResponse(url=url)
