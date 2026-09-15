"""Schema RAG runs only on warehouse-scale schemas — not every Analyze turn."""

from ee.modules.ai.utils.schema_rag_policy import decide_schema_rag
from ee.modules.ai.utils.sql_gen_budget import resolve_sql_gen_budget
from ee.modules.ai.evals.golden_questions import load_golden_questions
from ee.modules.ai.config.workflow_config import WorkflowConfig


def test_schema_rag_skips_small_and_single_table():
    small = decide_schema_rag(n_tables=6, data_source_type="sample_duckdb", data_source_id="ds-1")
    assert small.should_run is False
    assert "below_threshold" in small.reason

    file_src = decide_schema_rag(n_tables=80, data_source_type="csv", data_source_id="ds-1")
    assert file_src.should_run is False
    assert file_src.reason == "single_table"


def test_schema_rag_runs_on_warehouse_and_reuses_cache():
    warehouse = decide_schema_rag(n_tables=40, data_source_type="postgres", data_source_id="ds-1")
    assert warehouse.should_run is True
    assert warehouse.reason == "warehouse_scale"

    reused = decide_schema_rag(
        n_tables=40,
        data_source_type="postgres",
        data_source_id="ds-1",
        cached_table_names=["loans", "customers"],
    )
    assert reused.should_run is False
    assert reused.reason == "reuse_supervisor_cache"


def test_golden_pack_bands_match_sql_budget_and_rag_policy():
    pack = load_golden_questions()
    assert pack["slo"]["simple_analyze_s"] == WorkflowConfig.SLO_SIMPLE_ANALYZE_S
    for q in pack["questions"]:
        budget = resolve_sql_gen_budget({
            "query": q["query"],
            "analytics_type": {
                "standard": "descriptive",
                "conversational": "descriptive",
                "predictive": "predictive",
                "diagnostic": "diagnostic",
                "prescriptive": "prescriptive",
                "decision_intelligence": "decision_intelligence",
                "dashboard": "descriptive",
                "executive_report": "executive_report",
            }.get(q["mode"], "descriptive"),
            "analysis_mode": q["mode"] if q["mode"] not in ("standard", "conversational") else "standard",
            "query_intent": {"query_complexity": "simple" if q["band"] == "simple" else "complex"},
            "data_source_schema": {"tables": [{"name": f"t{i}"} for i in range(q["n_tables"])]},
        })
        rag = decide_schema_rag(
            n_tables=q["n_tables"],
            data_source_type="postgres" if q["n_tables"] >= 10 else "sample_duckdb",
            data_source_id="ds-1",
        )
        assert rag.should_run is q["schema_rag"], q["id"]
        if q["band"] == "simple":
            assert budget.band == "simple", q["id"]
            assert budget.timeout_s <= WorkflowConfig.SLO_SIMPLE_ANALYZE_S + 10
        if q["band"] == "enterprise":
            assert budget.band == "enterprise", q["id"]
            assert budget.timeout_s <= WorkflowConfig.SLO_ENTERPRISE_SQL_GEN_S + 1e-6
