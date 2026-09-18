"""
S3 and object storage cleanup service for Data Sources.
Safely detects and deletes all S3 objects and local/cloud storage files
associated with a data source when it is deleted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from src.core.config import settings
from src.modules.data.utils.credentials import decrypt_credentials

logger = logging.getLogger(__name__)


def parse_s3_uri(uri: str) -> Tuple[Optional[str], str]:
    """Parse an S3 URI or key.

    Returns (bucket, key). If uri is not 's3://...', bucket will be None.
    """
    cleaned = str(uri or "").strip()
    match = re.match(r"^s3://([^/]+)/(.*)$", cleaned)
    if match:
        return match.group(1), match.group(2)
    if cleaned.startswith("s3://"):
        return cleaned[5:].rstrip("/"), ""
    return None, cleaned


def _resolve_s3_client_config(
    custom_config: Optional[Dict[str, Any]] = None,
    runtime_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Resolve S3 credentials, bucket, and endpoint from custom config, runtime, or env."""
    custom = custom_config or {}
    runtime = runtime_config or {}

    access_key = (
        custom.get("aws_access_key_id")
        or custom.get("access_key_id")
        or runtime.get("access_key_id")
        or settings.S3_ACCESS_KEY_ID
        or os.getenv("AWS_ACCESS_KEY_ID", "").strip()
    )
    secret_key = (
        custom.get("aws_secret_access_key")
        or custom.get("secret_access_key")
        or runtime.get("secret_access_key")
        or settings.S3_SECRET_ACCESS_KEY
        or os.getenv("AWS_SECRET_ACCESS_KEY", "").strip()
    )
    bucket = (
        custom.get("bucket_name")
        or custom.get("bucket")
        or custom.get("s3_bucket")
        or runtime.get("bucket_name")
        or settings.S3_BUCKET_NAME
        or os.getenv("AWS_BUCKET_NAME", "").strip()
    )
    region = (
        custom.get("aws_region")
        or custom.get("region")
        or runtime.get("region")
        or settings.S3_REGION
        or os.getenv("AWS_REGION", "us-east-1").strip()
        or "us-east-1"
    )
    endpoint_url = (
        custom.get("endpoint_url")
        or custom.get("s3_endpoint")
        or runtime.get("endpoint_url")
        or settings.S3_ENDPOINT_URL
        or os.getenv("AWS_ENDPOINT_URL", "").strip()
        or None
    )

    return {
        "access_key": str(access_key or "").strip(),
        "secret_key": str(secret_key or "").strip(),
        "bucket": str(bucket or "").strip(),
        "region": str(region or "us-east-1").strip(),
        "endpoint_url": str(endpoint_url).strip() if endpoint_url else None,
    }


def _get_boto3_s3_client(s3_config: Dict[str, Any]):
    """Create a boto3 S3 client with the resolved configuration."""
    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        logger.warning("boto3 is not available; S3 deletion cannot be performed via direct client")
        return None

    access_key = s3_config.get("access_key")
    secret_key = s3_config.get("secret_key")
    region = s3_config.get("region") or "us-east-1"
    endpoint_url = s3_config.get("endpoint_url")

    addressing_style = "path" if endpoint_url else "virtual"
    client_kwargs: Dict[str, Any] = {
        "service_name": "s3",
        "region_name": region,
        "config": Config(s3={"addressing_style": addressing_style}),
    }

    if endpoint_url:
        client_kwargs["endpoint_url"] = endpoint_url
    if access_key and secret_key:
        client_kwargs["aws_access_key_id"] = access_key
        client_kwargs["aws_secret_access_key"] = secret_key

    return boto3.client(**client_kwargs)


