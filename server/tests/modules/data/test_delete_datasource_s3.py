"""Tests for data source deletion and S3/storage cleanup."""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

try:
    import pytest
except ImportError:
    pytest = MagicMock()
    pytest.mark = MagicMock()
    pytest.mark.asyncio = lambda f: f
from botocore.exceptions import ClientError

from src.modules.data.services.s3_storage_cleanup_service import (
    parse_s3_uri,
    _resolve_s3_client_config,
    extract_datasource_keys_and_config,
    delete_s3_file,
    delete_datasource_storage_files,
)


def test_parse_s3_uri():
    bucket, key = parse_s3_uri("s3://test-bucket/folder/file.parquet")
    assert bucket == "test-bucket"
    assert key == "folder/file.parquet"

    bucket, key = parse_s3_uri("projects/p1/data-sources/s1/compressed/user/file.parquet")
    assert bucket is None
    assert key == "projects/p1/data-sources/s1/compressed/user/file.parquet"

    bucket, key = parse_s3_uri("")
    assert bucket is None
    assert key == ""


def test_extract_datasource_keys_and_config():
    ds_dict = {
        "id": "ds-12345",
        "file_path": "projects/p1/data-sources/ds-12345/compressed/user/file.parquet",
        "connection_config": {
            "s3_key": "custom/s3/path.csv",
            "bucket_name": "custom-bucket",
            "aws_access_key_id": "CUSTOM_KEY",
            "aws_secret_access_key": "CUSTOM_SECRET",
        },
        "schema": {
            "storage": {
                "object_key": "schema/key.parquet",
            }
        },
    }

    keys, bucket, custom_cfg, source_prefix = extract_datasource_keys_and_config(ds_dict)

    assert "projects/p1/data-sources/ds-12345/compressed/user/file.parquet" in keys
    assert "custom/s3/path.csv" in keys
    assert "schema/key.parquet" in keys
    assert bucket == "custom-bucket"
    assert custom_cfg["aws_access_key_id"] == "CUSTOM_KEY"
    assert source_prefix == "projects/p1/data-sources/ds-12345/"


@pytest.mark.asyncio
async def test_delete_s3_file_success():
    mock_s3 = MagicMock()
    mock_s3.delete_object = MagicMock(return_value={})
    mock_s3.get_paginator = MagicMock()
    mock_paginator = MagicMock()
    mock_paginator.paginate = MagicMock(return_value=[])
    mock_s3.get_paginator.return_value = mock_paginator

    with patch("boto3.client", return_value=mock_s3):
        res = await delete_s3_file(
            key_or_uri="s3://test-bucket/my-file.parquet",
            prefix_to_purge="data-sources/ds-123/",
        )
        assert res["success"] is True
        assert "s3://test-bucket/my-file.parquet" in res["deleted"]
        mock_s3.delete_object.assert_called_once_with(
            Bucket="test-bucket",
            Key="my-file.parquet",
        )


@pytest.mark.asyncio
async def test_delete_s3_file_not_found_is_treated_as_success():
    mock_s3 = MagicMock()
    mock_s3.delete_object.side_effect = ClientError(
        {"Error": {"Code": "NoSuchKey", "Message": "The specified key does not exist."}},
        "DeleteObject",
    )
    mock_s3.get_paginator.return_value.paginate.return_value = []

    with patch("boto3.client", return_value=mock_s3):
        res = await delete_s3_file("s3://test-bucket/absent-file.parquet")
        assert res["success"] is True
        assert "s3://test-bucket/absent-file.parquet" in res["deleted"]


@pytest.mark.asyncio
async def test_delete_datasource_storage_files_comprehensive():
    ds_mock = MagicMock()
    ds_mock.id = "src-999"
    ds_mock.project_id = "proj-1"
    ds_mock.file_path = "projects/proj-1/data-sources/src-999/compressed/u1/file.parquet"
    ds_mock.connection_config = None
    ds_mock.schema = None

    with (
        patch("src.modules.data.services.s3_storage_cleanup_service.delete_s3_file", new_callable=AsyncMock) as mock_s3_del,
        patch("src.modules.data.services.upload_datasource_storage_service.UploadDatasourceStorageService.delete_file", new_callable=AsyncMock) as mock_storage_del,
    ):
        mock_s3_del.return_value = {"success": True, "deleted": ["s3://bucket/test"], "errors": []}
        mock_storage_del.return_value = True

        result = await delete_datasource_storage_files(ds_mock, project_id="proj-1")

        assert result["success"] is True
        assert result["s3_deleted"] is True
        mock_s3_del.assert_called_once()
        mock_storage_del.assert_called_once()


if __name__ == "__main__":
    import asyncio

    async def main():
        import inspect
        current_module = sys.modules[__name__]
        for name, obj in inspect.getmembers(current_module):
            if name.startswith("test_") and inspect.isfunction(obj):
                print(f"Running {name}...")
                if inspect.iscoroutinefunction(obj):
                    await obj()
                else:
                    obj()
                print(f"  Passed: {name}")
        print("\nAll S3 deletion tests passed successfully!")

    asyncio.run(main())
