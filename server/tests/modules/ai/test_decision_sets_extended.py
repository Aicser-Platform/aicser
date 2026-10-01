"""New decision-layer question sets are well-formed, and the chart decision sees shape, not data."""

from ee.modules.ai.decisions.registry import QUESTION_SETS
from ee.modules.ai.utils.chart_decision import result_shape


def test_every_registered_set_serialises_for_the_decision_api():
    for name in ("chart_type", "decision_engines", "journey_phase", "decision_frame", "decision_review", "result_fit"):
        qs = QUESTION_SETS[name]
        for q in qs.questions:
            body = q.to_api()
            assert body["type"] in ("noul", "choice", "score") and body["instructions"]
            if q.type == "score":
                assert isinstance(body["criteria"], list)
            if q.type == "choice":
                assert isinstance(body["criteria"], dict) and len(body["criteria"]) >= 2


def test_case_decision_types_are_offered():
    types = QUESTION_SETS["decision_frame"].get("decision_type").criteria
    assert {"case_approval", "case_resolution"} <= set(types)


def test_result_shape_describes_structure_without_values():
    rows = [{"branch": f"Branch {i}", "month": f"2024-0{i}-01", "principal": 1000.5 * i, "npl": i % 2 == 0} for i in range(1, 6)]
    shape = result_shape(rows)
    assert "5 rows" in shape and "branch (category, 5 distinct)" in shape
    assert "month (date/time" in shape and "principal (measure" in shape and "npl (yes/no" in shape
    assert "Branch 3" not in shape and "3001.5" not in shape
