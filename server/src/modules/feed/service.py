"""Service layer for social analytics feed."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.feed.service_actions import FeedServiceActionMixin
from src.modules.feed.service_base import FeedServiceBaseMixin
from src.modules.feed.service_preview import FeedServicePreviewMixin
from src.modules.feed.service_queries import FeedServiceQueryMixin
from src.modules.feed.service_seed import FeedServiceSeedMixin
from src.modules.feed.service_serialization import FeedServiceSerializationMixin
from src.modules.feed.service_utils import (
    _enum_value,
    _reaction_values,
    _safe_uuid,
    _time_ago,
    _to_iso,
    _utcnow,
)


class FeedService(
    FeedServiceBaseMixin,
    FeedServiceSeedMixin,
    FeedServiceSerializationMixin,
    FeedServicePreviewMixin,
    FeedServiceQueryMixin,
    FeedServiceActionMixin,
):
    """Business logic for feed APIs backed by feed tables."""

    def __init__(self, db: AsyncSession):
        self.db = db


__all__ = [
    "FeedService",
    "_utcnow",
    "_enum_value",
    "_safe_uuid",
    "_to_iso",
    "_time_ago",
    "_reaction_values",
]
