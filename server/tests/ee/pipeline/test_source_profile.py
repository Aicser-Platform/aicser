from types import SimpleNamespace

from src.modules.pipeline.ingest.source_profile import (
    DataSourceKind,
    classify_data_source,
    is_file_like_data_source,
)


def test_file_upload_by_type():
    ds = SimpleNamespace(type="file", db_type=None, connection_config={}, file_path="/tmp/x.csv")
    assert classify_data_source(ds) == DataSourceKind.FILE
    assert is_file_like_data_source(ds)


def test_google_sheets():
    ds = SimpleNamespace(
        type="google_sheets",
        db_type=None,
        connection_config={"sheet_url": "https://docs.google.com/spreadsheets/d/abc"},
        file_path=None,
    )
    assert classify_data_source(ds) == DataSourceKind.GOOGLE_SHEETS


def test_postgres_sql():
    ds = SimpleNamespace(
        type="database",
        db_type="postgresql",
        connection_config={"host": "localhost", "database": "app"},
        file_path=None,
    )
    assert classify_data_source(ds) == DataSourceKind.SQL
    assert not is_file_like_data_source(ds)


def test_metadata_only_config_is_file():
    ds = SimpleNamespace(
        type="file",
        db_type=None,
        connection_config={"original_filename": "data.csv"},
        file_path="lake/uploads/x.csv",
    )
    assert classify_data_source(ds) == DataSourceKind.FILE
