"""Channel dispatch: registered channels are called and unknown ones are skipped, not fatal."""

import pytest

from src.modules.alerts.notification_service import NotificationService
from src.shared import notification_channels as nc


@pytest.mark.asyncio
async def test_registered_channel_is_called_and_unknown_is_skipped(monkeypatch):
    seen = []

    async def handler(channel, rule, event_id, value, message):
        seen.append((channel["target_id"], event_id, value, message))

    monkeypatch.setattr(nc, "_loaded", True)
    nc.register_channel("test_channel", handler)
    rule = {"channels": [{"type": "nobody_home"}, {"type": "test_channel", "target_id": "t"}]}
    await NotificationService().notify(rule, "e1", 3.0, "hello")
    assert seen == [("t", "e1", 3.0, "hello")]
