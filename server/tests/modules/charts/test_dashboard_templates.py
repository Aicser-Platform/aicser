"""Tests for the SAMPLE_DASHBOARD_TEMPLATES registry in charts/router.py.

The registry defines the five industry domain templates that users can
instantiate from the UI.  These tests guard against accidental regressions:
missing widgets, broken layout keys, absent endpoints, or removed response
fields.
"""
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


def _charts_router_path() -> Path:
    """Resolve the path to src/modules/charts/router.py from the test file location.

    Test file:  server/tests/modules/charts/test_dashboard_templates.py
    parents[0]: server/tests/modules/charts/
    parents[1]: server/tests/modules/
    parents[2]: server/tests/
    parents[3]: server/
    Target:     server/src/modules/charts/router.py
    """
    return (
        Path(__file__).resolve().parents[3]
        / "src"
        / "modules"
        / "charts"
        / "router.py"
    )


def _load_source() -> str:
    path = _charts_router_path()
    assert path.exists(), (
        f"charts router not found at {path}. "
        "If the file was moved, update _charts_router_path() in this test."
    )
    return path.read_text(encoding="utf-8")


def _extract_template_registry() -> dict:
    """Parse router.py with the AST and return SAMPLE_DASHBOARD_TEMPLATES as a dict."""
    tree = ast.parse(_load_source())
    for node in tree.body:
        targets = []
        value = None
        if isinstance(node, ast.Assign):
            targets = node.targets
            value = node.value
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
            value = node.value
        for target in targets:
            if isinstance(target, ast.Name) and target.id == "SAMPLE_DASHBOARD_TEMPLATES":
                return ast.literal_eval(value)
    raise AssertionError(
        "SAMPLE_DASHBOARD_TEMPLATES assignment not found in src/modules/charts/router.py"
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_template_catalog_has_expected_templates_and_domains():
    registry = _extract_template_registry()

    assert len(registry) == 5, f"Expected 5 templates, got {len(registry)}: {list(registry)}"
    assert set(registry.keys()) == EXPECTED_TEMPLATE_IDS

    templates = list(registry.values())
    assert {t["domain"] for t in templates} == EXPECTED_DOMAINS

    for template in templates:
        assert template["required_plan"] == "free", f"{template['id']} must be on the free plan"
        assert template.get("default_dashboard_name"), f"{template['id']} missing default_dashboard_name"
        assert isinstance(template.get("widgets"), list), f"{template['id']} widgets must be a list"
        assert len(template["widgets"]) >= 6, (
            f"{template['id']} has only {len(template['widgets'])} widgets (minimum 6)"
        )
        for widget in template["widgets"]:
            assert widget.get("name"), f"Widget in {template['id']} is missing 'name'"
            assert widget.get("chart_type") in {"bar", "line", "stat", "pie", "table"}, (
                f"Widget '{widget.get('name')}' has unknown chart_type '{widget.get('chart_type')}'"
            )
            assert isinstance(widget.get("sample_sql"), str), (
                f"Widget '{widget.get('name')}' missing sample_sql string"
            )
            assert "SELECT" in widget["sample_sql"].upper(), (
                f"Widget '{widget.get('name')}' sample_sql must contain SELECT"
            )


def test_template_registry_has_full_widget_configs_for_instantiation():
    registry = _extract_template_registry()

    for template_id, template in registry.items():
        widgets = template.get("widgets", [])
        assert widgets, f"{template_id} must define at least one widget"

        for widget in widgets:
            assert "chart_query" in widget, (
                f"Widget '{widget.get('name')}' in {template_id} missing chart_query"
            )
            assert isinstance(widget["chart_query"], dict), (
                f"Widget '{widget.get('name')}' chart_query must be a dict"
            )
            assert "layout" in widget, (
                f"Widget '{widget.get('name')}' in {template_id} missing layout"
            )
            layout = widget["layout"]
            assert set(layout.keys()) == {"x", "y", "w", "h"}, (
                f"Widget '{widget.get('name')}' layout must have exactly x,y,w,h keys"
            )
            assert layout["w"] > 0, f"Widget '{widget.get('name')}' layout.w must be > 0"
            assert layout["h"] > 0, f"Widget '{widget.get('name')}' layout.h must be > 0"


def test_template_endpoints_and_response_fields_exist_in_source():
    source = _load_source()

    assert '@router.get("/dashboards/templates")' in source, (
        "GET /dashboards/templates endpoint missing from charts/router.py"
    )
    assert '@router.post("/dashboards/from-template")' in source, (
        "POST /dashboards/from-template endpoint missing from charts/router.py"
    )
    # Response payload fields used by the frontend
    for field in ('"sql_pack"', '"data_source"', '"charts"'):
        assert field in source, f"Response field {field} missing from charts/router.py"


def test_each_template_has_8_widgets():
    """Each template must have exactly 8 widgets to fill the standard dashboard layout."""
    registry = _extract_template_registry()
    for template_id, template in registry.items():
        count = len(template.get("widgets", []))
        assert count == 8, (
            f"{template_id} has {count} widgets; expected exactly 8 to fill the standard layout"
        )