def _delete_s3_keys_sync(
    keys: List[str],
    bucket: str,
    s3_config: Dict[str, Any],
    prefix_to_purge: Optional[str] = None,
) -> Tuple[List[str], List[str]]:
    """Synchronously delete specific S3 keys and optional prefix using boto3.

    Returns (deleted_keys, errors).
    """
    from botocore.exceptions import ClientError

    client = _get_boto3_s3_client(s3_config)
    if client is None:
        return [], ["boto3 not installed"]

    deleted: List[str] = []
    errors: List[str] = []

    # 1. Delete individual keys
    for k in keys:
        if not k:
            continue
        try:
            client.delete_object(Bucket=bucket, Key=k)
            deleted.append(f"s3://{bucket}/{k}")
            logger.info("Deleted S3 object: s3://%s/%s", bucket, k)
        except ClientError as exc:
            code = exc.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404"):
                deleted.append(f"s3://{bucket}/{k}")
                logger.info("S3 object s3://%s/%s was already absent", bucket, k)
            else:
                err_msg = f"Failed to delete s3://{bucket}/{k}: {exc}"
                logger.warning(err_msg)
                errors.append(err_msg)
        except Exception as exc:
            err_msg = f"Unexpected error deleting s3://{bucket}/{k}: {exc}"
            logger.warning(err_msg)
            errors.append(err_msg)

    # 2. If a specific source prefix is provided (e.g. data-sources/{source_id}/), purge all under it
    if prefix_to_purge and len(prefix_to_purge) >= 10:
        try:
            paginator = client.get_paginator("list_objects_v2")
            pages = paginator.paginate(Bucket=bucket, Prefix=prefix_to_purge)
            for page in pages:
                objects = page.get("Contents") or []
                if not objects:
                    continue
                to_delete = [{"Key": obj["Key"]} for obj in objects if obj.get("Key")]
                if to_delete:
                    client.delete_objects(Bucket=bucket, Delete={"Objects": to_delete})
                    for item in to_delete:
                        deleted.append(f"s3://{bucket}/{item['Key']}")
                    logger.info(
                        "Purged %d S3 objects under prefix s3://%s/%s",
                        len(to_delete),
                        bucket,
                        prefix_to_purge,
                    )
        except Exception as exc:
            logger.warning("Failed to purge prefix s3://%s/%s: %s", bucket, prefix_to_purge, exc)

    return deleted, errors


async def delete_s3_file(
    key_or_uri: str,
    bucket: Optional[str] = None,
    custom_config: Optional[Dict[str, Any]] = None,
    prefix_to_purge: Optional[str] = None,
) -> Dict[str, Any]:
    """Delete an S3 file or URI asynchronously."""
    parsed_bucket, key = parse_s3_uri(key_or_uri)
    effective_bucket = bucket or parsed_bucket

    runtime_config: Dict[str, Any] = {}
    try:
        from src.core.system_settings.runtime_config import get_effective_storage_config
        runtime_config = await get_effective_storage_config()
    except Exception:
        pass

    s3_config = _resolve_s3_client_config(custom_config, runtime_config)
    target_bucket = effective_bucket or s3_config.get("bucket")

    if not target_bucket:
        logger.info("No S3 bucket resolved for %s; skipping direct S3 deletion", key_or_uri)
        return {"success": False, "deleted": [], "errors": ["No S3 bucket configured"]}

    keys_to_delete = [key] if key else []
    deleted, errors = await asyncio.to_thread(
        _delete_s3_keys_sync,
        keys=keys_to_delete,
        bucket=target_bucket,
        s3_config=s3_config,
        prefix_to_purge=prefix_to_purge,
    )

    return {
        "success": len(errors) == 0,
        "deleted": deleted,
        "errors": errors,
    }


def extract_datasource_keys_and_config(data_source: Any) -> Tuple[List[str], Optional[str], Dict[str, Any], Optional[str]]:
    """Extract all potential file/S3 keys, bucket, custom S3 config, and prefix from a data source.

    Returns (keys, bucket, custom_s3_config, source_prefix).
    """
    keys: List[str] = []
    bucket: Optional[str] = None
    custom_config: Dict[str, Any] = {}
    source_prefix: Optional[str] = None

    ds_id = getattr(data_source, "id", None) or (data_source.get("id") if isinstance(data_source, dict) else None)
    ds_id_str = str(ds_id).strip() if ds_id else ""

    # Check file_path attribute
    file_path = getattr(data_source, "file_path", None)
    if file_path is None and isinstance(data_source, dict):
        file_path = data_source.get("file_path")
    if file_path and isinstance(file_path, str):
        keys.append(file_path.strip())

    # Check connection_config
    raw_config = getattr(data_source, "connection_config", None)
    if raw_config is None and isinstance(data_source, dict):
        raw_config = data_source.get("connection_config")
    if isinstance(raw_config, str) and raw_config.strip():
        try:
            raw_config = json.loads(raw_config)
        except Exception:
            raw_config = {}
    if isinstance(raw_config, dict):
        try:
            cfg = decrypt_credentials(raw_config)
        except Exception:
            cfg = raw_config

        # Extract keys from config
        for k in ("s3_key", "object_key", "key", "file_path", "s3_path", "url"):
            v = cfg.get(k)
            if v and isinstance(v, str):
                keys.append(v.strip())

        # Extract bucket
        for b in ("bucket_name", "bucket", "s3_bucket"):
            v = cfg.get(b)
            if v and isinstance(v, str):
                bucket = v.strip()
                break

        # S3 credentials
        for auth_k in (
            "aws_access_key_id",
            "access_key_id",
            "aws_secret_access_key",
            "secret_access_key",
            "aws_region",
            "region",
            "endpoint_url",
            "s3_endpoint",
        ):
            if cfg.get(auth_k):
                custom_config[auth_k] = cfg.get(auth_k)

    # Check schema storage metadata
    schema = getattr(data_source, "schema", None)
    if schema is None and isinstance(data_source, dict):
        schema = data_source.get("schema")
    if isinstance(schema, dict):
        storage_meta = schema.get("storage")
        if isinstance(storage_meta, dict):
            for k in ("object_key", "key", "file_path"):
                v = storage_meta.get(k)
                if v and isinstance(v, str):
                    keys.append(v.strip())
            if storage_meta.get("bucket"):
                bucket = bucket or str(storage_meta.get("bucket")).strip()

    # Look for matching canonical S3 prefix if source_id is known
    if ds_id_str:
        for k in list(keys):
            if f"/data-sources/{ds_id_str}/" in k:
                source_prefix = k.split(f"/data-sources/{ds_id_str}/")[0] + f"/data-sources/{ds_id_str}/"
                break
            if k.startswith(f"data-sources/{ds_id_str}/"):
                source_prefix = f"data-sources/{ds_id_str}/"
                break

    unique_keys = list(dict.fromkeys(k for k in keys if k))
    return unique_keys, bucket, custom_config, source_prefix


