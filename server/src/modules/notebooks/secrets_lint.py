"""Scan notebook cells for likely secrets (API keys, tokens) before share or certify."""
from __future__ import annotations

import re
from typing import Any, Dict, List

_PATTERNS: List[tuple[str, re.Pattern[str]]] = [
    ("aws_access_key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("aws_secret", re.compile(r"(?i)aws[_-]?secret[_-]?access[_-]?key\s*[=:]\s*['\"]?[A-Za-z0-9/+=]{20,}")),
    ("openai_key", re.compile(r"sk-[A-Za-z0-9]{20,}")),
    ("bearer_token", re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]{20,}")),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC )?PRIVATE KEY-----")),
    ("password_literal", re.compile(r"(?i)(?:password|passwd|pwd)\s*[=:]\s*['\"][^'\"]{8,}['\"]")),
    ("connection_string", re.compile(r"(?i)(?:postgres|mysql|mongodb)(?:\+[a-z]+)?://[^\s'\"]+:[^\s'\"@]+@")),
]


def lint_cells(cells: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    findings: List[Dict[str, Any]] = []
    for cell in cells:
        src = cell.get("source") if isinstance(cell.get("source"), str) else ""
        if not src:
            continue
        for kind, pat in _PATTERNS:
            if pat.search(src):
                findings.append({
                    "cell_id": cell.get("id"),
                    "kind": kind,
                    "message": f"Possible {kind.replace('_', ' ')} in cell {cell.get('id', '?')}",
                })
                break
    return findings
