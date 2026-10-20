"""Shared S3-compatible client settings (AWS, Azure S3 API, GCS interop, MinIO, R2, …)."""

from __future__ import annotations

from typing import Any


def normalize_storage_provider(provider: Any) -> str:
    return str(provider or "aws").strip().lower() or "aws"


def s3_addressing_style(provider: Any, endpoint_url: str | None) -> str:
    """Path-style is required for most non-AWS endpoints and GCS/Azure S3 interop."""
    p = normalize_storage_provider(provider)
    if endpoint_url and str(endpoint_url).strip():
        return "path"
    if p in ("aws", "amazon"):
        return "virtual"
    return "path"


def interop_access_keys(credentials: dict[str, Any] | None) -> tuple[str, str] | None:
    if not credentials:
        return None
    key = credentials.get("access_key") or credentials.get("access_key_id")
    secret = credentials.get("secret_key") or credentials.get("secret_access_key")
    if key and secret:
        return str(key), str(secret)
    return None


def bucket_from_storage_uri(storage_uri: str) -> str | None:
    """Best-effort bucket/container name for S3-compatible probes."""
    from urllib.parse import urlparse

    uri = (storage_uri or "").strip()
    if not uri:
        return None
    parsed = urlparse(uri)
    scheme = (parsed.scheme or "").lower()
    if scheme in ("s3", "s3a", "gs", "gcs"):
        return parsed.netloc or None
    if scheme == "azure":
        if parsed.netloc:
            return parsed.netloc
        parts = parsed.path.strip("/").split("/")
        return parts[0] if parts else None
    return None


def default_s3_endpoint(provider: Any, credentials: dict[str, Any] | None) -> str | None:
    creds = credentials or {}
    explicit = creds.get("endpoint") or creds.get("endpoint_url")
    if explicit:
        return str(explicit).strip() or None
    p = normalize_storage_provider(creds.get("provider") or provider)
    if p == "gcp":
        return "https://storage.googleapis.com"
    if p == "azure":
        account = str(creds.get("account_name") or "").strip()
        if account:
            return f"https://{account}.blob.core.windows.net"
    return None


def probe_s3_compatible_access(storage_uri: str, credentials: dict[str, Any]) -> tuple[bool, str]:
    """Lightweight head_bucket check using boto3 S3 API (incl. Azure/GCS interop)."""
    keys = interop_access_keys(credentials)
    if not keys:
        return False, "S3-compatible access_key and secret_key are required"
    bucket = bucket_from_storage_uri(storage_uri)
    if not bucket:
        return False, f"Could not parse bucket from storage URI: {storage_uri}"
    try:
        import boto3
        from botocore.config import Config
        from botocore.exceptions import ClientError

        provider = normalize_storage_provider(credentials.get("provider"))
        endpoint = default_s3_endpoint(provider, credentials)
        region = str(credentials.get("region") or "us-east-1")
        client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=keys[0],
            aws_secret_access_key=keys[1],
            region_name=region,
            config=Config(s3={"addressing_style": s3_addressing_style(provider, endpoint)}),
        )
        client.head_bucket(Bucket=bucket)
        return True, f"Bucket {bucket!r} is reachable via S3-compatible API"
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "ClientError")
        return False, f"S3-compatible probe failed ({code}): {exc}"
    except Exception as exc:  # noqa: BLE001
        return False, f"S3-compatible probe failed: {exc}"


# What S3 error codes mean to someone setting up storage.
_PROBE_HINTS = {
    "NoSuchBucket": "The bucket doesn't exist (check its name and region).",
    "InvalidAccessKeyId": "The access key isn't recognised.",
    "SignatureDoesNotMatch": "The secret key doesn't match the access key.",
    "AccessDenied": "These keys can't {action} in this bucket. The lake needs read, write and delete on {where}.",
    "AllAccessDisabled": "Access to this bucket is disabled.",
    "PermanentRedirect": "The bucket is in another region; set the region it lives in.",
    "AuthorizationHeaderMalformed": "The region doesn't match the bucket's region.",
}


