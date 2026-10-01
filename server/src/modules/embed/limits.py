"""What an anonymous viewer (embedded or public dashboard) may pull out of a data source.

Anything sent to a browser can be copied from its developer tools, whatever the page shows, so
the real limit on a public embed is what the server sends. Charts are aggregated and small;
a table widget or a "dot for each row" scatter can carry thousands of raw rows. Anonymous reads
are capped (Metabase caps embeds at 2,000 rows the same way); signed-in viewers are not.
"""

from __future__ import annotations

import os
from typing import Any

DEFAULT_EMBED_MAX_ROWS = 2000
DOWNLOAD_LEVELS = ("none", "image", "data")


def embed_row_cap() -> int:
    try:
        return max(1, int(os.getenv("EMBED_MAX_ROWS", DEFAULT_EMBED_MAX_ROWS)))
    except ValueError:
        return DEFAULT_EMBED_MAX_ROWS


def cap_rows(data: Any, cap: int | None) -> Any:
    """Trim a chart result ({x, y, series: [{data}], rows, …}) to ``cap`` rows and mark it
    ``truncated`` so the viewer can say so. Results under the cap come back unchanged."""
    if not cap or not isinstance(data, dict):
        return data
    out = dict(data)
    truncated = False
    for key, value in data.items():
        if key in ("columns", "series"):
            continue
        if isinstance(value, list) and len(value) > cap:
            out[key] = value[:cap]
            truncated = True
    series = data.get("series")
    if isinstance(series, list):
        trimmed = []
        for s in series:
            if isinstance(s, dict) and isinstance(s.get("data"), list) and len(s["data"]) > cap:
                s = {**s, "data": s["data"][:cap]}
                truncated = True
            trimmed.append(s)
        out["series"] = trimmed
    if truncated:
        out["truncated"] = True
        out["row_cap"] = cap
    return out
