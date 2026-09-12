"""
PII feature toggles — single source of truth.

Two switches only (avoid overlapping names):

1. ``AISER_PII_DETECTION`` (default **true**)
   Once-per-dataset column classification + mask those columns in **LLM prompt
   copies only**. Charts, tables, and stored query results stay unmasked.

2. ``AISER_PII_GATE_ENABLED`` (default **false**)
   Presidio/regex scrub of free-text LLM prompts and outputs. Opt-in; can
   false-positive on business phrasing.

Legacy alias: ``AISER_PII_COLUMN_MASKING`` — if set and ``AISER_PII_DETECTION``
is unset, it controls the same structured path as (1). Prefer DETECTION.
"""

from __future__ import annotations

import os


def _env_flag(name: str, default: str) -> bool:
    raw = os.getenv(name)
    if raw is None or str(raw).strip() == "":
        raw = default
    return str(raw).strip().lower() not in ("0", "false", "no")


def is_pii_detection_enabled() -> bool:
    """
    Structured PII: classify columns + mask LLM-bound samples/rows.

    Canonical env: AISER_PII_DETECTION (default true).
    Legacy: AISER_PII_COLUMN_MASKING when DETECTION is unset.
    """
    if os.getenv("AISER_PII_DETECTION") is not None and str(os.getenv("AISER_PII_DETECTION")).strip() != "":
        return _env_flag("AISER_PII_DETECTION", "true")
    if os.getenv("AISER_PII_COLUMN_MASKING") is not None and str(os.getenv("AISER_PII_COLUMN_MASKING")).strip() != "":
        return _env_flag("AISER_PII_COLUMN_MASKING", "true")
    return True


def is_pii_text_gate_enabled() -> bool:
    """Free-text Presidio/regex gate for LLM messages/output. Default off."""
    return _env_flag("AISER_PII_GATE_ENABLED", "false")
