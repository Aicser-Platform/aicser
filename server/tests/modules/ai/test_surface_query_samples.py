import pytest

from ee.modules.ai.services.surface_query_samples import _limited_sql, enrich_hydration_with_query_samples


def test_limited_sql_wraps_select():
    sql = "SELECT a, b FROM t WHERE x > 1"
    wrapped = _limited_sql(sql)
    assert "LIMIT 8" in wrapped
    assert "_aicser_surface_sample" in wrapped


def test_limited_sql_rejects_dml():
    with pytest.raises(ValueError):
        _limited_sql("DELETE FROM t")


@pytest.mark.asyncio
async def test_enrich_uses_workbook_table_samples_for_facts():
    hydration = {
        "workbook_tables": [
            {
                "name": "Sales",
                "columns": ["region", "amount"],
                "sample_rows": [["North", 100], ["South", 200]],
                "row_count": 2,
            }
        ]
    }
    out = await enrich_hydration_with_query_samples({}, hydration, user_id=None, organization_id=None)
    assert out.get("grounding_query_rows")
    assert out.get("data_facts")
