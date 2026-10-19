"""Ingest-time data profiling in DuckDB.

Deliberately separate from `ee/modules/ai/utils/data_profiler.py`, which profiles
a query result for forecasting. This one answers a different question: is this
file fit to ingest?
"""

from __future__ import annotations

import time
from typing import Any, List, Optional

from src.modules.prep.engine.profile_models import (AssetProfile, ColumnProfile,
                                                 KeyCandidate, TopValue)

TYPE_CANDIDATES: tuple[str, ...] = ("bigint", "double", "boolean", "date", "timestamp")
INFERENCE_THRESHOLD = 0.90
NULL_TOKENS: tuple[str, ...] = ("na", "n/a", "null", "none", "nan", "-", "--", "?")
BOOLISH_TOKENS: tuple[str, ...] = (
    "true",
    "false",
    "yes",
    "no",
    "y",
    "n",
    "t",
    "f",
    "0",
    "1",
)
# Same day-first / US formats the Silver compiler uses (see silverCompiler DATE_FORMATS).
DATE_PARSE_FORMATS: tuple[str, ...] = (
    "%d-%m-%Y",
    "%d/%m/%Y",
    "%m/%d/%Y",
    "%Y/%m/%d",
    "%Y%m%d",
)

COLUMN_CHUNK = 25
TOP_VALUES_LIMIT = 10
TOP_VALUES_MAX_DISTINCT = 1000


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _lit(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _aggregate_exprs(column: str) -> List[str]:
    """Every statistic for one column, as scalar aggregate expressions."""
    col = _q(column)
    text = f"CAST({col} AS VARCHAR)"
    tokens = ", ".join(_lit(t) for t in NULL_TOKENS)
    exprs = [
        f"COUNT({col})",
        f"COUNT(DISTINCT {col})",
        f"MIN({text})",
        f"MAX({text})",
        f"SUM(CASE WHEN {col} IS NOT NULL AND TRIM({text}) = '' THEN 1 ELSE 0 END)",
        f"SUM(CASE WHEN LOWER(TRIM({text})) IN ({tokens}) THEN 1 ELSE 0 END)",
    ]
    exprs += [f"COUNT(TRY_CAST({col} AS {target}))" for target in TYPE_CANDIDATES]
    us_num = f"REPLACE(REPLACE(REPLACE(REPLACE(TRIM({text}), '$', ''), '€', ''), ',', ''), ' ', '')"
    eu_num = f"REPLACE(REPLACE(REPLACE(REPLACE(TRIM({text}), '€', ''), '$', ''), '.', ''), ',', '.')"
    currency = f"COALESCE(TRY_CAST({us_num} AS DOUBLE), TRY_CAST({eu_num} AS DOUBLE))"
    date_tries = " OR ".join(
        [f"TRY_CAST({col} AS DATE) IS NOT NULL"]
        + [f"TRY_STRPTIME({text}, {_lit(fmt)}) IS NOT NULL" for fmt in DATE_PARSE_FORMATS]
    )
    ts_tries = (
        f"TRY_CAST({col} AS TIMESTAMP) IS NOT NULL OR "
        + " OR ".join(
            f"TRY_STRPTIME({text}, {_lit(fmt + ' %H:%M:%S')}) IS NOT NULL"
            for fmt in DATE_PARSE_FORMATS[:4]
        )
    )
    bool_list = ", ".join(_lit(t) for t in BOOLISH_TOKENS)
    exprs += [
        f"COUNT({currency})",
        f"SUM(CASE WHEN {date_tries} THEN 1 ELSE 0 END)",
        f"SUM(CASE WHEN {ts_tries} THEN 1 ELSE 0 END)",
        f"SUM(CASE WHEN LOWER(TRIM({text})) IN ({bool_list}) THEN 1 ELSE 0 END)",
        f"SUM(CASE WHEN regexp_matches(TRIM({text}), '^0[0-9]+$') THEN 1 ELSE 0 END)",
        f"SUM(CASE WHEN {text} LIKE '%:%' THEN 1 ELSE 0 END)",
    ]
    return exprs


def _infer(
    non_null: int,
    cast_counts: List[int],
    extras: List[int],
    distinct: int,
) -> tuple[str, float]:
    """Prefer semantic types (boolean, date, timestamp) over bigint, like Power Query.

    A type must cover 90% of present values. Currency symbols and common date
    locales are tried; zero-padded digit strings stay text so zip/account codes
    are not turned into numbers.
    """
    if non_null == 0:
        return "varchar", 0.0

    bigint_n, double_n, boolean_n, date_n, timestamp_n = cast_counts
    currency_n, parsed_date_n, parsed_ts_n, boolish_n, leading_zeros, timeish = extras
    date_n = max(date_n, parsed_date_n)
    timestamp_n = max(timestamp_n, parsed_ts_n)
    double_n = max(double_n, currency_n)

    def ratio(survived: int) -> float:
        return survived / non_null

    scores = {
        "boolean": ratio(max(boolean_n, boolish_n))
        if distinct <= 4
        else ratio(boolean_n),
        "date": ratio(date_n),
        "timestamp": ratio(timestamp_n),
        "bigint": 0.0 if leading_zeros else ratio(bigint_n),
        "double": 0.0 if leading_zeros else ratio(double_n),
    }
    if timeish and scores["timestamp"] >= INFERENCE_THRESHOLD:
        return "timestamp", scores["timestamp"]
    for target in ("boolean", "date", "timestamp", "bigint", "double"):
        if scores[target] >= INFERENCE_THRESHOLD:
            return target, scores[target]
    return "varchar", max(scores.values())


def profile_object(
    scan_sql: str,
    *,
    sample_rows: Optional[int] = None,
    connection: Optional[Any] = None,
) -> AssetProfile:
    """Profile the rows produced by `scan_sql`.

    `sample_rows` profiles a sample while still reporting the true row count, so
    the UI can label the figures as estimates without lying about size.
    """
    started = time.monotonic()

    if connection is None:
        from src.modules.prep.engine.executor import connect

        connection = connect()
    conn = connection

    conn.execute(f"CREATE OR REPLACE TEMP VIEW _profile_src AS {scan_sql}")
    row_count = conn.execute("SELECT COUNT(*) FROM _profile_src").fetchone()[0]

    sampled = bool(sample_rows and row_count > sample_rows)
    if sampled:
        conn.execute(
            "CREATE OR REPLACE TEMP VIEW _profile_scan AS "
            f"SELECT * FROM _profile_src USING SAMPLE {int(sample_rows)} ROWS"
        )
    else:
        conn.execute(
            "CREATE OR REPLACE TEMP VIEW _profile_scan AS SELECT * FROM _profile_src"
        )

    described = conn.execute("DESCRIBE _profile_scan").fetchall()
    names = [row[0] for row in described]
    storage_types = {row[0]: str(row[1]) for row in described}

    scanned = conn.execute("SELECT COUNT(*) FROM _profile_scan").fetchone()[0]

    profiles: List[ColumnProfile] = []
    for start in range(0, len(names), COLUMN_CHUNK):
        chunk = names[start : start + COLUMN_CHUNK]
        select = ", ".join(expr for name in chunk for expr in _aggregate_exprs(name))
        row = conn.execute(f"SELECT {select} FROM _profile_scan").fetchone()

        extra = 6
        width = 6 + len(TYPE_CANDIDATES) + extra
        for index, name in enumerate(chunk):
            values = row[index * width : (index + 1) * width]
            non_null, distinct, min_v, max_v, blanks, tokens = values[:6]
            casts = [int(v or 0) for v in values[6 : 6 + len(TYPE_CANDIDATES)]]
            extras = [int(v or 0) for v in values[6 + len(TYPE_CANDIDATES) :]]
            inferred, confidence = _infer(int(non_null), casts, extras, int(distinct))
            nulls = scanned - int(non_null)
            profiles.append(
                ColumnProfile(
                    name=name,
                    storage_type=storage_types[name],
                    inferred_type=inferred,
                    inference_confidence=round(confidence, 4),
                    null_count=nulls,
                    null_ratio=round(nulls / scanned, 4) if scanned else 0.0,
                    distinct_count=int(distinct),
                    is_unique=bool(scanned and nulls == 0 and int(distinct) == scanned),
                    min_value=None if min_v is None else str(min_v),
                    max_value=None if max_v is None else str(max_v),
                    blank_count=int(blanks or 0),
                    null_token_count=int(tokens or 0),
                )
            )

    eligible = [p for p in profiles if 0 < p.distinct_count <= TOP_VALUES_MAX_DISTINCT]
    if eligible and scanned:
        branches = [
            f"(SELECT {_lit(p.name)} AS c, CAST({_q(p.name)} AS VARCHAR) AS v, "
            f"COUNT(*) AS n FROM _profile_scan GROUP BY 2 ORDER BY n DESC, v "
            f"LIMIT {TOP_VALUES_LIMIT})"
            for p in eligible
        ]
        by_name = {p.name: p for p in profiles}
        for column, value, count in conn.execute(
            " UNION ALL ".join(branches)
        ).fetchall():
            by_name[column].top_values.append(TopValue(value=value, count=int(count)))
        for profile in eligible:
            profile.top_values.sort(key=lambda top: (-top.count, top.value or ""))

    candidates = [
        KeyCandidate(
            column=profile.name,
            distinct_ratio=round(profile.distinct_count / scanned, 4)
            if scanned
            else 0.0,
            duplicate_count=max(
                0, (scanned - profile.null_count) - profile.distinct_count
            ),
            is_unique=profile.is_unique,
        )
        for profile in profiles
    ]
    candidates.sort(
        key=lambda candidate: (
            not candidate.is_unique,
            -candidate.distinct_ratio,
            candidate.column,
        )
    )

    return AssetProfile(
        row_count=int(row_count),
        sampled=sampled,
        columns=profiles,
        key_candidates=candidates,
        duration_ms=int((time.monotonic() - started) * 1000),
    )
