"""Sending a result to email, a webhook, Slack or Teams."""

import pytest

from ee.modules.activation import senders
from ee.modules.activation.senders import Result, SendError, as_csv, preview_table, send
from src.shared import outbound

RESULT = Result("Revenue by month", "May was the best month.", ["month", "revenue"],
                [{"month": f"2026-{m:02d}", "revenue": m * 100} for m in range(1, 13)], link="https://app.example/q/1")


def test_csv_and_chat_preview():
    assert as_csv(RESULT).decode().splitlines()[:2] == ["month,revenue", "2026-01,100"]
    table = preview_table(RESULT)
    assert table.splitlines()[0].startswith("month") and "… 2 more rows" in table


@pytest.mark.asyncio
async def test_internal_addresses_are_refused(monkeypatch):
    async def private(url):
        return False

    monkeypatch.setattr(outbound, "resolves_to_public_address", private)
    with pytest.raises(SendError):
        await send("webhook", {}, {"url": "https://10.0.0.5/hook"}, RESULT, "u1")
    assert await outbound.safe_destination("http://hooks.example.com/x", https_only=True) is False


@pytest.mark.asyncio
async def test_webhook_gets_the_table_as_json(monkeypatch):
    sent = {}

    async def fake_post(url, body, headers=None):
        sent.update(url=url, body=body, headers=headers)

    monkeypatch.setattr(senders, "_post_json", fake_post)
    await send("webhook", {}, {"url": "https://hooks.example.com/x", "headers": {"X-Token": "t"}}, RESULT, "u1")
    assert sent["body"]["rows"][0] == {"month": "2026-01", "revenue": 100}
    assert sent["headers"] == {"X-Token": "t"} and sent["body"]["sent_by"] == "u1"
    await send("slack", {}, {"url": "https://hooks.slack.com/services/x"}, RESULT, "u1")
    assert sent["body"]["text"].startswith("*Revenue by month*") and "```" in sent["body"]["text"]


@pytest.mark.asyncio
async def test_email_without_mail_setup_says_so(monkeypatch):
    import src.shared.transactional_email as mail

    async def disabled(*args, **kwargs):
        return False

    monkeypatch.setattr(mail, "send_transactional_email", disabled)
    with pytest.raises(SendError, match="Email isn't set up"):
        await send("email", {"recipients": ["cfo@acme.com"]}, {}, RESULT, "u1")
    with pytest.raises(SendError, match="no recipients"):
        await send("email", {"recipients": []}, {}, RESULT, "u1")
