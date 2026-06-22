"""Strip likely secrets from LLM/provider errors before returning to clients."""

from __future__ import annotations

import re

_MAX_CLIENT_ERROR_LEN = 500

_PATTERNS = (
    (re.compile(r"sk-[a-zA-Z0-9]{8,}"), "sk-***"),
    (re.compile(r"sk-proj-[a-zA-Z0-9_-]{8,}"), "sk-proj-***"),
    (re.compile(r"(?i)(api[_-]?key\s*[:=]\s*)[^\s,;'\"]+"), r"\1***"),
    (re.compile(r"(?i)(bearer\s+)[a-zA-Z0-9._-]+"), r"\1***"),
    (re.compile(r"(?i)(authorization\s*[:=]\s*)[^\s,;'\"]+"), r"\1***"),
    (re.compile(r"eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+"), "***jwt***"),
    (re.compile(r"gAAAAA[a-zA-Z0-9_-]{20,}"), "***"),
)


def sanitize_client_error(message: str | None) -> str:
    if not message:
        return "Request failed"
    text = str(message).strip()
    for pattern, repl in _PATTERNS:
        text = pattern.sub(repl, text)
    if len(text) > _MAX_CLIENT_ERROR_LEN:
        return text[: _MAX_CLIENT_ERROR_LEN - 1] + "…"
    return text
