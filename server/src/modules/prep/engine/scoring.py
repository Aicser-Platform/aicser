"""Health scoring for a profiled asset.

Deliberately simple and documented rather than tuned: a user has to be able to
read the report and understand why the number is what it is. Weights live in one
table so adjusting them is a one-line change.
"""

from __future__ import annotations

from src.modules.prep.engine.profile_models import AssetProfile
from src.modules.prep.engine.profiler import INFERENCE_THRESHOLD

PENALTIES = {
    "mostly_null_column": 8,
    "partially_null_column": 4,
    "partially_parseable_column": 6,
    "dead_column": 10,
    "duplicate_keys": 15,
    "no_unique_column": 5,
    "empty_asset": 100,
}

PARTIAL_NULL_FLOOR = 0.05
MOSTLY_NULL_CEILING = 0.5


def health_score(profile: AssetProfile) -> int:
    """0-100. Starts at 100, subtracts documented penalties, floors at 0."""
    if profile.row_count == 0:
        return 0

    scanned = profile.row_count
    score = 100

    for column in profile.columns:
        dead = (column.null_token_count + column.blank_count) >= scanned
        if dead:
            score -= PENALTIES["dead_column"]
            continue

        if column.null_ratio > MOSTLY_NULL_CEILING:
            score -= PENALTIES["mostly_null_column"]
        elif column.null_ratio > PARTIAL_NULL_FLOOR:
            score -= PENALTIES["partially_null_column"]

        if 0 < column.inference_confidence < INFERENCE_THRESHOLD:
            score -= PENALTIES["partially_parseable_column"]

    has_duplicate_keys = any(
        candidate.duplicate_count > 0 for candidate in profile.key_candidates
    )
    if has_duplicate_keys:
        score -= PENALTIES["duplicate_keys"]

    if (
        not has_duplicate_keys
        and profile.key_candidates
        and not any(candidate.is_unique for candidate in profile.key_candidates)
    ):
        score -= PENALTIES["no_unique_column"]

    return max(0, score)
