"""Generalized Business OS Assess evidence — any schema / any question."""

from ee.modules.ai.utils.business_assess_evidence import (
    analyse_prompt_for_kpi,
    build_evidence_pack,
    classify_score_kind,
    decide_prompt_for_kpi,
    discover_kpi_candidates,
    score_from_evidence,
)
from ee.modules.ai.nodes.business_journey_nodes import _grounded_health_fallback


def _banking_profile() -> dict:
    return {
        "source_id": "ds-bank",
        "source_name": "BB",
        "db_type": "duckdb",
        "type": "sample_duckdb",
        "table_count": 4,
        "tables": ["banking.accounts", "banking.loans", "banking.customers", "banking.payments"],
        "schema": {
            "tables": [
                {
                    "name": "banking.accounts",
                    "columns": [
                        {"name": "account_id", "type": "BIGINT"},
                        {"name": "current_balance", "type": "DOUBLE"},
                        {"name": "available_balance", "type": "DOUBLE"},
                        {"name": "opened_at", "type": "TIMESTAMP"},
                        {"name": "branch_code", "type": "VARCHAR"},
                    ],
                    "row_count": 1200,
                },
                {
                    "name": "banking.loans",
                    "columns": [
                        {"name": "loan_id", "type": "BIGINT"},
                        {"name": "principal", "type": "DOUBLE"},
                        {"name": "interest_rate", "type": "DOUBLE"},
                        {"name": "status", "type": "VARCHAR"},
                    ],
                    "row_count": 400,
                },
            ]
        },
    }


def _saas_profile() -> dict:
    return {
        "source_id": "ds-saas",
        "source_name": "Product Analytics",
        "db_type": "postgres",
        "type": "database",
        "table_count": 2,
        "tables": ["subscriptions", "events"],
        "schema": {
            "tables": [
                {
                    "name": "subscriptions",
                    "columns": [
                        {"name": "id", "type": "BIGINT"},
                        {"name": "mrr", "type": "NUMERIC"},
                        {"name": "churn_rate", "type": "NUMERIC"},
                        {"name": "plan_name", "type": "VARCHAR"},
                        {"name": "created_at", "type": "TIMESTAMP"},
                    ],
                    "row_count": 900,
                }
            ]
        },
    }


def test_discover_kpi_candidates_banking_balance_intent():
    cands = discover_kpi_candidates(
        "please assess and improve my business performance",
        [_banking_profile()],
        max_candidates=5,
    )
    assert cands
    metrics = [c.get("metric") for c in cands if c.get("metric")]
    assert any(
        m and ("balance" in m.lower() or "principal" in m.lower())
        for m in metrics
    )


def test_discover_kpi_candidates_saas_revenue_intent():
    cands = discover_kpi_candidates(
        "how is our subscription revenue and churn?",
        [_saas_profile()],
        max_candidates=4,
    )
    assert cands
    top = cands[0]
    assert top.get("metric")
    assert "mrr" in str(top.get("metric")).lower() or "churn" in str(top.get("metric")).lower()


def test_evidence_pack_score_kind_readiness_vs_performance():
    profiles = [_banking_profile()]
    cands = discover_kpi_candidates("assess performance", profiles)
    readiness = build_evidence_pack("assess", profiles, cands, [])
    assert readiness["score_kind"] == "readiness"

    kpi_evidence = [
        {
            "source_name": "BB",
            "table": "banking.accounts",
            "metric": "current_balance",
            "metrics": {
                "record_count": {"cnt": 1200},
                "total_metric": {"total": 1_250_000.0, "avg": 1041.0},
            },
        },
        {
            "source_name": "BB",
            "table": "banking.loans",
            "metric": "principal",
            "metrics": {
                "record_count": {"cnt": 400},
                "total_metric": {"total": 800_000.0},
            },
        },
    ]
    perf = build_evidence_pack("assess", profiles, cands, kpi_evidence)
    assert perf["score_kind"] in ("performance", "mixed")
    assert perf["health_score"] >= readiness["health_score"]


def test_fallback_uses_dynamic_kpi_prompts_not_apology():
    profiles = [_banking_profile()]
    cands = discover_kpi_candidates("assess my business", profiles)
    kpi_evidence = [
        {
            "source_name": "BB",
            "table": "banking.accounts",
            "metric": "current_balance",
            "metrics": {
                "record_count": {"cnt": 1200},
                "total_metric": {"total": 1_250_000.0},
            },
        }
    ]
    pack = build_evidence_pack("assess", profiles, cands, kpi_evidence)
    brief = _grounded_health_fallback(profiles, pack)
    assert "could not finish" not in brief["executive_summary"].lower()
    assert brief.get("score_kind") in ("performance", "mixed", "readiness")
    assert brief["top_opportunities"]
    assert "Analyse" in brief["recommended_next_action"] or "analyse" in brief["recommended_next_action"].lower()
    assert analyse_prompt_for_kpi(kpi_evidence[0])
    assert "Decide" in decide_prompt_for_kpi(kpi_evidence[0])


def test_classify_score_kind_empty_is_readiness():
    assert classify_score_kind([]) == "readiness"
    assert 32 <= score_from_evidence([], [], "readiness") <= 88