def probe_bucket_write(client: Any, bucket: str, prefix: str = "") -> dict[str, Any]:
    """Prove a lake can live here: write a small object under `prefix`, read it back, delete
    it. A reachable bucket the keys can only read passes head_bucket but fails the first sync,
    so this is the check to run before saving or using lake storage. Never raises."""
    import uuid

    key = f"{prefix.strip('/') + '/' if prefix.strip('/') else ''}_aicser/write-check-{uuid.uuid4().hex}.txt"
    where = f"s3://{bucket}/{prefix.strip('/') + '/' if prefix.strip('/') else ''}"
    action = "write"
    try:
        client.put_object(Bucket=bucket, Key=key, Body=b"aicser lake write check")
        action = "read"
        body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
        if body != b"aicser lake write check":
            return {"ok": False, "code": "Mismatch", "message": "The bucket returned different content than was written."}
        action = "delete"
        client.delete_object(Bucket=bucket, Key=key)
        return {"ok": True, "code": None, "message": f"Can write, read and delete in {where}"}
    except Exception as exc:  # noqa: BLE001 - every failure becomes a readable reason
        code = ""
        response = getattr(exc, "response", None)
        if isinstance(response, dict):
            code = str((response.get("Error") or {}).get("Code") or "")
        hint = _PROBE_HINTS.get(code)
        if hint:
            message = hint.format(action=action, where=where)
        elif type(exc).__name__ in ("EndpointConnectionError", "ConnectTimeoutError", "ConnectionClosedError"):
            code = code or "Unreachable"
            message = "The storage endpoint can't be reached from the server (check the endpoint URL and network)."
        else:
            message = str(exc) or type(exc).__name__
        return {"ok": False, "code": code or type(exc).__name__, "message": message}


def s3_client_for(*, access_key_id: str, secret_access_key: str, region: str | None, endpoint_url: str | None, provider: Any = None) -> Any:
    """A boto3 S3 client with the addressing style this provider needs."""
    import boto3
    from botocore.config import Config

    endpoint = (endpoint_url or "").strip() or None
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key_id,
        aws_secret_access_key=secret_access_key,
        region_name=region or "us-east-1",
        config=Config(
            s3={"addressing_style": s3_addressing_style(provider, endpoint)},
            connect_timeout=5,
            read_timeout=15,
            retries={"max_attempts": 2},
        ),
    )


def duckdb_endpoint(endpoint: str | None) -> tuple[str | None, bool]:
    """DuckDB wants the endpoint as a bare host[:port] and SSL as a separate setting:
    "http://minio:9000" → ("minio:9000", False); "https://x.r2.cloudflarestorage.com/" → (host, True)."""
    raw = (endpoint or "").strip()
    if not raw:
        return None, True
    use_ssl = not raw.lower().startswith("http://")
    host = raw.split("://", 1)[-1].rstrip("/")
    return host or None, use_ssl


def bucket_encryption(client: Any, bucket: str) -> dict[str, Any]:
    """How a bucket encrypts new objects by default: {"encrypted": True/False/None, "algorithm",
    "kms_key"}. None means the provider doesn't say (no GetBucketEncryption support). Iceberg
    files can't ask for encryption per object, so the bucket default is what protects them."""
    try:
        rules = client.get_bucket_encryption(Bucket=bucket)["ServerSideEncryptionConfiguration"]["Rules"]
    except Exception as exc:  # noqa: BLE001
        code = str((getattr(exc, "response", None) or {}).get("Error", {}).get("Code") or "")
        if code == "ServerSideEncryptionConfigurationNotFoundError":
            return {"encrypted": False, "algorithm": None, "kms_key": None}
        return {"encrypted": None, "algorithm": None, "kms_key": None}
    default = (rules[0] if rules else {}).get("ApplyServerSideEncryptionByDefault") or {}
    algorithm = default.get("SSEAlgorithm")
    return {"encrypted": bool(algorithm), "algorithm": algorithm, "kms_key": default.get("KMSMasterKeyID")}
