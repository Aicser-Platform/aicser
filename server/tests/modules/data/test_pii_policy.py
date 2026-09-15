"""Once-per-dataset PII policy — classify cheaply, reuse; LLM-prompt masking only."""

from __future__ import annotations


def test_ensure_schema_pii_policy_reuses_fresh_fingerprint(monkeypatch):
    monkeypatch.setenv("AISER_PII_DETECTION", "true")
    from src.modules.data.services.pii_policy import (
        ensure_schema_pii_policy,
        schema_column_fingerprint,
    )

    schema = {
        "tables": [
            {
                "name": "customers",
                "columns": [
                    {"name": "id", "type": "int"},
                    {"name": "email", "type": "string"},
                    {"name": "revenue", "type": "number"},
                ],
                "sample_data": [{"id": 1, "email": "a@b.com", "revenue": 10}],
            }
        ]
    }
    schema1, cols1, rebuilt1 = ensure_schema_pii_policy(schema)
    assert rebuilt1 is True
    assert "email" in cols1
    assert "revenue" not in cols1
    assert schema1["pii_policy"]["fingerprint"] == schema_column_fingerprint(schema1)

    schema2, cols2, rebuilt2 = ensure_schema_pii_policy(schema1)
    assert rebuilt2 is False
    assert cols2 == cols1


def test_ensure_skips_classify_when_detection_off(monkeypatch):
    monkeypatch.setenv("AISER_PII_DETECTION", "false")
    monkeypatch.delenv("AISER_PII_COLUMN_MASKING", raising=False)
    from src.modules.data.services.pii_policy import ensure_schema_pii_policy

    schema = {
        "tables": [
            {
                "name": "customers",
                "columns": [{"name": "email", "type": "string"}],
            }
        ]
    }
    out, cols, rebuilt = ensure_schema_pii_policy(schema)
    assert rebuilt is False
    assert cols == []
    assert "pii_policy" not in (out or {})


def test_scrub_rows_with_policy_skips_value_discovery(monkeypatch):
    """Known columns → typed mask only; no scrub_text discovery on other cells."""
    from src.modules.data.services.pii_scrubber import pii_scrubber

    calls = {"n": 0}
    real_scrub_text = pii_scrubber.scrub_text

    def _counting_scrub_text(text: str) -> str:
        calls["n"] += 1
        return real_scrub_text(text)

    monkeypatch.setattr(pii_scrubber, "scrub_text", _counting_scrub_text)

    rows = [
        {"email": "bob@corp.com", "note": "call me at +1-555-0100", "revenue": 100},
    ]
    out = pii_scrubber.scrub_rows(rows, sensitive_columns=["email"], max_rows=5)
    assert out[0]["email"] != "bob@corp.com"
    assert out[0]["note"] == "call me at +1-555-0100"
    assert calls["n"] == 0


def test_scrub_data_payload_column_masking_without_gate(monkeypatch):
    monkeypatch.setenv("AISER_PII_GATE_ENABLED", "false")
    monkeypatch.setenv("AISER_PII_DETECTION", "true")
    monkeypatch.delenv("AISER_PII_COLUMN_MASKING", raising=False)
    from ee.modules.ai.services.pii_gate import scrub_data_payload

    rows = [{"email": "bob@corp.com", "revenue": 100}]
    out = scrub_data_payload(rows, sensitive_columns=["email"], max_rows=5)
    assert out[0]["email"] != "bob@corp.com"
    assert out[0]["revenue"] == 100


def test_scrub_data_payload_noop_when_detection_off(monkeypatch):
    monkeypatch.setenv("AISER_PII_GATE_ENABLED", "false")
    monkeypatch.setenv("AISER_PII_DETECTION", "false")
    monkeypatch.delenv("AISER_PII_COLUMN_MASKING", raising=False)
    from ee.modules.ai.services.pii_gate import scrub_data_payload

    rows = [{"email": "bob@corp.com", "revenue": 100}]
    out = scrub_data_payload(rows, sensitive_columns=["email"], max_rows=5)
    assert out[0]["email"] == "bob@corp.com"


def test_detection_alias_column_masking(monkeypatch):
    monkeypatch.delenv("AISER_PII_DETECTION", raising=False)
    monkeypatch.setenv("AISER_PII_COLUMN_MASKING", "false")
    from src.modules.data.services.pii_settings import is_pii_detection_enabled

    assert is_pii_detection_enabled() is False
