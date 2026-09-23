import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa


def _batch():
    return pa.RecordBatch.from_pydict(
        {
            "id": pa.array([1, 2], type=pa.int64()),
            "amount": pa.array([10.5, 20.0], type=pa.float64()),
        }
    )


def test_audit_columns_are_the_six_spec_names_in_order():
    from src.modules.pipeline.ingest.base import AUDIT_COLUMNS

    assert AUDIT_COLUMNS == (
        "_op",
        "_ingested_at",
        "_source_offset",
        "_source_event_at",
        "_source_table",
        "_load_id",
    )


def test_add_audit_columns_appends_all_six():
    from src.modules.pipeline.ingest.base import (AUDIT_COLUMNS,
                                                  add_audit_columns)

    load_id = uuid.uuid4()
    out = add_audit_columns(
        _batch(), op="r", load_id=load_id, source_table="public.orders"
    )

    assert out.num_rows == 2
    for name in AUDIT_COLUMNS:
        assert name in out.schema.names
    assert out.column("_op").to_pylist() == ["r", "r"]
    assert out.column("_source_table").to_pylist() == ["public.orders"] * 2
    assert out.column("_load_id").to_pylist() == [str(load_id)] * 2
    assert out.schema.names[:2] == ["id", "amount"]


def test_add_audit_columns_uses_a_source_column_as_the_offset():
    """Watermark ingestion records the watermark value as _source_offset."""
    from src.modules.pipeline.ingest.base import add_audit_columns

    out = add_audit_columns(
        _batch(),
        op="u",
        load_id=uuid.uuid4(),
        source_table="public.orders",
        offset_column="id",
    )
    assert out.column("_source_offset").to_pylist() == ["1", "2"]


def test_add_audit_columns_is_idempotent():
    """Re-adding audit columns must not duplicate them."""
    from src.modules.pipeline.ingest.base import add_audit_columns

    load_id = uuid.uuid4()
    once = add_audit_columns(_batch(), op="r", load_id=load_id, source_table="t")
    twice = add_audit_columns(once, op="r", load_id=load_id, source_table="t")

    assert twice.schema.names == once.schema.names
