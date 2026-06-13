from ee.modules.ai.services.dashboard_widget_budget import compute_widget_budget
from ee.modules.ai.services.dashboard_pesd_service import build_kpi_sections


def _cols(numeric, temporal, categorical):
    return {"numeric": numeric, "temporal": temporal, "categorical": categorical}


def test_thin_single_metric_table_is_small():
    budget = compute_widget_budget(_cols(["amount"], [], ["region"]), prompt="overview")
    assert 4 <= budget <= 6


def test_rich_table_scales_up():
    cols = _cols(
        numeric=["loan", "repaid", "par30", "term", "rate"],
        temporal=["disbursement_date"],
        categorical=["branch", "product", "officer"],
    )
    budget = compute_widget_budget(cols, prompt="executive portfolio dashboard")
    assert 12 <= budget <= 16


def test_clamped_to_max_16():
    cols = _cols(
        numeric=[f"m{i}" for i in range(12)],
        temporal=["d1", "d2"],
        categorical=[f"c{i}" for i in range(10)],
    )
    assert compute_widget_budget(cols, prompt="everything") == 16


def test_empty_schema_minimum_4():
    assert compute_widget_budget(_cols([], [], []), prompt="x") == 4


_RICH_SCHEMA = {
    "tables": [{
        "name": "data",
        "columns": [
            {"name": "loan_amount_usd", "type": "double"},
            {"name": "total_repaid_usd", "type": "double"},
            {"name": "par30", "type": "double"},
            {"name": "disbursement_date", "type": "date"},
            {"name": "branch", "type": "varchar"},
            {"name": "product", "type": "varchar"},
        ],
    }]
}


def test_build_kpi_sections_scales_with_rich_schema():
    sections = build_kpi_sections(
        "executive portfolio dashboard", _RICH_SCHEMA, "duckdb", tier="executive"
    )
    assert len(sections) >= 10
    titles = [s["title"] for s in sections]
    assert len(titles) == len(set(titles))


def test_build_kpi_sections_honors_explicit_list_first():
    sections = build_kpi_sections(
        "Build dashboard with these exact widgets: "
        "1. KPI total loan amount usd  2. Bar par30 by branch",
        _RICH_SCHEMA, "duckdb", tier="executive",
    )
    explicit = [s for s in sections if s.get("type") == "explicit"]
    assert len(explicit) == 2
    assert sections[0]["type"] == "explicit"
