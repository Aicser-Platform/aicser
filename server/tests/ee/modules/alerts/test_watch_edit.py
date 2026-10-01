"""No-SQL alerts: editing an answer's alert keeps the answer's own query."""

from ee.modules.alerts.router import _answer_sql


def test_answer_query_is_recovered_from_the_watch_condition():
    cond = 'SELECT SUM("amount") AS value FROM (SELECT region, SUM(amount) AS amount FROM orders GROUP BY 1) AS aicser_watch'
    assert _answer_sql(cond) == "SELECT region, SUM(amount) AS amount FROM orders GROUP BY 1"


def test_other_conditions_are_not_mistaken_for_answers():
    assert _answer_sql('SELECT AVG("fee") AS value FROM "data"') is None
    assert _answer_sql("-- watches chart 123") is None
