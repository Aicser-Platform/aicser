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
