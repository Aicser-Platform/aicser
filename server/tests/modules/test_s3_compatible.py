from src.modules.data.utils.s3_compatible import (
    bucket_from_storage_uri,
    default_s3_endpoint,
    interop_access_keys,
    s3_addressing_style,
)


def test_addressing_style():
    assert s3_addressing_style("aws", None) == "virtual"
    assert s3_addressing_style("aws", "https://s3.amazonaws.com") == "path"
    assert s3_addressing_style("azure", "https://acct.blob.core.windows.net") == "path"
    assert s3_addressing_style("gcp", "https://storage.googleapis.com") == "path"


def test_interop_keys_aliases():
    assert interop_access_keys({"access_key_id": "a", "secret_access_key": "b"}) == ("a", "b")


def test_bucket_from_uri():
    assert bucket_from_storage_uri("s3://my-bucket/prefix") == "my-bucket"
    assert bucket_from_storage_uri("azure://container/path") == "container"
    assert bucket_from_storage_uri("gs://lake/data") == "lake"


def test_default_endpoint_azure_gcp():
    assert default_s3_endpoint("gcp", {}) == "https://storage.googleapis.com"
    assert default_s3_endpoint("azure", {"account_name": "acct"}) == "https://acct.blob.core.windows.net"
