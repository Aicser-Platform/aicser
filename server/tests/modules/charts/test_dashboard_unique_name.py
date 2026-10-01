from src.modules.charts.services.v2.dashboard_service import next_free_name


def test_free_name_is_kept():
    assert next_free_name("Sales Overview", {"Other"}) == "Sales Overview"


def test_repeat_builds_are_numbered():
    taken = {"Principal Amount Overview", "principal amount overview (2)"}
    assert next_free_name("Principal Amount Overview", taken) == "Principal Amount Overview (3)"


def test_numbering_fills_from_two():
    assert next_free_name("KPIs", {"KPIs"}) == "KPIs (2)"
