"""Alerts can post to Shared insights through the same publish path (and approval rules) as
charts and dashboards: published as the rule's owner, one card per alert, audience checked
against the owner's roles when the rule is saved."""

import pytest
from fastapi import HTTPException

import ee.modules.alerts.notification_service as ns


class FakeFeed:
    roles = {}
    published = []

    def __init__(self, db):
        pass

    async def _get_role_names(self, user_id, organization_id=None, project_id=None):
        return FakeFeed.roles.get("project" if project_id else "org", [])

    async def publish_asset(self, request, user_payload):
        FakeFeed.published.append((request, user_payload))


class _Session:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, *a):
        return False


@pytest.fixture(autouse=True)
def _fakes(monkeypatch):
    import src.db.session as sess
    import src.modules.feed.service as feed_service

    monkeypatch.setattr(feed_service, "FeedService", FakeFeed)
    monkeypatch.setattr(sess, "async_session", lambda: _Session())
    FakeFeed.roles, FakeFeed.published = {}, []


@pytest.mark.asyncio
async def test_audience_needs_the_same_roles_as_publishing_a_chart():
    ch = {"type": "feed", "visibility": "project"}
    FakeFeed.roles = {"project": ["project_viewer"]}
    assert "project owner or editor" in await ns.feed_channel_problem("u", "o", "p", ch)
    FakeFeed.roles = {"project": ["project_editor"]}
    assert await ns.feed_channel_problem("u", "o", "p", ch) is None
    assert await ns.feed_channel_problem("u", "o", None, ch)  # no project to share to
    assert await ns.feed_channel_problem("u", "o", "p", {"type": "feed", "visibility": "private"}) is None


@pytest.mark.asyncio
async def test_saving_a_rule_with_a_forbidden_audience_is_refused():
    from ee.modules.alerts.alert_rules_service import AlertRulesService

    FakeFeed.roles = {"org": []}
    with pytest.raises(HTTPException) as e:
        await AlertRulesService._check_feed_channels([{"type": "feed", "visibility": "organization"}], "u", "o", None)
    assert e.value.status_code == 400


@pytest.mark.asyncio
async def test_firing_publishes_one_card_per_alert_as_its_owner():
    rule = {"id": "r1", "name": "Revenue drop", "created_by": "owner-1", "org_id": "11111111-1111-1111-1111-111111111111",
            "project_id": "22222222-2222-2222-2222-222222222222", "severity": "critical"}
    svc = ns.NotificationService()
    await svc._post_to_feed({"type": "feed", "visibility": "organization"}, rule, "ev1", 42.0, "Revenue fell below 50")
    await svc._post_to_feed({"type": "feed", "visibility": "organization"}, rule, "ev2", 40.0, "Revenue fell below 50")
    (r1, who), (r2, _) = FakeFeed.published
    assert who["id"] == "owner-1"
    assert r1.asset_type.value == "insight" and r1.visibility.value == "organization"
    assert r1.asset_id == r2.asset_id == ns.alert_feed_asset_id("r1")  # same card, updated
    assert r1.publication_mode.value == "update" and r1.preview_metadata["source"] == "alert"
