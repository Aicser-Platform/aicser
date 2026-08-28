import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest  # noqa: E402


def _column(**overrides):
    from src.modules.pipeline.profile.models import ColumnProfile

    base = dict(
        name="c",
        storage_type="VARCHAR",
        inferred_type="varchar",
        inference_confidence=1.0,
        null_count=0,
        null_ratio=0.0,
        distinct_count=10,
        is_unique=False,
        blank_count=0,
        null_token_count=0,
    )
    base.update(overrides)
    return ColumnProfile(**base)


def _profile(columns, *, row_count=100, key_duplicates=0, has_unique=True):
    from src.modules.pipeline.profile.models import AssetProfile, KeyCandidate

    return AssetProfile(
        row_count=row_count,
        columns=columns,
        key_candidates=[
            KeyCandidate(
                column="c",
                distinct_ratio=1.0,
                duplicate_count=key_duplicates,
                is_unique=has_unique,
            )
        ],
    )


def test_a_clean_profile_scores_100():
    from src.modules.pipeline.profile.scoring import health_score

    assert health_score(_profile([_column(name="a"), _column(name="b")])) == 100


def test_zero_rows_scores_zero():
    from src.modules.pipeline.profile.scoring import health_score

    assert health_score(_profile([_column()], row_count=0)) == 0


@pytest.mark.parametrize(
    "column_kwargs,expected",
    [
        ({"null_ratio": 0.6}, 92),
        ({"null_ratio": 0.10}, 96),
        ({"inference_confidence": 0.5}, 94),
        ({"null_ratio": 0.10, "inference_confidence": 0.5}, 90),
    ],
)
def test_single_column_penalties(column_kwargs, expected):
    from src.modules.pipeline.profile.scoring import health_score

    assert health_score(_profile([_column(**column_kwargs)])) == expected


def test_an_entirely_empty_column_is_penalised_once_not_twice():
    """A column that is 100% null tokens is dead, not merely sparse."""
    from src.modules.pipeline.profile.scoring import health_score

    dead = _column(null_token_count=100, distinct_count=1)
    assert health_score(_profile([dead])) == 90


def test_duplicate_keys_are_the_heaviest_single_penalty():
    from src.modules.pipeline.profile.scoring import health_score

    assert (
        health_score(_profile([_column()], key_duplicates=12, has_unique=False)) == 85
    )


def test_no_unique_column_at_all_is_penalised():
    from src.modules.pipeline.profile.scoring import health_score

    assert health_score(_profile([_column()], has_unique=False)) == 95


def test_the_score_never_goes_below_zero():
    from src.modules.pipeline.profile.scoring import health_score

    wreckage = [
        _column(name=f"c{i}", null_ratio=0.9, inference_confidence=0.3)
        for i in range(30)
    ]
    assert health_score(_profile(wreckage, key_duplicates=5, has_unique=False)) == 0
