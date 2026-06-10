"""Feed module unit tests."""
from __future__ import annotations

from uuid import uuid4

import pytest

from src.modules.feed.schemas import (
    AssetType,
    FeedAssetCounts,
    PublishAssetRequest,
    FeedVisibility,
    PublicationMode,
)


def test_publish_asset_request_public_requires_login_default_open():
    payload = PublishAssetRequest(
        asset_type=AssetType.insight,
        asset_id=uuid4(),
        title="Open insight",
        visibility=FeedVisibility.public,
    )
    assert payload.requires_login is False


def test_publish_asset_request_publication_mode():
    payload = PublishAssetRequest(
        asset_type=AssetType.dashboard,
        asset_id=uuid4(),
        title="Dashboard",
        publication_mode=PublicationMode.create_new,
    )
    assert payload.publication_mode == PublicationMode.create_new


def test_asset_type_includes_query():
    assert AssetType.query.value == "query"


def test_feed_asset_counts_defaults():
    counts = FeedAssetCounts()
    assert counts.query == 0


def test_publish_asset_request_accepts_source_query_id():
    payload = PublishAssetRequest(
        asset_type=AssetType.query,
        source_query_id="query-123",
        title="My saved query",
        visibility=FeedVisibility.public,
    )
    assert payload.source_query_id == "query-123"
    assert payload.asset_id is None


@pytest.mark.asyncio
async def test_to_author_includes_username_and_avatar():
    from src.modules.feed.service_serialization import FeedServiceSerializationMixin
    from src.modules.user.models import User
    from uuid import uuid4

    class SerializationStub(FeedServiceSerializationMixin):
        db = None

    user_id = uuid4()
    user = User(
        id=user_id,
        username="jane.doe",
        email="jane@example.com",
        first_name="Jane",
        last_name="Doe",
        avatar_url="https://storage.example.com/avatars/jane.png",
    )
    author = SerializationStub()._to_author(user, user_id)
    assert author.name == "Jane Doe"
    assert author.username == "jane.doe"
    assert author.avatarUrl is not None


@pytest.mark.asyncio
async def test_fallback_preview_payload_shape():
    from src.modules.feed.service_preview import FeedServicePreviewMixin
    from src.modules.feed.models import FeedPost

    class PreviewStub(FeedServicePreviewMixin):
        db = None

    post = FeedPost(
        asset_type="insight",
        asset_id=uuid4(),
        title="Revenue trend",
        description="Weekly revenue up 12%",
        visibility="public",
        status="approved",
    )
    payload = PreviewStub()._fallback_preview_payload(post)
    assert payload["previewLabel"] == "Insight Snapshot"
    assert "Weekly revenue" in payload["summary"]


def test_sanitize_preview_data_accepts_floats():
    from src.modules.feed.service_utils import _normalize_asset_payload, _sanitize_preview_data
    from src.modules.feed.schemas import FeedAssetPayload

    raw = [135160.67, 146007.17, "bad", None, {"value": 42.5}]
    assert _sanitize_preview_data(raw) == [135160.67, 146007.17, 42.5]

    payload = _normalize_asset_payload(
        {
            "summary": "Revenue",
            "previewLabel": "Revenue trend",
            "previewType": "line",
            "previewData": raw,
            "previews": [{"type": "line", "data": raw}],
        }
    )
    model = FeedAssetPayload.model_validate(payload)
    assert model.previewData == [135160.67, 146007.17, 42.5]
    assert model.previews[0].data == [135160.67, 146007.17, 42.5]
