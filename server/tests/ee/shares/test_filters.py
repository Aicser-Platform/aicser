"""Share row filters may only be conditions on the table's own columns."""

import pytest

from ee.modules.shares.filters import UnsafeFilter, check_row_filter


@pytest.mark.parametrize("ok", [
    "region = 'KH'",
    "amount > 100 AND status IN ('paid', 'shipped')",
    "lower(trim(country)) LIKE 'cam%' OR partner_id IS NOT NULL",
    "order_date >= DATE '2026-01-01' AND NOT is_test",
    "CAST(score AS DOUBLE) BETWEEN 0.5 AND 1",
])
def test_plain_conditions_are_allowed(ok):
    assert check_row_filter(ok) == ok


@pytest.mark.parametrize("bad", [
    "region IN (SELECT region FROM other_table)",
    "length(read_text('/etc/passwd')) > 0",
    "EXISTS (SELECT 1)",
    "id IN (SELECT * FROM read_parquet('s3://other-org/*.parquet'))",
    "getenv('AWS_SECRET_ACCESS_KEY') IS NOT NULL",
])
def test_queries_files_and_unknown_functions_are_refused(bad):
    with pytest.raises(UnsafeFilter):
        check_row_filter(bad)
