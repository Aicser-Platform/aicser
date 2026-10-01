"""Animate/diagnose categories: "by branch" follows loans.branch_id to branches.name, and a
numeric measure the question mentions ("loan principal" ~ outstanding_principal) is never
used as the category."""

from ee.modules.ai.nodes.supervisor.delegation import _infer_animate_params_from_tables, dimension_from_by_phrase
from ee.modules.ai.utils.mode_sql_builders import build_animate_frames_sql

SCHEMA = {"tables": [
    {"name": "loans", "schema": "banking", "columns": [
        {"name": "loan_id", "type": "BIGINT"}, {"name": "branch_id", "type": "BIGINT"},
        {"name": "disbursement_date", "type": "TIMESTAMP"}, {"name": "principal_amount", "type": "DOUBLE"},
        {"name": "outstanding_principal", "type": "DOUBLE"}, {"name": "npl_flag", "type": "BOOLEAN"}]},
    {"name": "branches", "schema": "banking", "columns": [
        {"name": "branch_id", "type": "BIGINT"}, {"name": "name", "type": "VARCHAR"}]},
    {"name": "customers", "schema": "banking", "columns": [
        {"name": "customer_id", "type": "BIGINT"}, {"name": "name", "type": "VARCHAR"}]},
]}


def test_by_phrase_follows_foreign_key_to_label():
    loans = SCHEMA["tables"][0]["columns"]
    assert dimension_from_by_phrase("Animate loan principal by branch over time.", loans, SCHEMA["tables"]) == ("name", "branches")
    assert dimension_from_by_phrase("revenue per branches", loans, SCHEMA["tables"]) == ("name", "branches")
    assert dimension_from_by_phrase("total principal", loans, SCHEMA["tables"]) is None


def test_numeric_measure_is_never_the_category():
    p = _infer_animate_params_from_tables(SCHEMA, "Animate loan principal by branch over time.")
    assert p["target_metric"] == "principal_amount"
    assert p["focus_dimension"] == "name" and p["focus_dimension_table"] == "branches"


def test_builder_binds_the_hinted_table_not_the_first_name_column():
    sql = build_animate_frames_sql(SCHEMA, time_column="disbursement_date", target_metric="principal_amount",
                                   focus_dimension="name", focus_dimension_table="branches", db_type="duckdb")
    assert 'JOIN' in sql and '"branches"' in sql and 'f."branch_id" = d."branch_id"' in sql
    assert '"customers"' not in sql
