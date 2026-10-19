from types import SimpleNamespace

from src.modules.pipeline.bronze_disposition import (
    DISPOSITION_ARCHIVE,
    effective_bronze_disposition,
)


def test_disposition_pipeline_overrides_org():
    pipeline = SimpleNamespace(options={"movement_policy": {"bronze_disposition": "archive"}})
    assert effective_bronze_disposition(pipeline, {"default_bronze_disposition": "retain"}) == DISPOSITION_ARCHIVE
