"""NotificationItem.kind must accept every kind the inbox actually constructs.

feed_notifications() (inbox_service.py) has always built NotificationItem(kind="feed", ...)
for mentions/comments/reactions/shares/follows/approvals, but the schema's Literal type
never included "feed" - the mismatch raised a pydantic ValidationError uncaught inside
feed_notifications(), which failed build_inbox() entirely. The router's outer try/except
then silently returned an EMPTY inbox (items=[], unread_count=0) whenever a user had any
real feed notification, hiding every other notification (including firing alerts) too,
with no error surfaced anywhere.
"""

import pytest

from src.modules.notifications.schemas import NotificationItem

ALL_INBOX_KINDS = ("alert", "invitation", "ai", "activity", "feed")


@pytest.mark.parametrize("kind", ALL_INBOX_KINDS)
def test_every_kind_inbox_service_constructs_is_accepted(kind):
    item = NotificationItem(id=f"{kind}-1", kind=kind, title="t", message="m", href="/x")
    assert item.kind == kind


def test_unknown_kind_still_rejected():
    with pytest.raises(Exception):
        NotificationItem(id="x-1", kind="not-a-real-kind", title="t", message="m", href="/x")
