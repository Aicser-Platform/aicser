"""Executive report retry_failed_sections preference."""

from src.modules.ai.nodes.executive_report_execution_node import _user_friendly_section_error


def test_user_friendly_section_error_hides_sql():
    msg = _user_friendly_section_error("Syntax error near SELECT * FROM", "Revenue", "timeseries")
    assert "SELECT" not in msg
    assert "Revenue" in msg
