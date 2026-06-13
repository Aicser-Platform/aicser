from ee.modules.ai.services.dashboard_widget_budget import compute_widget_budget


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
