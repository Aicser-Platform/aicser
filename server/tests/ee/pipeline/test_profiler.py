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


def test_infer_prefers_dates_and_flags_over_numbers():
    from src.modules.pipeline.profile.profiler import _infer

    # bigint, double, boolean, date, timestamp + extras:
    # currency, parsed_date, parsed_ts, boolish, leading_zeros, timeish
    assert _infer(10, [10, 10, 0, 10, 0], [0, 10, 0, 0, 0, 0], 8)[0] == "date"
    assert _infer(4, [0, 0, 0, 0, 0], [0, 0, 0, 4, 0, 0], 2)[0] == "boolean"
    assert _infer(3, [3, 3, 0, 0, 0], [0, 0, 0, 0, 3, 0], 3)[0] == "varchar"
    assert _infer(2, [0, 0, 0, 2, 2], [0, 2, 2, 0, 0, 2], 2)[0] == "timestamp"
    assert _infer(3, [0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0], 3)[0] == "double"


def test_currency_and_thousands_separators_infer_double():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(
        "SELECT * FROM (VALUES ('$1,200.50'), ('$99.00'), ('1,050.25')) t(amount)"
    )
    amount = _column(profile, "amount")
    assert amount.inferred_type == "double"
    assert amount.inference_confidence >= 0.9


def test_day_first_dates_infer_date():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(
        "SELECT * FROM (VALUES ('27-12-2024'), ('01-01-2025'), ('15/03/2024')) t(order_date)"
    )
    order_date = _column(profile, "order_date")
    assert order_date.inferred_type == "date"
    assert order_date.inference_confidence >= 0.9


def test_yes_no_flags_infer_boolean():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(
        "SELECT * FROM (VALUES ('yes'), ('no'), ('YES'), ('No')) t(active)"
    )
    active = _column(profile, "active")
    assert active.inferred_type == "boolean"
    assert active.inference_confidence >= 0.9


def test_zero_padded_codes_stay_text():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(
        "SELECT * FROM (VALUES ('00123'), ('00456'), ('00001')) t(zip_code)"
    )
    zip_code = _column(profile, "zip_code")
    assert zip_code.inferred_type == "varchar"


def test_datetimes_with_a_clock_infer_timestamp():
    from src.modules.pipeline.profile.profiler import profile_object

    profile = profile_object(
        "SELECT * FROM (VALUES ('2024-01-15 10:00:00'), ('2024-01-16 18:30:00')) t(created_at)"
    )
    created = _column(profile, "created_at")
    assert created.inferred_type == "timestamp"


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
