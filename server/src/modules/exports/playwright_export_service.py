"""Shared Playwright-based export service for rendering any chrome-free
`/embed/*` route to PNG, PDF, or HTML.

This replaces a dashboard-only export path that had three real bugs, fixed
here once so no second caller (e.g. report export) can inherit them:

1. It navigated Playwright to `request.base_url` - the *backend's* own
   origin - instead of the frontend's actual origin, where `/embed/*`
   routes actually live.
2. It never appended the embed token the target route requires, so the
   navigated page 401'd before Playwright ever captured anything real.
3. It wrote output to a local `./exports/` directory that no route in this
   codebase mounts or serves back over HTTP - the returned `export_url` was
   never actually retrievable.

This service returns bytes directly (never a path), so a caller streams the
result straight back in the HTTP response - there is nothing left to "not
serve."
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Literal, Optional, Tuple

from src.core.config import settings

logger = logging.getLogger(__name__)

ExportFormat = Literal["png", "pdf", "html"]

_MIME_TYPES: Dict[str, str] = {
    "png": "image/png",
    "pdf": "application/pdf",
    "html": "text/html; charset=utf-8",
}

DEFAULT_VIEWPORT: Dict[str, int] = {"width": 1400, "height": 900}


async def render_page_export(
    *,
    embed_path: str,
    token: Optional[str] = None,
    export_format: ExportFormat,
    viewport: Optional[Dict[str, int]] = None,
    device_scale_factor: float = 2.0,
    pdf_options: Optional[Dict[str, Any]] = None,
    content_selector: Optional[str] = None,
) -> Tuple[bytes, str]:
    """Render a chrome-free embed route via headless Chromium.

    Returns (file_bytes, mime_type). `device_scale_factor` defaults to 2.0
    for hi-DPI PNG/PDF output - this is the right lever for export quality
    since capture is a server-side screenshot, not a change to how ECharts
    renders on-screen.

    content_selector: a CSS selector that only appears once the embed page's
    own async data fetch has actually populated real content (e.g. the
    report embed's ".report-header", which only renders after its useEffect
    fetch resolves - the loading/error states render a different subtree
    entirely). `wait_until="networkidle"` alone is not sufficient: idle network
    fires on the SPA shell's own bundle load, before its post-mount data
    fetch has even started - so the fixed follow-up wait below is the only
    thing standing between "captured after data arrived" and "captured a
    half-second too early" - live-reproduced: an identical back-to-back call
    against the same report produced a full 4-page PDF once and a ~1KB
    blank-page PDF the next time, pure timing variance. Waiting for this
    selector (when the caller has one) removes that race at the source;
    callers with no natural selector keep the old timeout-only behavior.
    """
    if export_format not in _MIME_TYPES:
        raise ValueError(f"Unsupported export format: {export_format!r}. Supported: {sorted(_MIME_TYPES)}")

    base = (settings.INTERNAL_FRONTEND_URL or settings.FRONTEND_URL or "http://localhost:3000").rstrip("/")
    url = f"{base}{embed_path}"
    if token:
        separator = "&" if "?" in url else "?"
        url = f"{url}{separator}token={token}"

    from playwright.async_api import async_playwright  # type: ignore

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
        try:
            page = await browser.new_page(
                viewport=viewport or DEFAULT_VIEWPORT,
                device_scale_factor=device_scale_factor,
            )
            await page.goto(url, wait_until="networkidle", timeout=30000)
            if content_selector:
                try:
                    await page.wait_for_selector(content_selector, timeout=15000)
                except Exception:
                    logger.warning(
                        "render_page_export: content_selector %r never appeared for %s; "
                        "capturing whatever loaded (likely an error/empty state)",
                        content_selector, embed_path,
                    )
            await page.wait_for_timeout(2000)

            if export_format == "png":
                file_bytes = await page.screenshot(full_page=True)
            elif export_format == "pdf":
                # page.pdf() applies @media print CSS (via Chrome DevTools
                # Protocol's Page.printToPDF), but — unlike an interactive
                # print dialog reached through window.print() — it does NOT
                # dispatch the page's own `beforeprint`/`afterprint` DOM
                # events. ReportDocument.tsx's SectionChart listens for
                # exactly that event to resize each ECharts canvas to its
                # now print-constrained container (a ResizeObserver alone
                # doesn't reliably fire for print-only layout changes); with
                # no real print dialog in this headless path, that listener
                # was live-reproduced as never firing, so every chart kept
                # its full on-screen canvas width and just got clipped by
                # its container's overflow:hidden — exactly the reported
                # "each chart cut off, not within container" bug. Firing it
                # here manually closes the gap without needing the frontend
                # to special-case a non-interactive export.
                await page.evaluate("window.dispatchEvent(new Event('beforeprint'))")
                # ECharts' resize() call (triggered by that event) queues a
                # re-render on the next animation frame rather than painting
                # synchronously — give it a moment to actually redraw the
                # canvas at its new dimensions before the PDF snapshot below.
                await page.wait_for_timeout(300)
                options: Dict[str, Any] = {"format": "A4", "print_background": True}
                options.update(pdf_options or {})
                file_bytes = await page.pdf(**options)
            else:  # html
                content = await page.content()
                file_bytes = content.encode("utf-8")
        finally:
            await browser.close()

    return file_bytes, _MIME_TYPES[export_format]


def build_pdf_header_footer(
    *,
    org_name: Optional[str],
    org_logo_url: Optional[str],
    accent_color: str = "#00c2cb",
) -> Dict[str, str]:
    """Playwright renders header/footer templates in an isolated context with
    no access to the page's own stylesheet, so every style is inlined here.
    `pageNumber`/`totalPages` are Playwright's own built-in span classes,
    populated automatically - do not compute page counts manually.
    """
    safe_name = (org_name or "").strip() or "Aicser"
    logo_html = (
        f'<img src="{org_logo_url}" style="height:14px;width:auto;border-radius:3px;'
        f'margin-right:6px;vertical-align:middle;" />'
        if org_logo_url
        else ""
    )
    header_template = f"""
    <div style="font-size:9px;width:100%;padding:0 14mm;display:flex;align-items:center;
                color:#6b7280;font-family:-apple-system,sans-serif;">
        {logo_html}<span style="vertical-align:middle;">{safe_name}</span>
    </div>
    """
    footer_template = f"""
    <div style="font-size:9px;width:100%;padding:0 14mm;display:flex;justify-content:space-between;
                color:#6b7280;font-family:-apple-system,sans-serif;border-top:1px solid {accent_color}33;
                padding-top:4px;">
        <span>{safe_name}</span>
        <span><span class="pageNumber"></span>&nbsp;/&nbsp;<span class="totalPages"></span></span>
    </div>
    """
    return {"header_template": header_template, "footer_template": footer_template}


def default_pagination_pdf_options(
    *,
    org_name: Optional[str] = None,
    org_logo_url: Optional[str] = None,
    accent_color: str = "#00c2cb",
) -> Dict[str, Any]:
    """PDF options for a paginated document export (reports) - repeating
    header/footer with page numbers and room in the margins for them.
    Dashboard exports (a single visual snapshot, not a paginated narrative)
    should NOT use this - pass no `pdf_options` for those instead."""
    templates = build_pdf_header_footer(org_name=org_name, org_logo_url=org_logo_url, accent_color=accent_color)
    return {
        "margin": {"top": "18mm", "bottom": "14mm", "left": "10mm", "right": "10mm"},
        "display_header_footer": True,
        **templates,
    }
