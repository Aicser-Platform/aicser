from ee.modules.ai.nodes.executive_report_execution_node import _user_friendly_section_error


def test_placeholder_sql_is_not_shown_to_users():
    msg = _user_friendly_section_error(
        "SQL is a template/placeholder — not executable",
        "Revenue trend",
        "timeseries",
    )
    assert "placeholder" not in msg.lower()
    assert "SELECT" not in msg
    assert "Revenue trend" in msg
    assert "insights" in msg.lower() or "chart" in msg.lower() or "Retry" in msg or "retry" in msg.lower()


def test_gather_exception_is_sanitized():
    msg = _user_friendly_section_error(
        "asyncpg.exceptions.UndefinedTableError: relation foo does not exist",
        "KPI scorecard",
        "kpi",
    )
    assert "asyncpg" not in msg.lower()
    assert "UndefinedTableError" not in msg
    assert "KPI scorecard" in msg
