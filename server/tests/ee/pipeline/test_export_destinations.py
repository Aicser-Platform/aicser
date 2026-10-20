import os
from types import SimpleNamespace

os.environ.setdefault("AISER_EDITION", "enterprise")

from src.modules.pipeline.load.export_destinations import (
    infer_export_type_from_data_source,
    merge_destination_config,
    normalize_export_type,
)


def test_normalize_export_type_aliases():
    assert normalize_export_type("mssql") == "sqlserver"
    assert normalize_export_type("xlsx") == "excel"


def test_infer_file_from_data_source():
    assert infer_export_type_from_data_source("file", ds_type="file", db_type="csv") == "csv"


def test_merge_destination_config_includes_file_path():
    ds = SimpleNamespace(file_path="orgs/x/out.csv", format="csv", db_type=None, connection_config={})
    merged = merge_destination_config(ds, ds.connection_config)
    assert merged["file_path"] == "orgs/x/out.csv"
    assert merged["format"] == "csv"
