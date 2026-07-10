"""Regression tests for EE PII gate SQL preservation."""


def test_scrub_prompt_preserves_sql_partition_keyword(monkeypatch):
    import src.modules.data.services.pii_scrubber as pii_module
    from ee.modules.ai.services.pii_gate import scrub_prompt_text

    monkeypatch.setattr(pii_module, "_presidio_analyzer", None)
    monkeypatch.setattr(pii_module, "_presidio_anonymizer", None)

    sql = (
        'SELECT LAG("impressions") OVER (PARTITION BY "channel" '
        'ORDER BY "campaign_month") FROM "data"'
    )

    assert scrub_prompt_text(sql) == sql
    assert scrub_prompt_text("Customer ID QWERTYUIO") == "Customer ID <DE_PERSONALAUSWEIS>"


def test_moderate_llm_output_preserves_sql_partition_keyword(monkeypatch):
    import src.modules.data.services.pii_scrubber as pii_module
    from ee.modules.ai.services.pii_gate import moderate_llm_output

    monkeypatch.setattr(pii_module, "_presidio_analyzer", None)
    monkeypatch.setattr(pii_module, "_presidio_anonymizer", None)

    sql = (
        'SELECT SUM("spend") OVER (PARTITION BY "campaign_key" '
        'ORDER BY "date_key") AS "rolling_spend" FROM "sheet_6_fact_marketing_campaign"'
    )

    assert moderate_llm_output(sql) == sql
