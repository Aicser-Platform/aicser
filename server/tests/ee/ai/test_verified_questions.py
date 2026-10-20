import pytest

from ee.modules.ai.services.verified_questions import InvalidVerifiedSQL, check_sql, format_for_prompt, rank


def test_only_one_select_is_accepted():
    assert check_sql("SELECT region, SUM(amount) FROM orders GROUP BY 1;") == "SELECT region, SUM(amount) FROM orders GROUP BY 1"
    assert check_sql("WITH t AS (SELECT 1 AS x) SELECT x FROM t").startswith("WITH")
    for bad in ("", "DELETE FROM orders", "SELECT 1; DROP TABLE orders", "UPDATE orders SET amount = 0"):
        with pytest.raises(InvalidVerifiedSQL):
            check_sql(bad)


def _row(i, question):
    from ee.modules.ai.services.query_pattern_service import _normalize_query

    return {"id": str(i), "question": question, "normalized": _normalize_query(question), "sql": f"SELECT {i}", "embedding": None}


def test_closest_questions_first_and_unrelated_ones_left_out():
    rows = [_row(1, "total revenue by region last month"), _row(2, "number of active customers"), _row(3, "loan default rate")]
    found = rank("revenue by region last month", rows, None)
    assert [f["id"] for f in found][:1] == ["1"] and all(f["verified"] for f in found)
    assert rank("headcount by office", rows, None) == []
    assert rank("Number of active customers", rows, None)[0]["id"] == "2"


def test_prompt_says_people_checked_them():
    text = format_for_prompt([{"query": "q", "sql": "SELECT 1"}])
    assert "VERIFIED ANSWERS" in text and "SELECT 1" in text
    assert format_for_prompt([]) == ""
