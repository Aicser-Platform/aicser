"""Deterministic ingest-time cleaning: null tokens, numeric coercion, date parsing.

Applied once at upload so the stored parquet is typed. Never renames data columns
(only trims whitespace), never drops rows — every action is recorded in the report.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Tuple

import pandas as pd

NULL_TOKENS = {"", "n/a", "na", "null", "none", "-", "--", "nan", "#n/a"}

# "$1,234.50", "€2 000", "10%", "-5.2", "+1,000"
_NUMERIC_RE = re.compile(
    r"^\s*[-+]?\s*[$€£]?\s*\d{1,3}(?:[,\s]\d{3})*(?:\.\d+)?\s*%?\s*$"
    r"|^\s*[-+]?\s*[$€£]?\s*\d+(?:\.\d+)?\s*%?\s*$"
)
# "2024-01-15", "15/01/2024", "2024/1/5", "15.01.2024"
_DATE_HINT_RE = re.compile(
    r"^\s*\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T].*)?\s*$"
    r"|^\s*\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s*$"
)

_COERCE_THRESHOLD = 0.9  # ≥90% of non-null values must qualify


@dataclass
class CleaningReport:
    column_actions: Dict[str, List[str]] = field(default_factory=dict)
    null_tokens_replaced: int = 0
    duplicate_row_count: int = 0

    def add(self, column: str, action: str) -> None:
        self.column_actions.setdefault(column, [])
        if action not in self.column_actions[column]:
            self.column_actions[column].append(action)

    def to_dict(self) -> dict:
        return {
            "column_actions": self.column_actions,
            "null_tokens_replaced": int(self.null_tokens_replaced),
            "duplicate_row_count": int(self.duplicate_row_count),
        }


def _strip_numeric_symbols(value: str) -> str:
    return re.sub(r"[$€£,%\s]", "", value)


def _share_matching(series: pd.Series, pattern: re.Pattern) -> float:
    non_null = series.dropna().astype(str)
    if len(non_null) == 0:
        return 0.0
    return float(non_null.str.match(pattern).mean())


def clean_dataframe(df: pd.DataFrame) -> Tuple[pd.DataFrame, CleaningReport]:
    report = CleaningReport()
    out = df.copy()

    # 1. Trim whitespace from column names (never rename beyond that).
    renames = {c: str(c).strip() for c in out.columns if str(c).strip() != str(c)}
    if renames:
        out = out.rename(columns=renames)
        for old, new in renames.items():
            report.add(new, "trimmed_column_name")

    for col in out.columns:
        series = out[col]
        if series.dtype != object:
            continue

        # 2. Trim string cells.
        stripped = series.astype(str).str.strip().where(series.notna(), other=pd.NA)
        if not stripped.equals(series):
            report.add(col, "trimmed_values")
        series = stripped

        # 3. Normalize null tokens.
        lowered = series.astype(str).str.lower()
        null_mask = series.notna() & lowered.isin(NULL_TOKENS)
        n_nulls = int(null_mask.sum())
        if n_nulls:
            series = series.mask(null_mask, other=pd.NA)
            report.null_tokens_replaced += n_nulls
            report.add(col, "normalized_null_tokens")

        # 4. Numeric coercion (currency / percent / thousands separators).
        if _share_matching(series, _NUMERIC_RE) >= _COERCE_THRESHOLD:
            cleaned = series.dropna().astype(str)
            had_percent = bool(cleaned.str.contains("%", regex=False).any())
            numeric = pd.to_numeric(
                series.astype(str).map(
                    lambda v: _strip_numeric_symbols(v) if isinstance(v, str) else v
                ),
                errors="coerce",
            )
            out[col] = numeric
            report.add(col, "coerced_numeric")
            if had_percent:
                report.add(col, "stripped_percent")
            continue

        # 5. Date parsing — only for date-shaped strings, never numeric leftovers.
        if _share_matching(series, _DATE_HINT_RE) >= _COERCE_THRESHOLD:
            parsed = pd.to_datetime(series, errors="coerce", format="mixed", dayfirst=False)
            non_null = series.notna().sum()
            if non_null > 0 and parsed.notna().sum() / non_null >= _COERCE_THRESHOLD:
                out[col] = parsed
                report.add(col, "parsed_date")
                continue

        out[col] = series

    report.duplicate_row_count = int(out.duplicated().sum())
    return out, report
