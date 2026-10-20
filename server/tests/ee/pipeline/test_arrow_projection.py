import pyarrow as pa

from src.modules.pipeline.ingest.arrow_projection import apply_table_projection


def test_select_and_rename():
    table = pa.table({"id": [1], "email": ["a@b.c"]})
    out = apply_table_projection(table, ["id", "email"], {"email": "email_hash"})
    assert out.column_names == ["id", "email_hash"]
