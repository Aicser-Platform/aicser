"""Upload path stores typed parquet + cleaned schema."""
import io

import duckdb
import pandas as pd
import pytest

from src.modules.data.services.data_connectivity_service import DataConnectivityService

DIRTY_CSV = (
    "Region,amount,order_date\n"
    "North,\"$1,234.50\",2024-01-15\n"
    "South,\"$2,000.00\",2024-02-20\n"
    "North,N/A,2024-03-01\n"
)

# Numeric column with a pandas-default-na-but-not-our-NULL_TOKENS value ("<NA>")
# mixed among otherwise-clean numbers. Regression for: keep_default_na=False lets
# "<NA>" survive as a literal string, and if it isn't recognized as a null token
# it can push the numeric-match share below threshold, leaving the column typed
# as string instead of number.
NUMERIC_WITH_PANDAS_NA_TOKEN_CSV = "\n".join(
    ["value"] + [str(n) for n in range(17)] + ["<NA>", "#N/A N/A", "<NA>"]  # 3/20 = 15%
) + "\n"


@pytest.mark.asyncio
async def test_parquet_payload_is_typed_and_reports_cleaning(tmp_path):
    csv_path = tmp_path / "dirty.csv"
    csv_path.write_text(DIRTY_CSV)

    service = DataConnectivityService()
    payload = await service._convert_upload_to_compressed_parquet(
        source_path=str(csv_path), file_extension="csv", options={}
    )

    # Report present and meaningful
    assert payload["cleaning_report"]["null_tokens_replaced"] >= 1
    assert "coerced_numeric" in payload["cleaning_report"]["column_actions"]["amount"]
    assert "parsed_date" in payload["cleaning_report"]["column_actions"]["order_date"]

    # Cleaned schema reflects real types
    types = payload["cleaned_schema"]["types"]
    assert types["amount"] == "number"
    assert types["order_date"] == "date"

    # Stored parquet is typed: date_trunc works WITHOUT casts (the old bug class)
    conn = duckdb.connect()
    pq_path = tmp_path / "out.parquet"
    pq_path.write_bytes(payload["content"])
    rows = conn.execute(
        f"SELECT date_trunc('month', order_date) AS m, SUM(amount) AS total "
        f"FROM read_parquet('{pq_path}') GROUP BY 1 ORDER BY 1"
    ).fetchall()
    assert rows[0][1] == 1234.50
    assert rows[1][1] == 2000.00


@pytest.mark.asyncio
async def test_numeric_column_with_pandas_na_token_still_types_as_number(tmp_path):
    csv_path = tmp_path / "numeric_with_na_token.csv"
    csv_path.write_text(NUMERIC_WITH_PANDAS_NA_TOKEN_CSV)

    service = DataConnectivityService()
    payload = await service._convert_upload_to_compressed_parquet(
        source_path=str(csv_path), file_extension="csv", options={}
    )

    assert payload["cleaned_schema"]["types"]["value"] == "number"
