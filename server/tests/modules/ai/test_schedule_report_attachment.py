"""Scheduled emails attach the PDF report only when asked, and never fail the send over it."""

import pytest

from ee.modules.schedule_email import service as S


@pytest.mark.asyncio
async def test_no_attachment_unless_the_schedule_asks():
    assert await S._report_attachment({"dashboard_id": "d"}, {"user_id": "u"}) is None
    assert await S._report_attachment({"attach_pdf_report": True}, {"user_id": "u"}) is None


@pytest.mark.asyncio
async def test_render_failure_sends_without_the_report(monkeypatch):
    from src.modules.exports import dashboard_report

    async def boom(*a, **k):
        raise RuntimeError("renderer down")

    monkeypatch.setattr(dashboard_report, "render_dashboard_report", boom)
    out = await S._report_attachment({"attach_pdf_report": True, "dashboard_id": "3f1c1a52-1111-4222-8333-944445555666"}, {"user_id": "u"})
    assert out is None
