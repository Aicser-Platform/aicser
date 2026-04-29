import ast
from pathlib import Path


EXPECTED_TEMPLATE_IDS = {
    "banking_portfolio_overview",
    "insurance_claims_performance",
    "education_enrollment_health",
    "energy_consumption_operations",
    "gov_service_delivery_pulse",
}

EXPECTED_DOMAINS = {
    "banking",
    "insurance",
    "education",
    "energy",
    "govt_public_services",
}


def _charts_api_path() -> Path:
    return Path(__file__).resolve().parents[3] / "modules" / "charts" / "api.py"


def _load_source() -> str:
    return _charts_api_path().read_text(encoding="utf-8")


def _extract_template_registry() -> dict:
    tree = ast.parse(_load_source())
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "SAMPLE_DASHBOARD_TEMPLATES":
                    return ast.literal_eval(node.value)
        if isinstance(node, ast.AnnAssign):
            target = node.target
            if isinstance(target, ast.Name) and target.id == "SAMPLE_DASHBOARD_TEMPLATES":
                return ast.literal_eval(node.value)
    raise AssertionError("SAMPLE_DASHBOARD_TEMPLATES assignment not found in charts/api.py")


def test_template_catalog_has_expected_templates_and_domains():
    registry = _extract_template_registry()

    assert len(registry) == 5
    assert set(registry.keys()) == EXPECTED_TEMPLATE_IDS

    templates = list(registry.values())
    assert {t["domain"] for t in templates} == EXPECTED_DOMAINS

    for template in templates:
        assert template["required_plan"] == "free"
        assert template["default_dashboard_name"]
        assert isinstance(template.get("widgets"), list)
        assert len(template["widgets"]) >= 6
        for widget in template["widgets"]:
            assert widget["name"]
            assert widget["chart_type"] in {"bar", "line", "stat", "pie", "table"}
            assert isinstance(widget.get("sample_sql"), str)
            assert "SELECT" in widget["sample_sql"].upper()


def test_template_registry_has_full_widget_configs_for_instantiation():
    registry = _extract_template_registry()

    for template in registry.values():
        widgets = template["widgets"]
        assert widgets, "Each template must define at least one widget"

        for widget in widgets:
            assert "chart_query" in widget
            assert isinstance(widget["chart_query"], dict)
            assert "layout" in widget
            layout = widget["layout"]
            assert set(layout.keys()) == {"x", "y", "w", "h"}
            assert layout["w"] > 0
            assert layout["h"] > 0


def test_template_endpoints_and_response_fields_exist_in_source():
    source = _load_source()

    assert '@router.get("/dashboards/templates")' in source
    assert '@router.post("/dashboards/from-template")' in source
    assert '"sql_pack"' in source
    assert '"data_source"' in source
    assert '"charts"' in source


def test_each_template_has_8_widgets():
    registry = _extract_template_registry()
    for template_id, template in registry.items():
        assert len(template["widgets"]) == 8, (
            f"{template_id} has {len(template['widgets'])} widgets, expected 8"
        )
