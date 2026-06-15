from ee.modules.ai.services.dashboard_widget_validator import concise_widget_title


def test_uses_requested_business_title_after_arrow():
    widget = {
        "name": 'KPI card: SUM of loan_amount_usd WHERE loan_status = Active -> "Total active portfolio"',
        "chart_type": "stat",
        "chart_query": {
            "yMetrics": [{"field": "loan_amount_usd", "aggregation": "sum"}],
        },
    }

    assert concise_widget_title(widget) == "Total Active Portfolio"


def test_builds_plain_language_title_from_chart_query():
    widget = {
        "name": "Grouped bar: loans_disbursed_usd + repayments_collected_usd",
        "chart_type": "bar",
        "chart_query": {
            "x": "loan_status",
            "yMetrics": [{"field": "loans_disbursed_usd", "aggregation": "sum"}],
        },
    }

    assert concise_widget_title(widget) == "Loans Disbursed by Loan Status"


def test_builds_short_trend_title():
    widget = {
        "name": "Line chart: par_30_pct by month - last 12 months",
        "chart_type": "line",
        "chart_query": {
            "x": "reporting_month",
            "yMetrics": [{"field": "par_30_pct", "aggregation": "avg"}],
        },
    }

    assert concise_widget_title(widget) == "Average PAR 30 Trend"
