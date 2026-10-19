"""Turn profile findings into runnable pipeline steps.

Every `suggested_step` is a single-key payload that `parse_step` accepts
verbatim, so later UI work can offer one-click fixes without inventing step
types.
"""

from __future__ import annotations

from typing import List

from src.modules.prep.engine.profile_models import AssetProfile, Finding
from src.modules.prep.engine.profiler import INFERENCE_THRESHOLD

NUMERIC_TYPES = ("bigint", "double")
SUGGESTED_NULL_TOKENS = ["NA", "N/A", "null", "NULL", "None", "-"]


def suggest_steps(
    profile: AssetProfile, *, on_fail: str = "quarantine"
) -> List[Finding]:
    """Findings for one profiled asset, most actionable first."""
    findings: List[Finding] = []

    for column in profile.columns:
        if column.null_token_count > 0 or column.blank_count > 0:
            findings.append(
                Finding(
                    code="null_tokens",
                    severity="warning",
                    column=column.name,
                    message_key="onboarding.finding.null_tokens",
                    params={
                        "column": column.name,
                        "count": column.null_token_count + column.blank_count,
                    },
                    suggested_step={
                        "clean": {
                            "columns": [column.name],
                            "nulls": SUGGESTED_NULL_TOKENS,
                            "trim": True,
                        }
                    },
                )
            )

        likely_datetime = any(
            token in column.name.lower() for token in ("date", "time", "timestamp")
        )
        if 0 < column.inference_confidence < INFERENCE_THRESHOLD and likely_datetime:
            findings.append(
                Finding(
                    code="partially_parseable",
                    severity="warning",
                    column=column.name,
                    message_key="onboarding.finding.partially_parseable",
                    params={
                        "column": column.name,
                        "ratio": round(1 - column.inference_confidence, 4),
                    },
                    suggested_step={
                        "validate": {"not_null": [column.name], "on_fail": on_fail}
                    },
                )
            )

        if column.null_count > 0 and column.inferred_type in NUMERIC_TYPES:
            findings.append(
                Finding(
                    code="numeric_nulls",
                    severity="warning",
                    column=column.name,
                    message_key="onboarding.finding.numeric_nulls",
                    params={"column": column.name, "count": column.null_count},
                    suggested_step={"fill_na": {"values": {column.name: 0}}},
                )
            )

    duplicated = [
        candidate
        for candidate in profile.key_candidates
        if candidate.duplicate_count > 0 and candidate.distinct_ratio > 0.5
    ]
    if duplicated:
        best = min(duplicated, key=lambda candidate: (-candidate.distinct_ratio, candidate.column))
        findings.append(
            Finding(
                code="duplicate_keys",
                severity="error",
                column=best.column,
                message_key="onboarding.finding.duplicate_keys",
                params={"column": best.column, "count": best.duplicate_count},
                suggested_step={"dedupe": {"keys": [best.column]}},
            )
        )

    severity_order = {"error": 0, "warning": 1, "info": 2}
    findings.sort(key=lambda finding: (severity_order[finding.severity], finding.column or ""))
    return findings
