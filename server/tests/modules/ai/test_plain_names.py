"""User-facing text never shows identifiers: aliases resolve, columns read as words."""

from ee.modules.ai.utils.plain_names import plain

STATE = {"execution_metadata": {"mode_parameters": {"focus_dimension": "name", "focus_dimension_table": "banking.branches",
                                                    "target_metric": "principal_amount"}},
         "analytics_metadata": {}, "query_result": [{"period": "2024-01", "focus_dimension": "B1", "value": 1}],
         "data_source_schema": {"tables": [{"name": "loans", "columns": [{"name": "principal_amount"},
                                                                          {"name": "disbursement_date"}]}]}}


def test_aliases_columns_and_computed_names_become_words():
    assert plain("Show principal amount by focus_dimension", STATE) == "Show principal amount by branch name"
    assert plain("Trend of principal_amount by disbursement_date", STATE) == "Trend of principal amount by disbursement date"
    assert plain("SUM of loans.principal_amount", STATE) == "SUM of principal amount"
    assert plain("total_collateral_value: 67% missing", STATE) == "total collateral value: 67% missing"


def test_plain_text_untouched():
    assert plain("Branch 5 leads with $1.66M (25.6%).", STATE) == "Branch 5 leads with $1.66M (25.6%)."
