import os
from pathlib import Path

os.environ.setdefault("AISER_EDITION", "enterprise")

FIXTURES = Path(__file__).parent / "fixtures" / "onboarding"


def _scan(name: str) -> str:
    path = str(FIXTURES / name).replace("'", "''")
    return f"SELECT * FROM read_csv_auto('{path}', all_varchar=true)"


def _column(profile, name):
    return next(c for c in profile.columns if c.name == name)


def test_profiles_row_count_and_column_set():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(_scan("dirty_sales.csv"))

    assert profile.row_count == 8
    assert [c.name for c in profile.columns] == [
        "order_id",
        "region",
        "amount",
        "order_date",
    ]
    assert profile.sampled is False


def test_counts_nulls_blanks_and_null_tokens_separately():
    from src.modules.pipeline.profile.profiler import profile_object

    amount = _column(profile_object(_scan("dirty_sales.csv")), "amount")

    assert amount.null_count == 1
    assert amount.blank_count == 1
    assert amount.null_token_count == 1


def test_partially_parseable_dates_get_a_confidence_below_the_threshold():
    from src.modules.pipeline.profile.profiler import profile_object

    order_date = _column(profile_object(_scan("dirty_sales.csv")), "order_date")

    assert 0 < order_date.inference_confidence < 0.9
    assert order_date.inferred_type == "varchar"


def test_a_clean_integer_column_infers_bigint_at_full_confidence():
    from src.modules.pipeline.profile.profiler import profile_object

    qty = _column(profile_object(_scan("clean.csv")), "qty")

    assert qty.inferred_type == "bigint"
    assert qty.inference_confidence == 1.0


def test_a_unique_column_is_marked_unique_and_offered_as_a_key():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(_scan("clean.csv"))

    assert _column(profile, "id").is_unique is True
    best = profile.key_candidates[0]
    assert best.column == "id"
    assert best.duplicate_count == 0


def test_duplicate_keys_are_counted_without_an_extra_query():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(_scan("duplicate_keys.csv"))
    candidate = next(k for k in profile.key_candidates if k.column == "customer_id")

    assert candidate.is_unique is False
    assert candidate.duplicate_count == 2


def test_an_all_null_token_column_reports_every_row_as_a_null_token():
    from src.modules.pipeline.profile.profiler import profile_object

    note = _column(profile_object(_scan("all_null_column.csv")), "note")

    assert note.null_token_count == 3


def test_top_values_are_ranked_and_capped():
    from src.modules.pipeline.profile.profiler import profile_object

    region = _column(profile_object(_scan("dirty_sales.csv")), "region")

    assert len(region.top_values) <= 10
    assert region.top_values[0].count >= region.top_values[-1].count


def test_an_empty_source_profiles_without_raising():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object("SELECT NULL::VARCHAR AS a WHERE false")

    assert profile.row_count == 0
    assert profile.columns[0].null_ratio == 0.0


def test_sampling_marks_the_profile_as_estimated():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(_scan("dirty_sales.csv"), sample_rows=4)

    assert profile.sampled is True
    assert profile.row_count == 8
