from ee.modules.ai.utils.display_title import (
    finalize_chart_title,
    finalize_dashboard_subtitle,
    finalize_dashboard_title,
    is_instruction_echo_title,
    is_weak_display_title,
    strip_generated_from,
    strip_pii_placeholders,
    title_from_widget_names,
)


def test_strip_pii_placeholders_removes_datetime_token():
    assert strip_pii_placeholders("<DATE_TIME> Performance") == "Performance"
    assert strip_pii_placeholders("Q3 <ORGANIZATION> revenue") == "Q3 revenue"


def test_weak_title_after_placeholder_strip():
    assert is_weak_display_title("<DATE_TIME> Performance")
    assert is_weak_display_title("Dashboard Overview")
    assert not is_weak_display_title("Average Score")
    assert not is_weak_display_title("Student Performance")


def test_request_phrasing_is_not_a_title():
    assert is_instruction_echo_title("How About Build A Dashboard For")
    assert is_weak_display_title("How About Build A Dashboard For")
    assert is_weak_display_title("Build A Dashboard For Our Management")


def test_finalize_prefers_llm_title_over_prompt_regex():
    title = finalize_dashboard_title(
        llm_title="Average Score Overview",
        prompt_title="<DATE_TIME> Performance",
        widget_names=["Average Score", "Total Records"],
    )
    assert title == "Average Score Overview"


def test_finalize_uses_widgets_when_prompt_is_placeholder():
    title = finalize_dashboard_title(
        llm_title="<DATE_TIME> Performance",
        prompt_title="<DATE_TIME> Performance",
        widget_names=["Average Score", "Average Score", "Total Records", "Average Score Trend"],
        data_source_name="grades",
    )
    assert "<" not in title
    assert "Average Score" in title


def test_finalize_uses_widgets_when_title_echoes_the_request():
    title = finalize_dashboard_title(
        llm_title="How About Build A Dashboard For",
        prompt_title="How About Build A Dashboard For",
        widget_names=[
            "Principal Amount Overview",
            "Principal Amount by Name",
            "Principal Amount Trend",
        ],
        data_source_name="loans",
    )
    assert title == "Principal Amount Overview"


def test_title_from_widget_names_skips_duplicates():
    title = title_from_widget_names(
        ["Average Score", "Average Score", "Total Records"],
        data_source_name="grades",
    )
    assert title == "Average Score"


def test_subtitle_drops_generated_from_prompt():
    assert strip_generated_from("Generated from: how about build a dashboard") == (
        "how about build a dashboard"
    )
    assert finalize_dashboard_subtitle("Generated from: how about build a dashboard") == ""
    assert finalize_dashboard_subtitle("Loan book across branches") == "Loan book across branches"


def test_finalize_chart_title_falls_back_to_columns():
    title = finalize_chart_title(
        query_title="<DATE_TIME>",
        y_col="amount",
        x_col="month",
    )
    assert title == "Amount by Month"
