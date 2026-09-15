"""Text posts, @mentions, and multi-attachment schema/logic tests.

Full end-to-end behavior (approval-skip, public-visibility rejection,
attachment author/viewer access checks, mention notification fan-out) was
live-verified directly against a real dev database during implementation -
this file covers the pure-logic/schema pieces, matching this test module's
existing convention (no DB-integration fixtures exist in this repo's test
suite; see test_feed_service.py's own db=None mixin-stub pattern).
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from src.modules.feed.schemas import (
    AssetType,
    AttachmentRef,
    FeedAttachmentPayload,
    MAX_POST_ATTACHMENTS,
    PublishAssetRequest,
    FeedVisibility,
    UpdatePostRequest,
)


def test_asset_type_includes_post():
    assert AssetType.post.value == "post"


def test_publish_asset_request_post_needs_no_title():
    # Unlike dashboard/chart/insight/query, a text post's body is `description`;
    # publish_asset() enforces the actual required-field check at runtime
    # (title for other types, description for post) - the schema itself just
    # needs to not force a title for this type.
    payload = PublishAssetRequest(
        asset_type=AssetType.post,
        description="What does everyone think about this?",
        visibility=FeedVisibility.private,
    )
    assert payload.title is None
    assert payload.asset_id is None


def test_publish_asset_request_accepts_attachments_and_mentions():
    dash_id = uuid4()
    user_id = uuid4()
    payload = PublishAssetRequest(
        asset_type=AssetType.post,
        description="Check this out",
        attachments=[AttachmentRef(asset_type="dashboard", asset_id=dash_id)],
        mentioned_users=[user_id],
    )
    assert payload.attachments[0].asset_id == dash_id
    assert payload.attachments[0].asset_type == "dashboard"
    assert payload.mentioned_users == [user_id]


def test_attachment_ref_rejects_unknown_asset_type():
    with pytest.raises(ValidationError):
        AttachmentRef(asset_type="post", asset_id=uuid4())


def test_attachment_ref_accepts_insight_publication():
    post_id = uuid4()
    asset_id = uuid4()
    payload = AttachmentRef(
        asset_type="insight",
        asset_id=asset_id,
        publication_id=post_id,
    )
    assert payload.asset_type == "insight"
    assert payload.publication_id == post_id
    assert payload.asset_id == asset_id


def test_publish_asset_request_rejects_too_many_attachments():
    with pytest.raises(ValidationError):
        PublishAssetRequest(
            asset_type=AssetType.post,
            description="Too many",
            attachments=[
                AttachmentRef(asset_type="chart", asset_id=uuid4())
                for _ in range(MAX_POST_ATTACHMENTS + 1)
            ],
        )


def test_feed_attachment_payload_restricted_has_no_title():
    payload = FeedAttachmentPayload(asset_type="dashboard", asset_id=str(uuid4()), restricted=True)
    assert payload.title is None
    assert payload.thumbnail_url is None


def test_update_post_request_rejects_empty_description():
    with pytest.raises(ValidationError):
        UpdatePostRequest(description="")


def test_update_post_request_accepts_mentions():
    payload = UpdatePostRequest(description="fixed a typo", mentioned_users=[uuid4()])
    assert len(payload.mentioned_users) == 1


@pytest.mark.asyncio
async def test_can_view_dashboard_or_chart_false_when_row_missing():
    """A dangling/deleted asset id must deny access, not raise - the caller
    (post-attachment validation and per-viewer serialization) treats any
    failure as "can't see it", never as a request-breaking error."""
    from src.modules.feed.service_actions import FeedServiceActionMixin

    class _EmptyResult:
        def first(self):
            return None

    class _StubDB:
        async def execute(self, *_args, **_kwargs):
            return _EmptyResult()

    class ActionStub(FeedServiceActionMixin):
        db = _StubDB()

    stub = ActionStub()
    assert await stub._can_view_dashboard_or_chart("dashboard", uuid4(), uuid4()) is False
    assert await stub._can_view_dashboard_or_chart("chart", uuid4(), uuid4()) is False


def _sequenced_db(*results):
    """Returns each of `results` in order across successive db.execute()
    calls - needed for the chart-with-no-project_id path, which issues a
    SECOND query (the DashboardChart join, read via .all()) beyond the
    initial chart-row lookup (read via .first())."""
    from src.modules.feed.service_actions import FeedServiceActionMixin

    class _StubDB:
        def __init__(self):
            self._remaining = list(results)

        async def execute(self, *_args, **_kwargs):
            return self._remaining.pop(0)

    class ActionStub(FeedServiceActionMixin):
        db = _StubDB()

    return ActionStub()


@pytest.mark.asyncio
async def test_can_view_dashboard_or_chart_no_project_no_dashboard_denied():
    """Same fallback _validate_publish_asset uses at attach/publish time
    (test_publish_asset_access.py's test_chart_non_owner_personal_chart_
    rejected) applies here too, at per-viewer render time: a chart with no
    project_id and genuinely no parent-dashboard association stays denied."""
    from types import SimpleNamespace
    from unittest.mock import patch

    chart_result = SimpleNamespace(first=lambda: (None, "someone-else"))
    dash_result = SimpleNamespace(all=lambda: [])
    stub = _sequenced_db(chart_result, dash_result)
    with patch("src.modules.feed.service_actions.is_ee_enabled", return_value=True):
        assert await stub._can_view_dashboard_or_chart("chart", uuid4(), uuid4()) is False


@pytest.mark.asyncio
async def test_can_view_dashboard_or_chart_no_project_reachable_via_dashboard_allowed():
    """The exact bug this fix closes: a dashboard-created chart with no
    user_id/project_id of its own must still be viewable - at per-viewer
    RENDER time, not just at attach time - through a dashboard the viewer
    can access. This is the check that runs on every feed page load for
    every viewer, so it needs its own coverage independent of
    _validate_publish_asset's (author-side, create-time only) tests."""
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, patch

    dash_id = uuid4()
    chart_result = SimpleNamespace(first=lambda: (None, "someone-else"))
    dash_result = SimpleNamespace(all=lambda: [(dash_id, uuid4(), "someone-else")])
    stub = _sequenced_db(chart_result, dash_result)
    with patch("src.modules.feed.service_actions.is_ee_enabled", return_value=True), patch(
        "src.modules.authentication.rbac_service.has_dashboard_access",
        new=AsyncMock(return_value=True),
    ):
        assert await stub._can_view_dashboard_or_chart("chart", uuid4(), uuid4()) is True
