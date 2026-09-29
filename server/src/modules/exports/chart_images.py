"""Chart images for documents: ECharts options drawn exactly as the app draws them.

Word, PowerPoint and fallback PDFs need charts as pictures. Rather than redraw them with a
second charting library (which would never match what people saw), one headless Chromium
opens the chrome-free `/embed/chart-render` page — which holds no data and needs no token —
hands it each option in turn, and screenshots the result. One browser launch per export,
however many charts; each image is cached by the option's content, so exporting the same
answer again (as another format, or by someone else) costs nothing.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Sequence

from src.core.config import settings

logger = logging.getLogger(__name__)

_CACHE: "OrderedDict[str, bytes]" = OrderedDict()
_CACHE_MAX = 64
MAX_CHARTS = 8


def _key(option: Dict[str, Any], width: int, height: int, theme: str) -> str:
    raw = json.dumps(option, sort_keys=True, default=str) + f"|{width}x{height}|{theme}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _remember(key: str, png: bytes) -> None:
    _CACHE[key] = png
    _CACHE.move_to_end(key)
    while len(_CACHE) > _CACHE_MAX:
        _CACHE.popitem(last=False)


def printable(option: Dict[str, Any]) -> Dict[str, Any]:
    """The option for a static picture: no animation, no interactive-only parts, title kept."""
    out = {k: v for k, v in option.items() if not str(k).startswith("_") and k not in ("sql_query", "view_label")}
    out["animation"] = False
    out.pop("toolbox", None)
    out.pop("dataZoom", None)
    return out


async def render_chart_images(
    options: Sequence[Dict[str, Any]],
    *,
    width: int = 1000,
    height: int = 540,
    theme: str = "light",
) -> List[Optional[bytes]]:
    """PNG for each option (None where one couldn't be drawn). Never raises: a document is still
    produced without its charts if the browser isn't available."""
    opts = [printable(o) for o in list(options)[:MAX_CHARTS] if isinstance(o, dict)]
    out: List[Optional[bytes]] = [None] * len(opts)
    todo = []
    for i, o in enumerate(opts):
        k = _key(o, width, height, theme)
        if k in _CACHE:
            _CACHE.move_to_end(k)
            out[i] = _CACHE[k]
        else:
            todo.append((i, k, o))
    if not todo:
        return out
    base = (settings.INTERNAL_FRONTEND_URL or settings.FRONTEND_URL or "http://localhost:3000").rstrip("/")
    url = f"{base}/embed/chart-render?w={width}&h={height}&theme={'dark' if theme == 'dark' else 'light'}"
    try:
        from playwright.async_api import async_playwright  # type: ignore

        from src.modules.exports.playwright_export_service import browser_slot

        async with browser_slot(), async_playwright() as pw:
            browser = await pw.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
            try:
                page = await browser.new_page(viewport={"width": width + 40, "height": height + 40}, device_scale_factor=2)
                await page.goto(url, wait_until="load", timeout=30000)
                await page.wait_for_function("() => typeof window.__renderChart === 'function'", timeout=20000)
                for i, k, o in todo:
                    try:
                        ok = await page.evaluate("(o) => window.__renderChart(o)", o)
                        if not ok:
                            continue
                        png = await page.locator("#chart").screenshot(type="png")
                        out[i] = png
                        _remember(k, png)
                    except Exception as exc:  # one bad option doesn't sink the rest
                        logger.info("chart image %s skipped: %s", i, exc)
            finally:
                await browser.close()
    except Exception as exc:
        logger.warning("Chart images unavailable (%s); documents will omit charts", exc)
    return out
