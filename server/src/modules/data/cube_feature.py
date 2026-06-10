"""Feature flag for external Cube.js HTTP integration."""

from __future__ import annotations

import os


def is_external_cube_enabled() -> bool:
    """Return True when legacy Cube.js HTTP paths are allowed."""
    return os.getenv("AICSER_EXTERNAL_CUBE_ENABLED", "false").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
