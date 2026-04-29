import importlib.util
import os
import sys

_MODULE_PATH = os.path.join(
    os.path.dirname(__file__),
    os.pardir,
    os.pardir,
    os.pardir,
    "modules",
    "ai",
    "utils",
    "chart_injection.py",
)
_MODULE_PATH = os.path.normpath(_MODULE_PATH)

_SPEC = importlib.util.spec_from_file_location("chart_injection", _MODULE_PATH)
_MOD = importlib.util.module_from_spec(_SPEC)
sys.modules["chart_injection"] = _MOD
_SPEC.loader.exec_module(_MOD)

_normalize_label_for_display = _MOD._normalize_label_for_display
build_dataset_chart_from_result = _MOD.build_dataset_chart_from_result
inject_full_data_into_chart = _MOD.inject_full_data_into_chart


def test_normalize_label_rejects_object_object_string():
    assert _normalize_label_for_display("[object Object]", fallback="Other") == "Other"


def test_single_row_single_metric_builds_gauge():
    result = [{"Customer Status": "Active", "Total Customers": 42}]

    config = build_dataset_chart_from_result(result, "customer total", chart_type="bar")

    assert config is not None
    assert config["series"][0]["type"] == "gauge"
    assert config["series"][0]["data"][0]["value"] == 42.0


def test_single_row_multi_metric_builds_comparison_bar():
    result = [{"Segment": "SMB", "Revenue": 1000, "Profit": 250}]

    config = build_dataset_chart_from_result(result, "compare metrics", chart_type="bar")

    assert config is not None
    assert config["series"][0]["type"] == "bar"
    assert config["xAxis"]["data"] == ["Revenue", "Profit"]


def test_dataset_injection_sanitizes_dimension_labels():
    echarts_config = {"dataset": {"dimensions": ["label", "value"]}}
    full_result = [{"label": "[object Object]", "value": 10}]

    injected = inject_full_data_into_chart(echarts_config, full_result, query="test")

    assert injected is not None
    assert injected["dataset"]["source"][1][0] == "(Unknown)"
