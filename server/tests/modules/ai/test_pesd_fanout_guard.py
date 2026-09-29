from ee.modules.ai.services.dashboard_pesd_service import _agg, _is_dimension_key

LOANS = {"name": "loans", "rowCount": 500, "columns": [{"name": "loan_id"}, {"name": "branch_id"}]}
BRANCHES = {"name": "branches", "rowCount": 5, "columns": [{"name": "branch_id"}, {"name": "name"}]}
TXNS = {"name": "transactions", "rowCount": 5000, "columns": [{"name": "transaction_id"}, {"name": "branch_id"}]}


def test_only_many_to_one_joins_are_dimensions():
    assert _is_dimension_key(BRANCHES, "branch_id", LOANS)
    assert not _is_dimension_key(TXNS, "branch_id", LOANS)  # fan-out: many transactions per branch


def test_declared_keys_win():
    t = {"name": "regions", "columns": [{"name": "code", "primary_key": True}, {"name": "region_id"}]}
    assert _is_dimension_key(t, "code") and not _is_dimension_key(t, "region_id")


def test_rates_are_averaged():
    assert _agg("f", "interest_rate").startswith("AVG") and _agg("f", "principal").startswith("SUM")


def test_date_dimension_with_more_rows_than_fact_is_still_a_dimension():
    dim_date = {"name": "dim_date", "rowCount": 731, "columns": [{"name": "date_key"}, {"name": "full_date"}]}
    fact = {"name": "fact_bank_transactions", "rowCount": 461, "columns": [{"name": "txn_id"}, {"name": "date_key"}]}
    journal = {"name": "fact_journal", "rowCount": 3039, "columns": [{"name": "journal_line_id"}, {"name": "date_key"}]}
    assert _is_dimension_key(dim_date, "date_key", fact)
    assert not _is_dimension_key(journal, "date_key", fact)
