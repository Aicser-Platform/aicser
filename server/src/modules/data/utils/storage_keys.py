"""Safe object-storage key fragments (basename only, no path traversal)."""
from __future__ import annotations

import os
import re
import uuid


_UNSAFE = re.compile(r"[^\w.\-]+")


def safe_object_filename(filename: str | None, *, prefix_uuid: bool = True) -> str:
    """Return a path-safe filename for S3/Azure/local object keys.

    Strips directories (`../evil`), replaces unsafe characters, and optionally
    prefixes a short UUID so original names cannot collide or overwrite.
    """
    raw = (filename or "").replace("\\", "/")
    base = os.path.basename(raw).strip()
    cleaned = _UNSAFE.sub("_", base).strip("._") or "file"
    cleaned = cleaned[:180]
    if not prefix_uuid:
        return cleaned
    return f"{uuid.uuid4().hex[:12]}_{cleaned}"
