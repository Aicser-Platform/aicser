from types import SimpleNamespace

from src.modules.pipeline.pipeline_capabilities import (
    PipelineSupport,
    is_http_api_data_source,
    is_object_storage_data_source,
    pipeline_support_level,
    supports_incremental_sync,
    supports_pipeline_ingest,
)


def test_s3_object_storage_snapshot():
    ds = SimpleNamespace(
        type="warehouse",
        db_type="s3_parquet",
        format="s3_parquet",
        connection_config={"bucket_name": "lake", "prefix": "raw/"},
    )
    assert is_object_storage_data_source(ds)
    assert pipeline_support_level(ds) == PipelineSupport.SNAPSHOT
    assert supports_pipeline_ingest(ds)
    assert not supports_incremental_sync(ds)


def test_api_source_snapshot():
    ds = SimpleNamespace(
        type="api",
        db_type=None,
        connection_config={"url": "https://api.example.com/v1/items"},
    )
    assert is_http_api_data_source(ds)
    assert pipeline_support_level(ds) == PipelineSupport.SNAPSHOT


def test_postgres_full():
    ds = SimpleNamespace(
        type="database",
        db_type="postgresql",
        connection_config={"host": "localhost", "database": "app"},
    )
    assert pipeline_support_level(ds) == PipelineSupport.FULL
    assert supports_incremental_sync(ds)


def test_knowledge_base_query_only():
    ds = SimpleNamespace(type="knowledge_base", db_type=None, connection_config={})
    assert pipeline_support_level(ds) == PipelineSupport.QUERY_ONLY
    assert not supports_pipeline_ingest(ds)
