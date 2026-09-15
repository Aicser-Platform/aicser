"""Business OS must use the chat-selected source the same way descriptive does."""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.business_journey_nodes import (
    _claims_no_connected_sources,
    _ground_health_brief,
    _merge_data_sources,
    _source_from_workflow_state,
    _sql_table_ref,
    assess_business_node,
)


def test_source_from_workflow_state_matches_descriptive_contract() -> None:
    src = _source_from_workflow_state(
        {
            "data_source_id": "ds-bank",
            "data_source_name": "Sample: Bankin/SEA",
            "data_source_db_type": "duckdb",
            "data_source_type": "sample_duckdb",
            "data_source_schema": {"tables": [{"name": "banking.accounts", "columns": []}]},
        }
    )
    assert src["id"] == "ds-bank"
    assert src["name"] == "Sample: Bankin/SEA"
    assert src["schema"]["tables"][0]["name"] == "banking.accounts"


def test_merge_prefers_selected_then_dedupes_discovered() -> None:
    selected = {"id": "ds-1", "name": "Selected"}
    discovered = [{"id": "ds-1", "name": "Dup"}, {"id": "ds-2", "name": "Other"}]
    merged = _merge_data_sources(selected, discovered)
    assert [s["id"] for s in merged] == ["ds-1", "ds-2"]
    assert merged[0]["name"] == "Selected"


def test_sql_table_ref_qualifies_sample_warehouse_tables() -> None:
    assert _sql_table_ref("banking.accounts") == '"banking"."accounts"'
    assert _sql_table_ref("accounts") == '"accounts"'


def test_ground_health_brief_rejects_zero_source_hallucination() -> None:
    brief = {
        "health_score": 50,
        "executive_summary": "There are zero connected data sources. Flying blind without performance data.",
    }
    out = _ground_health_brief(
        brief,
        [{"source_name": "Sample: Bankin/SEA", "tables": ["accounts", "loans"], "table_count": 2}],
    )
    assert not _claims_no_connected_sources(out["executive_summary"])
    assert "Sample: Bankin/SEA" in out["executive_summary"]
    assert out.get("top_opportunities")
    assert "could not finish" not in (out.get("executive_summary") or "").lower()


def test_grounded_health_fallback_is_actionable_not_apology() -> None:
    from ee.modules.ai.nodes.business_journey_nodes import _grounded_health_fallback
    from ee.modules.ai.utils.business_assess_evidence import build_evidence_pack

    profiles = [
        {
            "source_name": "BB",
            "tables": ["accounts", "branches", "collateral", "customers"],
            "table_count": 4,
        }
    ]
    kpi_evidence = [
        {
            "source_name": "BB",
            "table": "accounts",
            "metric": "current_balance",
            "metrics": {
                "table_name": "accounts",
                "metric_name": "current_balance",
                "record_count": {"cnt": 1200},
                "total_metric": {"total": 1_250_000.5},
            },
        }
    ]
    pack = build_evidence_pack("assess", profiles, [], kpi_evidence)
    brief = _grounded_health_fallback(profiles, pack)
    assert brief["health_score"] >= 55
    assert "BB" in brief["executive_summary"]
    assert "could not finish" not in brief["executive_summary"].lower()
    assert len(brief["top_opportunities"]) >= 1
    assert len(brief["recommended_actions"]) >= 1
    assert brief["recommended_next_action"]
    assert brief.get("score_kind") in ("performance", "mixed", "readiness")


@pytest.mark.asyncio
async def test_assess_uses_selected_source_when_listing_is_empty() -> None:
    state = {
        "query": "How is my business performing across all connected data?",
        "user_id": "u1",
        "organization_id": "org-1",
        "data_source_id": "ds-bank",
        "data_source_name": "Sample: Bankin/SEA",
        "data_source_db_type": "duckdb",
        "data_source_type": "sample_duckdb",
        "data_source_schema": {
            "tables": [
                {
                    "name": "banking.accounts",
                    "columns": [
                        {"name": "account_id", "type": "BIGINT"},
                        {"name": "current_balance", "type": "DOUBLE"},
                    ],
                }
            ]
        },
    }

    async def fake_synth(**kwargs):
        assert kwargs["source_profiles"]
        assert kwargs["source_profiles"][0]["source_name"] == "Sample: Bankin/SEA"
        return {
            "health_score": 72,
            "executive_summary": "Sample: Bankin/SEA shows accounts and balances ready to assess.",
            "top_opportunities": [],
            "top_risks": [],
            "recommended_actions": [],
            "recommended_next_action": "Break down current_balance by product.",
        }

    with patch(
        "ee.modules.ai.nodes.business_journey_nodes._discover_data_sources",
        new=AsyncMock(return_value=[]),
    ), patch(
        "ee.modules.ai.nodes.business_journey_nodes._run_diagnostic_queries",
        new=AsyncMock(return_value={}),
    ), patch(
        "ee.modules.ai.utils.user_preference_store.get_role_tone_instruction",
        return_value="",
    ), patch(
        "ee.modules.ai.nodes.business_journey_nodes._synthesize_business_health",
        new=fake_synth,
    ):
        out = await assess_business_node(state)

    assert "No data sources are connected yet" not in (out.get("message") or "")
    assert "Sample: Bankin/SEA" in (out.get("executive_summary") or "")
    assert out.get("business_state_snapshot", {}).get("data_source_count") == 1
