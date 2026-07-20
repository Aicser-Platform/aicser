"""Golden regression: dirty CSV → cleaned typed parquet → DuckDB analytics queries.

Locks in the exact query shapes that historically failed on untyped data
(date_trunc on VARCHAR, SUM over currency strings).
"""
import duckdb
import pandas as pd

from src.modules.data.services.data_cleaning_service import clean_dataframe

DIRTY = pd.DataFrame(
    {
        "branch": ["  A ", "B", "A", "B", "A", "N/A"],
        "disbursement_date": ["2024-01-10", "2024-01-20", "2024-02-05",
                              "2024-02-15", "2024-03-01", "2024-03-09"],
        "amount": ["$100.00", "$200.00", "$300.00", "-", "$500.00", "$50.00"],
    }
)


def _duckdb_with_cleaned(tmp_path):
    cleaned, _ = clean_dataframe(DIRTY)
    pq = tmp_path / "golden.parquet"
    cleaned.to_parquet(pq, index=False)
    conn = duckdb.connect()
    conn.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{pq}')")
    return conn


def test_monthly_trend_no_casts_needed(tmp_path):
    conn = _duckdb_with_cleaned(tmp_path)
    rows = conn.execute(
        "SELECT date_trunc('month', disbursement_date) AS m, SUM(amount) AS total "
        "FROM data GROUP BY 1 ORDER BY 1"
    ).fetchall()
    totals = [r[1] for r in rows]
    assert totals == [300.0, 300.0, 550.0]  # Jan: 100+200; Feb: 300 (null "-" excluded); Mar: 500+50


def test_sum_by_branch_exact(tmp_path):
    conn = _duckdb_with_cleaned(tmp_path)
    rows = conn.execute(
        "SELECT branch, SUM(amount) AS total FROM data "
        "WHERE branch IS NOT NULL GROUP BY branch ORDER BY branch"
    ).fetchall()
    assert rows == [("A", 900.0), ("B", 200.0)]  # trimmed 'A'; N/A row excluded; '-' amount is NULL


def test_count_null_amounts(tmp_path):
    conn = _duckdb_with_cleaned(tmp_path)
    (n_null,) = conn.execute("SELECT COUNT(*) FROM data WHERE amount IS NULL").fetchone()
    assert n_null == 1
