"""Find the real table inside a spreadsheet sheet.

Spreadsheets often start with a title, blank rows or a notes column, so reading row 1
as headers yields ``Unnamed: 0`` columns and empty rows. ``detect_table`` takes a sheet
read with ``header=None`` and returns the table with its header row promoted, the same
first step Power Query and Tableau Prep apply on import.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

import pandas as pd

# Only look this far down for the header row; titles and notes sit at the top.
_HEADER_SCAN_ROWS = 25
# A header row fills at least this share of the table's columns.
_MIN_HEADER_FILL = 0.5


@dataclass
class TableDetection:
    header_row: int | None  # 0-based row in the original sheet, None if no header found
    skipped_rows: int  # rows above the header that were not part of the table
    dropped_empty_rows: int
    dropped_empty_columns: int
    renamed_columns: List[str] = field(default_factory=list)

    @property
    def changed(self) -> bool:
        return bool(
            self.skipped_rows
            or self.dropped_empty_rows
            or self.dropped_empty_columns
            or self.renamed_columns
            or self.header_row is None
        )


def _is_blank(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and pd.isna(value):
        return True
    return isinstance(value, str) and not value.strip()


def _is_label(value: object) -> bool:
    """A header cell is text that is not just a number or a date."""
    if not isinstance(value, str) or not value.strip():
        return False
    try:
        float(value.replace(",", ""))
        return False
    except ValueError:
        return True


def _unique_names(raw: List[object]) -> tuple[List[str], List[str]]:
    names: List[str] = []
    renamed: List[str] = []
    seen: dict[str, int] = {}
    for idx, value in enumerate(raw, start=1):
        name = "" if _is_blank(value) else str(value).strip()
        if not name:
            name = f"column_{idx}"
            renamed.append(name)
        if name in seen:
            seen[name] += 1
            new_name = f"{name}_{seen[name]}"
            renamed.append(new_name)
            name = new_name
        else:
            seen[name] = 1
        names.append(name)
    return names, renamed


def detect_table(raw: pd.DataFrame) -> tuple[pd.DataFrame, TableDetection]:
    """Return ``raw`` (read with ``header=None``) as a table with proper headers."""
    blank = raw.map(_is_blank) if hasattr(raw, "map") else raw.applymap(_is_blank)
    keep_cols = ~blank.all(axis=0)
    keep_rows = ~blank.all(axis=1)
    dropped_cols = int((~keep_cols).sum())
    trimmed = raw.loc[keep_rows, keep_cols]
    dropped_rows = int((~keep_rows).sum())

    if trimmed.empty:
        return trimmed.reset_index(drop=True), TableDetection(None, 0, dropped_rows, dropped_cols)

    width = trimmed.shape[1]
    header_pos = None
    for pos in range(min(_HEADER_SCAN_ROWS, len(trimmed))):
        row = list(trimmed.iloc[pos])
        filled = [v for v in row if not _is_blank(v)]
        labels = [v for v in filled if _is_label(v)]
        if len(filled) / width >= _MIN_HEADER_FILL and len(labels) >= max(1, len(filled) * 0.8):
            # A lone label above a full-width row is a title, not a header.
            if len(filled) == 1 and width > 1:
                continue
            header_pos = pos
            break

    if header_pos is None:
        names, renamed = _unique_names([None] * width)
        body = trimmed.copy()
        body.columns = names
        return body.reset_index(drop=True), TableDetection(None, 0, dropped_rows, dropped_cols, renamed)

    names, renamed = _unique_names(list(trimmed.iloc[header_pos]))
    body = trimmed.iloc[header_pos + 1 :].copy()
    body.columns = names
    body = body.infer_objects()
    header_row = int(trimmed.index[header_pos])
    return body.reset_index(drop=True), TableDetection(
        header_row=header_row,
        skipped_rows=header_pos,
        dropped_empty_rows=dropped_rows,
        dropped_empty_columns=dropped_cols,
        renamed_columns=renamed,
    )


def read_excel_table(path: str, sheet_name: str | int | None = 0) -> tuple[pd.DataFrame, TableDetection]:
    raw = pd.read_excel(path, sheet_name=sheet_name if sheet_name is not None else 0, header=None)
    return detect_table(raw)
