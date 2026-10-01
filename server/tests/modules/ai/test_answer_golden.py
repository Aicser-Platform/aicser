"""Answer-correctness golden set: well-formed across domains and locales; every truth SQL
runs on the sample warehouse (skipped when it isn't generated); the grader accepts right
answers and rejects wrong ones."""

import os

import pytest

from ee.modules.ai.evals.answer_golden import DOMAINS, build_questions, check_answer

_DB = os.path.join(os.path.dirname(__file__), "..", "..", "..", "src", "shared", "sample_data", "duckdb",
                   "sample_data.duckdb")


def test_golden_set_size_and_coverage():
    qs = build_questions({f"{d.schema}.{d.fact}": 2025 for d in DOMAINS})
    assert len(qs) >= 150
    assert {q.locale for q in qs} == {"en", "km", "th", "vi"}
    assert {"predictive", "diagnostic", "standard"} <= {q.expected_mode for q in qs}
    assert len({q.id for q in qs}) == len(qs)
    assert all(q.truth_sql or q.check == "mode" for q in qs)


@pytest.mark.skipif(not os.path.exists(_DB), reason="sample warehouse not generated")
def test_every_truth_sql_runs_and_returns_data():
    import duckdb

    from ee.modules.ai.evals.run_answer_eval import truth_rows, years_present

    conn = duckdb.connect(_DB, read_only=True)
    for q in build_questions(years_present(conn)):
        if q.truth_sql:
            rows = truth_rows(conn, q.truth_sql)
            assert rows and list(rows[0].values())[-1] is not None, q.id


def _q(shape, check):
    return next(q for q in build_questions({"banking.loans": 2025}) if q.shape == shape and q.check == check
                and q.locale == "en")


def test_grader_scalar_topk_series_and_mode():
    total = _q("total", "scalar")
    assert check_answer(total, [{"v": 1234.5}], {"query_result": [{"total": 1234.49}]})["passed"]
    assert not check_answer(total, [{"v": 1234.5}], {"query_result": [{"total": 999}]})["passed"]
    assert check_answer(total, [{"v": 1234.5}], {"executive_summary": "Total is 1,234.5 USD"})["passed"]
    top = _q("top5", "topk")
    truth = [{"label": n, "v": 1} for n in ("A", "B", "C", "D", "E")]
    assert check_answer(top, truth, {"query_result": [{"name": n, "v": 1} for n in "ABCDX"]})["passed"]
    assert not check_answer(top, truth, {"query_result": [{"name": n} for n in "AXYZW"]})["passed"]
    month = _q("monthly", "series")
    assert check_answer(month, [{"period": "2025-01", "v": 10.0}, {"period": "2025-02", "v": 20.0}],
                        {"query_result": [{"m": "Jan", "v": 10.0}, {"m": "Feb", "v": 20.0}]})["passed"]
    fc = _q("forecast", "mode")
    assert check_answer(fc, [], {"analytics_type": "predictive", "analytics_metadata": {"x": 1}})["passed"]
    assert not check_answer(fc, [], {"analytics_type": "standard", "query_result": [{"a": 1}]})["passed"]
