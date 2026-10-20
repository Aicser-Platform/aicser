"""Sync mode → pipeline ingest_mode mapping."""

import os
from types import SimpleNamespace

os.environ.setdefault("AISER_EDITION", "enterprise")

from src.modules.pipeline.sync.ingest_mode import derive_pipeline_ingest_mode, sync_mode_to_ingest


def test_sync_mode_to_ingest():
    assert sync_mode_to_ingest("full_refresh") == "snapshot"
    assert sync_mode_to_ingest("incremental") == "incremental"
    assert sync_mode_to_ingest("cdc") == "cdc"
    assert sync_mode_to_ingest("log_cdc") == "log_cdc"


def test_derive_pipeline_ingest_mode():
    def s(mode):
        return SimpleNamespace(sync_mode=mode)

    assert derive_pipeline_ingest_mode([s("full_refresh")]) == "snapshot"
    assert derive_pipeline_ingest_mode([s("incremental")]) == "incremental"
    assert derive_pipeline_ingest_mode([s("cdc")]) == "cdc"
    assert derive_pipeline_ingest_mode([s("full_refresh"), s("incremental")]) == "incremental"
    assert derive_pipeline_ingest_mode([s("incremental"), s("cdc")]) == "cdc"
    assert derive_pipeline_ingest_mode([s("log_cdc")]) == "log_cdc"
    assert derive_pipeline_ingest_mode([s("cdc"), s("log_cdc")]) == "log_cdc"