async def delete_datasource_storage_files(
    data_source: Any,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Complete cleanup of all storage files (S3, PostgreSQL BYTEA, Azure, local cache/disk).

    Returns:
        {
            "success": bool,
            "s3_deleted": bool,
            "deleted_items": list[str],
            "errors": list[str],
        }
    """
    deleted_items: List[str] = []
    errors: List[str] = []

    ds_id = getattr(data_source, "id", None) or (data_source.get("id") if isinstance(data_source, dict) else "")
    ds_proj_id = getattr(data_source, "project_id", None) or (data_source.get("project_id") if isinstance(data_source, dict) else None)
    effective_project_id = str(project_id or ds_proj_id or "")

    keys, bucket, custom_s3_cfg, source_prefix = extract_datasource_keys_and_config(data_source)

    # 1. Direct S3 check and deletion
    s3_keys_or_uris = [
        k for k in keys if (
            k.startswith("s3://")
            or k.startswith("projects/")
            or k.startswith("orgs/")
            or k.startswith("uploads/")
            or k.startswith("compressed/")
            or "/" in k
        )
    ]

    s3_deleted_any = False
    if s3_keys_or_uris or source_prefix:
        for key_or_uri in s3_keys_or_uris:
            try:
                res = await delete_s3_file(
                    key_or_uri=key_or_uri,
                    bucket=bucket,
                    custom_config=custom_s3_cfg,
                    prefix_to_purge=source_prefix,
                )
                if res.get("deleted"):
                    deleted_items.extend(res["deleted"])
                    s3_deleted_any = True
                if res.get("errors"):
                    errors.extend(res["errors"])
            except Exception as exc:
                err = f"Failed S3 deletion for {key_or_uri}: {exc}"
                logger.warning(err)
                errors.append(err)

    # 2. UploadDatasourceStorageService delegation (handles local cache eviction + PostgreSQL BYTEA / Azure / S3 storage)
    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    storage_service = UploadDatasourceStorageService()
    for k in keys:
        try:
            # Strip s3:// for storage service if needed
            _, plain_key = parse_s3_uri(k)
            key_to_delete = plain_key or k
            success = await storage_service.delete_file(key_to_delete, effective_project_id)
            if success:
                deleted_items.append(f"storage://{key_to_delete}")
                logger.info("Evicted datasource storage for key: %s", key_to_delete)
        except Exception as exc:
            logger.warning("UploadDatasourceStorageService.delete_file failed for %s: %s", k, exc)

    # 3. Local filesystem cleanup if a raw local path was stored
    for k in keys:
        if not k.startswith("s3://") and os.path.isabs(k) and os.path.exists(k):
            try:
                os.unlink(k)
                deleted_items.append(f"local://{k}")
                logger.info("Deleted local datasource file: %s", k)
            except Exception as exc:
                errors.append(f"Failed to delete local file {k}: {exc}")

    return {
        "success": len(errors) == 0,
        "s3_deleted": s3_deleted_any,
        "deleted_items": list(set(deleted_items)),
        "errors": errors,
    }
