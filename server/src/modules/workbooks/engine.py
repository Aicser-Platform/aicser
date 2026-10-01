"""The IronCalc engine on the server: blank workbooks, .xlsx import and export, and checking a
saved document is a real workbook. The browser runs the same engine (WebAssembly), so a
document saved there opens here unchanged and vice versa.

Imported files are cleaned of formulas that could run something outside the sheet when the
file is later opened in Excel (DDE links such as ``=cmd|' /C calc'!A0``, CALL/REGISTER/EXEC,
WEBSERVICE): they are kept as visible text instead.
"""

from __future__ import annotations

import os
import re
import tempfile
from typing import Any, Dict, List

MAX_DOC_BYTES = 25 * 1024 * 1024
MAX_XLSX_BYTES = 20 * 1024 * 1024
DEFAULT_LOCALE = "en"
LANGUAGE = "en"

_DANGEROUS = re.compile(
    r"^=\s*(?:[-+@]?\s*)?(?:[A-Za-z0-9_.]+\s*\|)|\b(?:CALL|REGISTER|REGISTER\.ID|EXEC|WEBSERVICE|FILTERXML)\s*\(",
    re.IGNORECASE,
)


class WorkbookError(ValueError):
    """A document or file that isn't a usable workbook (shown to the user)."""


def _ic():
    import ironcalc  # MIT/Apache-2.0

    return ironcalc


def locale_for(locale: str | None) -> str:
    try:
        supported = set(_ic().get_supported_locales())
    except Exception:
        supported = {DEFAULT_LOCALE}
    return locale if locale in supported else DEFAULT_LOCALE


def timezone_for(tz: str | None) -> str:
    try:
        return tz if tz and tz in set(_ic().get_all_timezones()) else "UTC"
    except Exception:
        return "UTC"


def new_doc(title: str, locale: str = DEFAULT_LOCALE, tz: str = "UTC") -> bytes:
    m = _ic().create(title[:120] or "Workbook", locale_for(locale), timezone_for(tz), LANGUAGE)
    return bytes(m.to_bytes())


def summary(doc: bytes) -> Dict[str, Any]:
    """Sheets of a saved document; raises WorkbookError when it isn't one."""
    if not doc:
        raise WorkbookError("The workbook is empty.")
    if len(doc) > MAX_DOC_BYTES:
        raise WorkbookError("This workbook is too large to save (over 25 MB). Remove data or split it.")
    try:
        m = _ic().load_from_bytes(bytes(doc), LANGUAGE)
        return {"sheets": [s.get("name") for s in m.get_worksheets_properties()]}
    except Exception as exc:
        raise WorkbookError("That isn't a workbook this version can read.") from exc


def _neutralize(model: Any) -> int:
    """Formulas that reach outside the workbook become text. Returns how many were changed."""
    changed = 0
    for sheet, row, col in model.get_all_cells():
        try:
            content = model.get_cell_content(sheet, row, col) or ""
        except Exception:
            continue
        if content.startswith("=") and _DANGEROUS.search(content):
            model.set_user_input(sheet, row, col, "'" + content)
            changed += 1
    return changed


def from_xlsx(data: bytes, locale: str = DEFAULT_LOCALE, tz: str = "UTC") -> Dict[str, Any]:
    """An .xlsx upload as a workbook document: {doc, sheets, neutralized}."""
    if not data:
        raise WorkbookError("The file is empty.")
    if len(data) > MAX_XLSX_BYTES:
        raise WorkbookError("Excel files up to 20 MB can be imported.")
    if data[:2] != b"PK":
        raise WorkbookError("Only .xlsx files can be imported (not .xls or .csv).")
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "upload.xlsx")
        with open(path, "wb") as f:
            f.write(data)
        try:
            model = _ic().load_from_xlsx(path, locale_for(locale), timezone_for(tz), LANGUAGE)
        except Exception as exc:
            raise WorkbookError("This Excel file couldn't be read.") from exc
    neutralized = _neutralize(model)
    model.evaluate()
    doc = bytes(model.to_bytes())
    return {"doc": doc, "sheets": [s.get("name") for s in model.get_worksheets_properties()],
            "neutralized": neutralized}


def to_xlsx(doc: bytes) -> bytes:
    try:
        model = _ic().load_from_bytes(bytes(doc), LANGUAGE)
    except Exception as exc:
        raise WorkbookError("That isn't a workbook this version can read.") from exc
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "out.xlsx")
        model.save_to_xlsx(path)
        with open(path, "rb") as f:
            return f.read()


def sheet_names(doc: bytes) -> List[str]:
    return summary(doc)["sheets"]
