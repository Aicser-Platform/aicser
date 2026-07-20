"""Tests for deterministic ingest-time cleaning."""
import pandas as pd
import pandas.api.types as ptypes

from src.modules.data.services.data_cleaning_service import CleaningReport, clean_dataframe


def _dirty_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            " Region ": ["North", "South", "  North  ", "N/A", "South"],
            "amount": ["$1,234.50", "$2,000.00", "-", "$1,234.50", "$500.25"],
            "growth": ["10%", "5%", "7%", "N/A", "3%"],
            "order_date": ["2024-01-15", "2024-02-20", "2024-02-28", "2024-03-01", "2024-03-15"],
            "note": ["ok", "null", "ok", "ok", "ok"],
        }
    )


def test_column_names_are_stripped():
    df, _ = clean_dataframe(_dirty_df())
    assert "Region" in df.columns
    assert " Region " not in df.columns


def test_null_tokens_become_nan():
    df, report = clean_dataframe(_dirty_df())
    assert df["Region"].isna().sum() == 1          # "N/A"
    assert df["note"].isna().sum() == 1            # "null"
    assert report.null_tokens_replaced >= 2


def test_currency_column_coerced_to_numeric():
    df, report = clean_dataframe(_dirty_df())
    assert ptypes.is_numeric_dtype(df["amount"])
    assert df["amount"].iloc[0] == 1234.50
    assert pd.isna(df["amount"].iloc[2])           # "-" null token
    assert "coerced_numeric" in report.column_actions["amount"]


def test_percent_column_coerced_and_flagged():
    df, report = clean_dataframe(_dirty_df())
    assert ptypes.is_numeric_dtype(df["growth"])
    assert df["growth"].iloc[0] == 10.0
    assert "stripped_percent" in report.column_actions["growth"]


def test_date_column_parsed_to_datetime():
    df, report = clean_dataframe(_dirty_df())
    assert ptypes.is_datetime64_any_dtype(df["order_date"])
    assert df["order_date"].iloc[0] == pd.Timestamp("2024-01-15")
    assert "parsed_date" in report.column_actions["order_date"]


def test_string_cells_trimmed_and_duplicates_counted_not_dropped():
    df, report = clean_dataframe(_dirty_df())
    assert df["Region"].iloc[2] == "North"
    assert len(df) == 5                            # no rows dropped
    assert report.duplicate_row_count == 0         # rows differ after cleaning


def test_mostly_text_column_left_alone():
    df, _ = clean_dataframe(pd.DataFrame({"name": ["alice", "bob", "carol", "5"]}))
    assert not ptypes.is_numeric_dtype(df["name"])


def test_report_to_dict_is_json_safe():
    import json

    _, report = clean_dataframe(_dirty_df())
    payload = report.to_dict()
    json.dumps(payload)                            # must not raise
    assert payload["null_tokens_replaced"] >= 2
