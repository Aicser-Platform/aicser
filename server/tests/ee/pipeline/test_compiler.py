import os
from pathlib import Path

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def _doc(name="orders_gold.yml"):
    from src.modules.pipeline.transform.compiler import parse_yaml

    return parse_yaml((FIXTURES / name).read_text())


def test_parse_yaml_reads_all_sections():
    doc = _doc()
    assert doc.version == 1
    assert doc.source["asset"] == "bronze.orders"
    assert len(doc.transform) == 6
    assert doc.output.table == "sales_by_region"
    assert doc.output.write_mode == "merge"
    assert doc.output.primary_key == ["region", "month"]
    assert doc.semantic["metrics"][0]["name"] == "revenue"


def test_compile_produces_one_statement_with_one_cte_per_step():
    from src.modules.pipeline.transform.compiler import compile_transform

    out = compile_transform(
        _doc(), source_sql="SELECT * FROM read_parquet('s3://b/o/*.parquet')"
    )

    assert out.sql.count(";") == 0, "the transform must be a single statement"
    assert out.sql.startswith("WITH ")
    assert out.cte_names == ["s0", "s1", "s2", "s3", "s4", "s5", "s6"]
    assert out.sql.rstrip().endswith("SELECT * FROM s6")
    assert "s0 AS (SELECT * FROM read_parquet(" in out.sql


def test_compile_emits_a_quarantine_query_for_the_validate_step():
    from src.modules.pipeline.transform.compiler import compile_transform

    out = compile_transform(_doc(), source_sql="SELECT 1")

    assert out.quarantine_sql is not None
    assert "_quarantine_reason" in out.quarantine_sql
    assert "FROM s3" in out.quarantine_sql


def test_compile_up_to_step_truncates_the_chain_for_preview():
    from src.modules.pipeline.transform.compiler import compile_transform

    out = compile_transform(_doc(), source_sql="SELECT 1", up_to_step=2, limit=100)

    assert out.cte_names == ["s0", "s1", "s2"]
    assert out.sql.rstrip().endswith("SELECT * FROM s2 LIMIT 100")
    assert "aggregate" not in out.sql.lower()


def test_compile_rejects_an_unknown_step_with_its_index():
    from src.modules.pipeline.transform.compiler import (compile_transform,
                                                         parse_yaml)

    doc = parse_yaml(
        "version: 1\n"
        "source: {asset: b.o}\n"
        "transform:\n"
        '  - filter: {where: "1=1"}\n'
        "  - frobnicate: {}\n"
        "output: {layer: silver, table: t, write_mode: append}\n"
    )
    with pytest.raises(ValueError, match="step 1"):
        compile_transform(doc, source_sql="SELECT 1")


def test_merge_write_mode_requires_a_primary_key():
    from src.modules.pipeline.transform.compiler import parse_yaml

    with pytest.raises(ValueError, match="primary_key"):
        parse_yaml(
            "version: 1\n"
            "source: {asset: b.o}\n"
            "transform: []\n"
            "output: {layer: silver, table: t, write_mode: merge}\n"
        )
