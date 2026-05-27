"""Tests for S3StorageService."""
import sys
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers — patch settings + boto3 before importing the module under test
# ---------------------------------------------------------------------------

def _make_settings(
    access_key="AKID",
    secret_key="SECRET",
    bucket="test-bucket",
    region="us-east-1",
    endpoint_url="",
    provider="aws",
):
    s = MagicMock()
    s.S3_ACCESS_KEY_ID = access_key
    s.S3_SECRET_ACCESS_KEY = secret_key
    s.S3_BUCKET_NAME = bucket
    s.S3_REGION = region
    s.S3_ENDPOINT_URL = endpoint_url
    s.S3_PROVIDER = provider
    return s


def _make_service(settings_mock):
    """Import S3StorageService with patched settings and a mocked boto3 client."""
    mock_client = MagicMock()
    with (
        patch("ee.modules.data.services.s3_storage_service.settings", settings_mock),
        patch("boto3.client", return_value=mock_client),
    ):
        # Re-import to pick up patches
        if "ee.modules.data.services.s3_storage_service" in sys.modules:
            del sys.modules["ee.modules.data.services.s3_storage_service"]
        from ee.modules.data.services.s3_storage_service import S3StorageService
        svc = S3StorageService.__new__(S3StorageService)
        svc.bucket_name = settings_mock.S3_BUCKET_NAME
        svc._client = mock_client
    return svc, mock_client


# ---------------------------------------------------------------------------
# generate_object_key
# ---------------------------------------------------------------------------

def test_generate_object_key_with_org_and_user():
    settings_mock = _make_settings()
    svc, _ = _make_service(settings_mock)
    key = svc.generate_object_key(
        project_id="proj-1",
        filename="data.parquet",
        source_id="src-1",
        organization_id="org-1",
        user_id="user-1",
    )
    assert key == "orgs/org-1/projects/proj-1/data-sources/src-1/compressed/user-1/data.parquet"


def test_generate_object_key_without_org():
    settings_mock = _make_settings()
    svc, _ = _make_service(settings_mock)
    key = svc.generate_object_key(
        project_id="proj-1",
        filename="data.parquet",
        source_id="src-1",
        organization_id=None,
        user_id="user-1",
    )
    assert key == "projects/proj-1/data-sources/src-1/compressed/user-1/data.parquet"


def test_generate_object_key_unknown_user_id_fallback():
    settings_mock = _make_settings()
    svc, _ = _make_service(settings_mock)
    key = svc.generate_object_key(
        project_id="proj-1",
        filename="data.parquet",
        source_id="src-1",
        organization_id="org-1",
        user_id=None,
    )
    assert "/unknown/" in key


# ---------------------------------------------------------------------------
# is_enabled
# ---------------------------------------------------------------------------

def test_is_enabled_true_when_all_creds_present():
    with patch("ee.modules.data.services.s3_storage_service.settings", _make_settings()):
        from ee.modules.data.services.s3_storage_service import S3StorageService
        assert S3StorageService.is_enabled() is True


def test_is_enabled_false_when_access_key_missing():
    with patch("ee.modules.data.services.s3_storage_service.settings", _make_settings(access_key="")):
        from ee.modules.data.services.s3_storage_service import S3StorageService
        assert S3StorageService.is_enabled() is False


def test_is_enabled_false_when_bucket_missing():
    with patch("ee.modules.data.services.s3_storage_service.settings", _make_settings(bucket="")):
        from ee.modules.data.services.s3_storage_service import S3StorageService
        assert S3StorageService.is_enabled() is False


# ---------------------------------------------------------------------------
# store_file
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_store_file_calls_put_object_and_returns_key():
    settings_mock = _make_settings()
    svc, mock_client = _make_service(settings_mock)

    key = await svc.store_file(
        file_content=b"parquet-bytes",
        project_id="proj-1",
        original_filename="sales.parquet",
        content_type="application/x-parquet",
        source_id="src-1",
        organization_id="org-1",
        user_id="user-1",
    )

    mock_client.put_object.assert_called_once()
    call_kwargs = mock_client.put_object.call_args.kwargs
    assert call_kwargs["Bucket"] == "test-bucket"
    assert call_kwargs["Body"] == b"parquet-bytes"
    assert "orgs/org-1/projects/proj-1" in key
    assert "/user-1/" in key


@pytest.mark.asyncio
async def test_store_file_reraises_client_error():
    from botocore.exceptions import ClientError

    settings_mock = _make_settings()
    svc, mock_client = _make_service(settings_mock)
    mock_client.put_object.side_effect = ClientError(
        {"Error": {"Code": "NoSuchBucket", "Message": "bucket missing"}}, "PutObject"
    )

    with pytest.raises(ClientError):
        await svc.store_file(
            file_content=b"bytes",
            project_id="proj-1",
            original_filename="data.parquet",
            content_type="application/x-parquet",
            source_id="src-1",
        )


# ---------------------------------------------------------------------------
# get_file
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_file_returns_body_bytes():
    settings_mock = _make_settings()
    svc, mock_client = _make_service(settings_mock)
    mock_client.get_object.return_value = {"Body": MagicMock(read=lambda: b"file-bytes")}

    result = await svc.get_file("orgs/org-1/projects/proj-1/data-sources/src-1/compressed/user-1/sales.parquet")

    assert result == b"file-bytes"
    mock_client.get_object.assert_called_once_with(
        Bucket="test-bucket",
        Key="orgs/org-1/projects/proj-1/data-sources/src-1/compressed/user-1/sales.parquet",
    )


@pytest.mark.asyncio
async def test_get_file_raises_value_error_on_missing_key():
    from botocore.exceptions import ClientError

    settings_mock = _make_settings()
    svc, mock_client = _make_service(settings_mock)
    mock_client.get_object.side_effect = ClientError(
        {"Error": {"Code": "NoSuchKey", "Message": "not found"}}, "GetObject"
    )

    with pytest.raises(ValueError, match="File not found"):
        await svc.get_file("missing/key.parquet")


# ---------------------------------------------------------------------------
# delete_file
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_file_returns_true_on_success():
    settings_mock = _make_settings()
    svc, mock_client = _make_service(settings_mock)

    result = await svc.delete_file("some/key.parquet")

    assert result is True
    mock_client.delete_object.assert_called_once_with(Bucket="test-bucket", Key="some/key.parquet")


@pytest.mark.asyncio
async def test_delete_file_reraises_client_error():
    from botocore.exceptions import ClientError

    settings_mock = _make_settings()
    svc, mock_client = _make_service(settings_mock)
    mock_client.delete_object.side_effect = ClientError(
        {"Error": {"Code": "AccessDenied", "Message": "denied"}}, "DeleteObject"
    )

    with pytest.raises(ClientError):
        await svc.delete_file("some/key.parquet")
