"""
The old DATE_OF_BIRTH regex matched ANY date-shaped string (DD/MM/YYYY,
MM/DD/YYYY, YYYY/MM/DD) with zero context - a report date, a transaction
date, or a SQL date literal like `= '2024-02-01'` are indistinguishable from
an actual birthdate under that pattern alone. Live impact: PII scrubbing
runs on every LLM prompt (including conversation history), so a prior
turn's generated SQL embedded in context got its date literal replaced with
the literal string "<DATE_OF_BIRTH>" before the LLM ever saw it - which the
LLM then echoed verbatim into a follow-up query's SQL, breaking it with a
DuckDB "invalid timestamp field format" error.

Fix: a date is only scrubbed as DATE_OF_BIRTH when an actual birth-context
keyword appears nearby, in the same multilingual breadth this file already
uses for column-name detection (not English-only).
"""

import pytest

from src.modules.data.services.pii_scrubber import pii_scrubber


@pytest.fixture(autouse=True)
def force_regex_fallback(monkeypatch):
    """Match this repo's own convention (see test_pii_gate.py) for exercising
    the regex tier deterministically regardless of whether Presidio happens
    to be installed in the environment running the suite."""
    import src.modules.data.services.pii_scrubber as pii_module

    monkeypatch.setattr(pii_module, "_presidio_analyzer", None)
    monkeypatch.setattr(pii_module, "_presidio_anonymizer", None)


def test_sql_date_literal_is_not_scrubbed():
    sql = (
        "SELECT loan_id FROM banking.loans WHERE date_trunc('MONTH', disbursement_date) "
        "= '2024-02-01' AND principal_amount > 100 ORDER BY disbursement_date LIMIT 1000;"
    )
    assert pii_scrubber.scrub_text(sql) == sql


def test_unrelated_business_date_is_not_scrubbed():
    text = "Report generated for 05/12/2024, revenue up 10% month over month."
    assert pii_scrubber.scrub_text(text) == text


@pytest.mark.parametrize(
    "text",
    [
        "Customer date of birth: 12/05/1990, please verify.",
        "He was born on 12/05/1990 in Boston.",
        "Fecha de nacimiento: 12/05/1990",  # Spanish
        "Date de naissance : 12/05/1990",  # French
        "Geburtsdatum: 12.05.1990",  # German
        "Ngày sinh của khách hàng: 12/05/1990",  # Vietnamese
        "Tanggal lahir: 12/05/1990",  # Indonesian
        "客户出生日期: 1990-05-12",  # Chinese
        "生年月日: 1990-05-12",  # Japanese
        "생년월일: 1990-05-12",  # Korean
    ],
)
def test_actual_birth_date_mentions_are_still_scrubbed(text):
    result = pii_scrubber.scrub_text(text)
    assert "<DATE_OF_BIRTH>" in result
    assert "1990" not in result
