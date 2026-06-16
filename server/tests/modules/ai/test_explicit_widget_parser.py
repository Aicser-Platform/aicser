from ee.modules.ai.services.dashboard_widget_request_parser import parse_explicit_widgets

COLS = {
    "numeric": ["loan_amount_usd", "total_repaid_usd"],
    "temporal": ["disbursement_date"],
    "categorical": ["branch", "product"],
}


def test_parses_numbered_list_into_specs():
    prompt = (
        "Build an executive dashboard with these exact widgets: "
        "1. KPI total loan amount  2. Bar loan amount by branch  "
        "3. Line total repaid over time"
    )
    specs = parse_explicit_widgets(prompt, COLS, table="data")
    assert len(specs) == 3
    assert specs[0]["chart_type"] == "stat"
    assert specs[1]["chart_type"] == "bar"
    assert specs[1]["chart_query"]["x"] == "branch"
    assert specs[2]["chart_type"] == "line"
    assert specs[2]["chart_query"]["x"] == "disbursement_date"


def test_no_list_returns_empty():
    assert parse_explicit_widgets("show me revenue trends", COLS, table="data") == []


def test_unmappable_line_is_skipped_not_crashed():
    specs = parse_explicit_widgets("1. something totally unrelated xyz", COLS, table="data")
    assert isinstance(specs, list)
