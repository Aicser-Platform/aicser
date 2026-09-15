"""render_page_export replaced a dashboard-export path with three real bugs:
it navigated to the backend's own origin instead of the frontend's, it never
appended the embed token the target route requires, and it wrote to a local
directory nothing served back over HTTP. These tests lock in the fix for the
first two (URL construction) and the pure header/footer template builders;
the actual Playwright browser call is mocked, not exercised end-to-end here.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.exports.playwright_export_service import (
    build_pdf_header_footer,
    default_pagination_pdf_options,
    render_page_export,
)


def _make_fake_playwright(page: MagicMock):
    page.evaluate = page.evaluate if isinstance(getattr(page, "evaluate", None), AsyncMock) else AsyncMock()
    if not isinstance(getattr(page, "wait_for_selector", None), AsyncMock):
        page.wait_for_selector = AsyncMock()
    if not isinstance(getattr(page, "wait_for_timeout", None), AsyncMock):
        page.wait_for_timeout = AsyncMock()
    if not isinstance(getattr(page, "emulate_media", None), AsyncMock):
        page.emulate_media = AsyncMock()
    browser = MagicMock()
    browser.new_page = AsyncMock(return_value=page)
    browser.close = AsyncMock()

    chromium = MagicMock()
    chromium.launch = AsyncMock(return_value=browser)

    pw_instance = MagicMock()
    pw_instance.chromium = chromium

    ctx = MagicMock()
    ctx.__aenter__ = AsyncMock(return_value=pw_instance)
    ctx.__aexit__ = AsyncMock(return_value=False)
    return ctx, browser, page


@pytest.mark.asyncio
async def test_render_page_export_uses_frontend_url_and_appends_token():
    page = MagicMock()
    page.goto = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    page.screenshot = AsyncMock(return_value=b"png-bytes")
    ctx, browser, page = _make_fake_playwright(page)

    with patch("src.core.config.settings.FRONTEND_URL", "https://app.example.com"), \
         patch("playwright.async_api.async_playwright", return_value=ctx):
        file_bytes, mime = await render_page_export(
            embed_path="/embed/report/conv-1:msg-1",
            token="tok123",
            export_format="png",
        )

    assert file_bytes == b"png-bytes"
    assert mime == "image/png"
    page.goto.assert_awaited_once()
    called_url = page.goto.call_args.args[0]
    assert called_url == "https://app.example.com/embed/report/conv-1:msg-1?token=tok123"
    assert page.goto.call_args.kwargs.get("wait_until") == "load"
    browser.new_page.assert_awaited_once()
    assert browser.new_page.call_args.kwargs["device_scale_factor"] == 2.0
    browser.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_render_page_export_without_token_omits_query_string():
    page = MagicMock()
    page.goto = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    page.content = AsyncMock(return_value="<html></html>")
    ctx, browser, page = _make_fake_playwright(page)

    with patch("src.core.config.settings.FRONTEND_URL", "https://app.example.com"), \
         patch("playwright.async_api.async_playwright", return_value=ctx):
        file_bytes, mime = await render_page_export(
            embed_path="/embed/dashboard/dash-1",
            export_format="html",
        )

    assert mime == "text/html; charset=utf-8"
    called_url = page.goto.call_args.args[0]
    assert called_url == "https://app.example.com/embed/dashboard/dash-1"
    assert "?" not in called_url


@pytest.mark.asyncio
async def test_render_page_export_passes_pdf_options_through():
    page = MagicMock()
    page.goto = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    page.evaluate = AsyncMock()
    page.pdf = AsyncMock(return_value=b"pdf-bytes")
    ctx, browser, page = _make_fake_playwright(page)

    pdf_options = default_pagination_pdf_options(org_name="Acme Corp", org_logo_url=None)

    with patch("src.core.config.settings.FRONTEND_URL", "https://app.example.com"), \
         patch("playwright.async_api.async_playwright", return_value=ctx):
        await render_page_export(
            embed_path="/embed/report/conv-1:msg-1",
            token="tok123",
            export_format="pdf",
            pdf_options=pdf_options,
        )

    page.pdf.assert_awaited_once()
    call_kwargs = page.pdf.call_args.kwargs
    assert call_kwargs["display_header_footer"] is True
    assert call_kwargs["format"] == "A4"
    assert "Acme Corp" in call_kwargs["header_template"]
    assert "pageNumber" in call_kwargs["footer_template"]


@pytest.mark.asyncio
async def test_render_page_export_pdf_emulates_print_then_resizes_charts():
    """page.pdf() applies print CSS but canvases stay at on-screen size unless
    we emulate print media first, then resize ECharts, then snapshot."""
    call_order: list[str] = []

    page = MagicMock()
    page.goto = AsyncMock()
    page.wait_for_timeout = AsyncMock()

    async def _emulate_media(**kwargs):
        call_order.append(f"emulate:{kwargs.get('media')}")

    async def _evaluate(script):
        call_order.append(str(script))

    async def _pdf(**kwargs):
        call_order.append("pdf")
        return b"pdf-bytes"

    page.emulate_media = AsyncMock(side_effect=_emulate_media)
    page.evaluate = AsyncMock(side_effect=_evaluate)
    page.pdf = AsyncMock(side_effect=_pdf)
    ctx, browser, page = _make_fake_playwright(page)

    with patch("src.core.config.settings.FRONTEND_URL", "https://app.example.com"), \
         patch("src.core.config.settings.INTERNAL_FRONTEND_URL", ""), \
         patch("playwright.async_api.async_playwright", return_value=ctx):
        await render_page_export(
            embed_path="/embed/report/conv-1:msg-1",
            token="tok123",
            export_format="pdf",
        )

    assert "emulate:print" in call_order
    assert any("__aiserResizeReportCharts" in str(c) for c in call_order)
    assert any("beforeprint" in str(c) for c in call_order)
    assert call_order[-1] == "pdf"
    assert call_order.index("emulate:print") < next(
        i for i, c in enumerate(call_order) if "__aiserResizeReportCharts" in str(c)
    )
    assert next(i for i, c in enumerate(call_order) if "__aiserResizeReportCharts" in str(c)) < call_order.index("pdf")


@pytest.mark.asyncio
async def test_render_page_export_png_does_not_dispatch_beforeprint():
    """PNG export is a plain on-screen snapshot, not a print-media render --
    it must not trigger the print-only chart resize."""
    page = MagicMock()
    page.goto = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    page.evaluate = AsyncMock()
    page.screenshot = AsyncMock(return_value=b"png-bytes")
    ctx, browser, page = _make_fake_playwright(page)

    with patch("src.core.config.settings.FRONTEND_URL", "https://app.example.com"), \
         patch("playwright.async_api.async_playwright", return_value=ctx):
        await render_page_export(
            embed_path="/embed/dashboard/dash-1",
            export_format="png",
        )

    page.evaluate.assert_awaited()
    for call in page.evaluate.await_args_list:
        assert "beforeprint" not in str(call)
    page.emulate_media.assert_not_called()


def _empty_page():
    page = MagicMock()
    page.goto = AsyncMock()
    page.wait_for_timeout = AsyncMock()
    page.evaluate = AsyncMock()
    page.wait_for_selector = AsyncMock()
    page.screenshot = AsyncMock(return_value=b"png-bytes")
    page.pdf = AsyncMock(return_value=b"pdf-bytes")
    page.content = AsyncMock(return_value="<html></html>")
    return page


@pytest.mark.asyncio
async def test_render_page_export_raises_when_content_selector_missing():
    page = _empty_page()
    page.wait_for_selector = AsyncMock(side_effect=TimeoutError("selector timeout"))
    ctx, browser, page = _make_fake_playwright(page)

    with patch("src.core.config.settings.FRONTEND_URL", "https://app.example.com"), \
         patch("src.core.config.settings.INTERNAL_FRONTEND_URL", ""), \
         patch("playwright.async_api.async_playwright", return_value=ctx):
        with pytest.raises(RuntimeError, match="did not finish loading"):
            await render_page_export(
                embed_path="/embed/report/conv-1:msg-1",
                token="tok123",
                export_format="pdf",
                content_selector=".report-header",
            )


def test_unsupported_export_format_raises():
    with pytest.raises(ValueError):
        import asyncio
        asyncio.run(render_page_export(embed_path="/embed/dashboard/x", export_format="docx"))  # type: ignore[arg-type]


def test_build_pdf_header_footer_without_logo_omits_img_tag():
    templates = build_pdf_header_footer(org_name="Acme Corp", org_logo_url=None)
    assert "Acme Corp" in templates["header_template"]
    assert "<img" not in templates["header_template"]


def test_build_pdf_header_footer_with_logo_includes_img_tag():
    templates = build_pdf_header_footer(org_name="Acme Corp", org_logo_url="https://cdn.example.com/logo.png")
    assert "https://cdn.example.com/logo.png" in templates["header_template"]


def test_build_pdf_header_footer_defaults_name_when_blank():
    templates = build_pdf_header_footer(org_name=None, org_logo_url=None)
    assert "Aicser" in templates["header_template"]
