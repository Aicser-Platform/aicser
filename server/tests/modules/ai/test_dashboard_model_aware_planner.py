"""Model-aware dashboard planning for multi-table workbook schemas."""

from ee.modules.ai.services.dashboard_pesd_service import build_kpi_sections, synthesize_widget_specs


def _marketing_schema() -> dict:
    return {
        "tables": [
            {
                "name": "sheet_2_dim_device",
                "row_count": 3,
                "columns": [
                    {"name": "device_key", "type": "integer"},
                    {"name": "device", "type": "varchar"},
                ],
            },
            {
                "name": "sheet_1_dim_channel",
                "row_count": 6,
                "columns": [
                    {"name": "channel_key", "type": "integer"},
                    {"name": "channel", "type": "varchar"},
                ],
            },
            {
                "name": "sheet_5_dim_date",
                "row_count": 365,
                "columns": [
                    {"name": "date_key", "type": "integer"},
                    {"name": "date", "type": "date"},
                    {"name": "month", "type": "integer"},
                ],
            },
            {
                "name": "sheet_6_fact_marketing_campaign",
                "row_count": 5000,
                "columns": [
                    {"name": "fact_id", "type": "integer"},
                    {"name": "date_key", "type": "integer"},
                    {"name": "channel_key", "type": "integer"},
                    {"name": "device_key", "type": "integer"},
                    {"name": "impressions", "type": "integer"},
                    {"name": "clicks", "type": "integer"},
                    {"name": "conversions", "type": "integer"},
                    {"name": "spend", "type": "double"},
                    {"name": "revenue", "type": "double"},
                ],
            },
        ]
    }


def test_model_aware_dashboard_uses_joins_and_ratio_chart():
    sections = build_kpi_sections(
        "How does conversion rate (conversions/clicks) vary by device type and channel over time?",
        _marketing_schema(),
        db_type="duckdb",
        tier="operational",
        max_widgets=8,
    )

    sql_sections = [s for s in sections if s.get("sql")]
    joined_sql = "\n".join(str(s.get("sql") or "") for s in sql_sections)
    titles = [str(s.get("title") or "") for s in sections]
    chart_types = {str(s.get("chart_type") or "") for s in sections}

    assert len(sql_sections) >= 4
    assert "LEFT JOIN" in joined_sql
    assert "sheet_6_fact_marketing_campaign" in joined_sql
    assert "sheet_2_dim_device" in joined_sql
    assert "conversion_rate_pct" in joined_sql
    assert any("Conversion Rate by Device" in title for title in titles)
    assert "stat" in chart_types
    assert "bar" in chart_types
    assert "line" in chart_types


def test_model_aware_synthesis_does_not_pad_with_generic_widgets():
    sections = build_kpi_sections(
        "How does conversion rate (conversions/clicks) vary by device type and channel over time?",
        _marketing_schema(),
        db_type="duckdb",
        tier="operational",
        max_widgets=8,
    )
    executed = [
        {
            **section,
            "status": "complete",
            "data": [{"x": "A", "y": 1}],
            "echarts_config": {"series": [{"data": [1]}]},
        }
        for section in sections
    ]

    specs, _meta = synthesize_widget_specs(
        executed,
        _marketing_schema(),
        "sheet_6_fact_marketing_campaign",
        min_widgets=8,
        prompt="conversion rate dashboard",
    )

    assert len(specs) == len(sections)
    assert all((spec.get("chart_query") or {}).get("compiled_semantic_sql") for spec in specs)
