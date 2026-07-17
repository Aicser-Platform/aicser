"""Model-aware dashboard planning for multi-table workbook schemas."""

from ee.modules.ai.nodes.dashboard_pesd_nodes import _is_reference_dashboard_request
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


def _accounting_schema() -> dict:
    return {
        "tables": [
            {
                "name": "accounting.fact_journal",
                "row_count": 3039,
                "columns": [
                    {"name": "journal_line_id", "type": "integer"},
                    {"name": "date_key", "type": "integer"},
                    {"name": "account_id", "type": "integer"},
                    {"name": "source", "type": "varchar"},
                    {"name": "memo", "type": "varchar"},
                    {"name": "debit_usd", "type": "double"},
                    {"name": "credit_usd", "type": "double"},
                ],
            },
            {
                "name": "accounting.fact_monthly_financials",
                "row_count": 24,
                "columns": [
                    {"name": "month_key", "type": "integer"},
                    {"name": "revenue_usd", "type": "double"},
                    {"name": "cogs_usd", "type": "double"},
                    {"name": "gross_profit_usd", "type": "double"},
                    {"name": "opex_usd", "type": "double"},
                    {"name": "net_profit_usd", "type": "double"},
                    {"name": "cash_balance_usd", "type": "double"},
                    {"name": "ar_balance_usd", "type": "double"},
                    {"name": "ap_balance_usd", "type": "double"},
                ],
            },
            {
                "name": "accounting.fact_invoice_lines",
                "row_count": 590,
                "columns": [
                    {"name": "line_id", "type": "integer"},
                    {"name": "product_id", "type": "integer"},
                    {"name": "line_total_usd", "type": "double"},
                ],
            },
            {
                "name": "accounting.dim_product",
                "row_count": 10,
                "columns": [
                    {"name": "product_id", "type": "integer"},
                    {"name": "category", "type": "varchar"},
                ],
            },
            {
                "name": "accounting.fact_bills",
                "row_count": 178,
                "columns": [
                    {"name": "bill_id", "type": "integer"},
                    {"name": "vendor_id", "type": "integer"},
                    {"name": "total_usd", "type": "double"},
                ],
            },
            {
                "name": "accounting.dim_vendor",
                "row_count": 14,
                "columns": [
                    {"name": "vendor_id", "type": "integer"},
                    {"name": "category", "type": "varchar"},
                ],
            },
            {
                "name": "accounting.fact_bank_transactions",
                "row_count": 461,
                "columns": [
                    {"name": "txn_id", "type": "integer"},
                    {"name": "direction", "type": "varchar"},
                    {"name": "amount_usd", "type": "double"},
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


def test_reference_dashboard_request_detects_uploaded_image_context():
    assert _is_reference_dashboard_request(
        "Can you create dashboard like image i uploaded?",
        {"multimodal_context": {"modalities": ["text", "image"], "image_count": 1}},
    )
    assert not _is_reference_dashboard_request(
        "Show debit by account code",
        {"multimodal_context": {"modalities": ["text"]}},
    )


def test_accounting_prompt_uses_financial_statement_widgets_not_debit_default():
    prompt = (
        "Create dashboard base on our accounting data. Like have kpi cards of total revenue, "
        "expense, net profit, gross profit margin. Revenue Trend, Revenue by Category, "
        "Expense Summary, Profit & Loss Summary, Balance Sheet Overview, Cash Flow Overview, "
        "Recent Journal Entries, Top Expense Categories"
    )
    sections = build_kpi_sections(
        prompt,
        _accounting_schema(),
        db_type="duckdb",
        tier="executive",
        max_widgets=12,
        relationships=[],
    )

    titles = {str(s.get("title") or "") for s in sections}
    sql = "\n".join(str(s.get("sql") or "") for s in sections)

    assert "Financial KPI Cards" in titles
    assert "Revenue Trend" in titles
    assert "Revenue by Category" in titles
    assert "Profit & Loss Summary" in titles
    assert "Cash Flow Overview" in titles
    assert "fact_monthly_financials" in sql
    assert "debit_usd Trend" not in "\n".join(titles)
    assert "Account Code" not in "\n".join(titles)
