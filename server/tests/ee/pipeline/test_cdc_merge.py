import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa

from src.modules.pipeline.load.cdc_merge import (
    split_cdc_upsert_and_deletes,
    strip_audit_columns,
)


def test_split_cdc_upsert_and_deletes():
    table = pa.table(
        {
            "id": [1, 2, 3],
            "name": ["a", "b", "c"],
            "_op": ["c", "d", "u"],
        }
    )
    deletes, upserts = split_cdc_upsert_and_deletes(table, ["id"])
    assert deletes.to_pylist() == [{"id": 2}]
    assert upserts.num_rows == 2
    assert set(upserts.column("_op").to_pylist()) == {"c", "u"}


def test_strip_audit_columns():
    table = pa.table({"id": [1], "_op": ["d"], "_load_id": ["x"]})
    stripped = strip_audit_columns(table)
    assert stripped.schema.names == ["id"]
