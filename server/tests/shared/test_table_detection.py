import pandas as pd

from src.shared.table_detection import detect_table


def _sheet(rows):
    return pd.DataFrame(rows)


def test_header_in_first_row_is_kept():
    df, info = detect_table(_sheet([["name", "amount"], ["a", 1], ["b", 2]]))
    assert list(df.columns) == ["name", "amount"]
    assert len(df) == 2
    assert info.header_row == 0
    assert not info.changed


def test_title_and_blank_rows_above_header_are_skipped():
    df, info = detect_table(
        _sheet(
            [
                ["Enrollment report 2026", None, None],
                [None, None, None],
                ["student", "course", "credits"],
                ["Dara", "Math", 3],
                ["Sophea", "Physics", 4],
            ]
        )
    )
    assert list(df.columns) == ["student", "course", "credits"]
    assert df["credits"].tolist() == [3, 4]
    assert info.header_row == 2
    assert info.changed


def test_empty_leading_columns_are_dropped():
    df, info = detect_table(
        _sheet(
            [
                [None, None, "id", "city"],
                [None, None, 1, "Phnom Penh"],
                [None, None, 2, "Siem Reap"],
            ]
        )
    )
    assert list(df.columns) == ["id", "city"]
    assert info.dropped_empty_columns == 2


def test_blank_and_duplicate_header_cells_get_names():
    df, info = detect_table(_sheet([["x", None, "x"], [1, 2, 3]]))
    assert list(df.columns) == ["x", "column_2", "x_2"]
    assert set(info.renamed_columns) == {"column_2", "x_2"}


def test_numeric_only_sheet_gets_generated_headers():
    df, info = detect_table(_sheet([[1, 2], [3, 4]]))
    assert list(df.columns) == ["column_1", "column_2"]
    assert len(df) == 2
    assert info.header_row is None


def test_all_empty_sheet():
    df, info = detect_table(_sheet([[None, None], [None, None]]))
    assert df.empty
