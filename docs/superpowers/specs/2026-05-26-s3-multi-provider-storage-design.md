# S3 Multi-Provider Storage Service Design

**Date:** 2026-05-26
**Scope:** EE only — server-side data source upload backend

---

## Problem

The EE upload backend is Azure Blob Storage only. Operators running on Railway, Cloudflare R2, DigitalOcean Spaces, MinIO, or AWS S3 must configure Azure even if they have no Azure infrastructure.

---

## Goal

Add an S3-compatible storage backend alongside Azure. Operators pick one via a single `STORAGE_BACKEND` env var. Azure continues to work unchanged. CE keeps PostgreSQL.

---

## Architecture

Three files change:

| File | Change |
|------|--------|
| `server/ee/modules/data/services/s3_storage_service.py` | New — S3 backend |
| `server/src/modules/data/services/upload_datasource_storage_service.py` | Update — add S3 branch |
| `server/src/core/config.py` | Update — new S3 settings block |
| `deploy/docker-compose.dev.yml` | Update — new S3 env vars |
| `deploy/docker-compose.ee.yml` | Update — new S3 env vars |

### Backend selection in `UploadDatasourceStorageService`

```
STORAGE_BACKEND=s3          → S3StorageService
STORAGE_BACKEND=azure_blob  → AzureBlobStorageService  (existing)
STORAGE_BACKEND=postgresql  → PostgresStorageService   (existing)
(unset)                     → auto-detect: try Azure credentials → fallback PostgreSQL
```

Backward compatibility: existing deployments with no `STORAGE_BACKEND` set continue using Azure auto-detect.

---

## Environment Variables

```
STORAGE_BACKEND=s3              # "s3" | "azure_blob" | "postgresql"
S3_ENDPOINT_URL=                # empty = AWS S3; set for all other providers
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_BUCKET_NAME=
S3_REGION=us-east-1
S3_PROVIDER=aws                 # aws | cloudflare_r2 | digitalocean | minio | railway (label, used in logs only)
```

### Provider endpoint examples

| Provider | `S3_ENDPOINT_URL` |
|----------|-------------------|
| AWS S3 | *(leave empty)* |
| Cloudflare R2 | `https://<account_id>.r2.cloudflarestorage.com` |
| DigitalOcean Spaces | `https://<region>.digitaloceanspaces.com` |
| MinIO (local) | `http://minio:9000` |
| Railway | `https://bucket.railway-storage.com` |

---

## Object Key / Path Hierarchy

```
orgs/{org_id}/projects/{project_id}/data-sources/{source_id}/compressed/{user_id}/{filename}.parquet
```

When `org_id` is absent (legacy/CE path):
```
projects/{project_id}/data-sources/{source_id}/compressed/{user_id}/{filename}.parquet
```

`user_id` is included in S3 paths to identify the uploader. If `user_id` is not available, the segment falls back to `"unknown"`.

This differs from the Azure path (which omits `user_id`) — both formats are valid and stored as `DataSource.file_path`.

---

## `S3StorageService` Class

**File:** `server/ee/modules/data/services/s3_storage_service.py`

```python
class S3StorageService:
    def __init__(self): ...
    # boto3 client, endpoint_url=None for AWS, custom URL otherwise.
    # addressing_style="path" when endpoint is http:// (MinIO).
    # addressing_style="virtual" for AWS, R2, DigitalOcean.

    @staticmethod
    def is_enabled() -> bool: ...
    # True when S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET_NAME are all non-empty.

    def generate_object_key(
        project_id: str, filename: str, source_id: str,
        organization_id: Optional[str], user_id: Optional[str]
    ) -> str: ...

    async def store_file(
        file_content: bytes, project_id: str, original_filename: str,
        content_type: str, source_id: str,
        organization_id: Optional[str], user_id: Optional[str]
    ) -> str: ...
    # asyncio.to_thread → boto3 put_object → returns object_key

    async def get_file(object_key: str, project_id: Optional[str]) -> bytes: ...
    # asyncio.to_thread → boto3 get_object

    async def delete_file(object_key: str, project_id: Optional[str]) -> bool: ...
    # asyncio.to_thread → boto3 delete_object
```

All blocking boto3 calls are wrapped in `asyncio.to_thread()`, matching the Azure service pattern.

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `is_enabled()` is False | `UploadDatasourceStorageService` falls through to next backend |
| boto3 `ClientError` on upload/download | Logged + re-raised as `HTTPException(503)` |
| Missing `user_id` | Path segment falls back to `"unknown"` |
| `STORAGE_BACKEND=s3` but credentials absent | Raises `RuntimeError` at startup with clear message |

---

## Testing

**New file:** `server/tests/modules/data/test_s3_storage_service.py`

- `generate_object_key` includes `user_id` in path
- `generate_object_key` falls back to `"unknown"` when `user_id` is `None`
- `store_file` / `get_file` / `delete_file` mock boto3 via `unittest.mock.patch`
- `is_enabled()` returns `False` when any required env var is missing
- `UploadDatasourceStorageService` selects `S3StorageService` when `STORAGE_BACKEND=s3`
- `UploadDatasourceStorageService` falls back to Azure when `STORAGE_BACKEND` is unset and Azure creds present

---

## Out of Scope

- Migrating existing Azure blobs to S3
- Signed URL / presigned download URLs
- Multi-bucket routing (one bucket per org)
- CE S3 support
