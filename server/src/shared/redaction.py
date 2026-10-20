"""Redact personal data from free text (document chunks) before it is indexed or sent to a model.

Only patterns that can be told apart reliably are replaced: email addresses, phone numbers,
payment card numbers (Luhn-checked) and IBANs (checksum-checked). Each match becomes a label such
as "[email]", and the counts are returned so a document can say what was removed.
"""

from __future__ import annotations

import re
from typing import Dict, Tuple

_EMAIL = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_IBAN = re.compile(r"\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b")
_CARD = re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])")
_DATE = re.compile(r"^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$")
# +855 12 345 678, (012) 345-678, 012-345-6789: a leading + or 0/( and 8-15 digits in all.
_PHONE = re.compile(r"(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|0\d{1,3}[\s.-]?)?\d{2,4}(?:[\s.-]?\d{2,4}){1,3}(?![\w])")


def _luhn(digits: str) -> bool:
    total, double = 0, False
    for ch in reversed(digits):
        n = int(ch)
        if double:
            n = n * 2 - 9 if n > 4 else n * 2
        total += n
        double = not double
    return total % 10 == 0


def _iban_ok(raw: str) -> bool:
    value = raw.replace(" ", "")
    if not 15 <= len(value) <= 34:
        return False
    moved = value[4:] + value[:4]
    numeric = "".join(str(int(ch, 36)) for ch in moved)
    return int(numeric) % 97 == 1


def redact(text: str) -> Tuple[str, Dict[str, int]]:
    """Text with personal data replaced, and how many of each kind were found."""
    counts: Dict[str, int] = {}

    def sub(pattern: re.Pattern, label: str, keep=lambda m: True):
        nonlocal text

        def repl(m: re.Match) -> str:
            if not keep(m):
                return m.group(0)
            counts[label] = counts.get(label, 0) + 1
            return f"[{label}]"

        text = pattern.sub(repl, text)

    if not text:
        return text, counts
    sub(_EMAIL, "email")
    sub(_IBAN, "iban", lambda m: _iban_ok(m.group(0)))
    sub(_CARD, "card", lambda m: (lambda d: 13 <= len(d) <= 19 and _luhn(d))(re.sub(r"\D", "", m.group(0))))
    sub(_PHONE, "phone", lambda m: 8 <= len(re.sub(r"\D", "", m.group(0))) <= 15
        and bool(re.match(r"[+(0]", m.group(0))) and not _DATE.match(m.group(0).strip()))
    return text, counts
