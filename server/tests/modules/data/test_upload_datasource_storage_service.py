import sys
import types

import pytest

from src.modules.data.services import upload_datasource_storage_service as storage_module


class _FakePostgresStorage:
    def __init__(self):
        self.calls = []

    async def store_file(self, **kwargs):
        self.calls.append(("store", kwargs))
        return "user_files/project-1/file-1"

    async def get_file(self, object_key, project_id):
        self.calls.append(("get", object_key, project_id))
        return b"postgres"

    async def delete_file(self, object_key, project_id):
        self.calls.append(("delete", object_key, project_id))
        return True


class _FakeAzureStorage:
    def __init__(self):
        self.calls = []

    async def store_file(self, **kwargs):
        self.calls.append(("store", kwargs))
        return "projects/project-1/data-sources/source-1/compressed/file.parquet"

    async def get_file(self, object_key, project_id):
        self.calls.append(("get", object_key, project_id))
        return b"azure"

    async def delete_file(self, object_key, project_id):
        self.calls.append(("delete", object_key, project_id))
        return True


@pytest.mark.asyncio
async def test_ce_upload_datasource_storage_uses_postgres(monkeypatch):
    fake_postgres = _FakePostgresStorage()
    monkeypatch.setenv("AISER_EDITION", "community")
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)
    monkeypatch.setattr(
        storage_module.UploadDatasourceStorageService,
        "_postgres_storage",
        lambda self: fake_postgres,
    )

    service = storage_module.UploadDatasourceStorageService()

    object_key = await service.store_file(
        file_content=b"content",
        project_id="project-1",
        original_filename="file.parquet",
        content_type="application/x-parquet",
        source_id="source-1",
        organization_id="org-1",
        user_id="user-1",
    )

    assert service.storage_type == "postgresql"
    assert object_key == "user_files/project-1/file-1"
    assert fake_postgres.calls[0][0] == "store"


@pytest.mark.asyncio
async def test_ee_upload_datasource_storage_uses_azure(monkeypatch):
    fake_azure = _FakeAzureStorage()
    azure_module = types.ModuleType("ee.modules.data.services.azure_blob_storage_service")
    azure_module.AzureBlobStorageService = lambda: fake_azure

    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.delenv("STORAGE_BACKEND", raising=False)
    monkeypatch.setitem(
        sys.modules,
        "ee.modules.data.services.azure_blob_storage_service",
        azure_module,
    )

    service = storage_module.UploadDatasourceStorageService()

    object_key = await service.store_file(
        file_content=b"content",
        project_id="project-1",
        original_filename="file.parquet",
        content_type="application/x-parquet",
        source_id="source-1",
        organization_id="org-1",
        user_id="user-1",
    )

    assert service.storage_type == "azure_blob"
    assert object_key == "projects/project-1/data-sources/source-1/compressed/file.parquet"
    assert fake_azure.calls[0][0] == "store"


@pytest.mark.asyncio
async def test_ee_can_read_legacy_postgres_object_keys(monkeypatch):
    fake_postgres = _FakePostgresStorage()
    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setattr(
        storage_module.UploadDatasourceStorageService,
        "_postgres_storage",
        lambda self: fake_postgres,
    )

    service = storage_module.UploadDatasourceStorageService()
    content = await service.get_file("user_files/project-1/file-1", "project-1")

    assert content == b"postgres"
    assert fake_postgres.calls == [("get", "user_files/project-1/file-1", "project-1")]


class _FakeS3Storage:
    def __init__(self):
        self.calls = []

    async def store_file(self, **kwargs):
        self.calls.append(("store", kwargs))
        return "orgs/org-1/projects/proj-1/data-sources/src-1/compressed/user-1/file.parquet"

    async def get_file(self, object_key, project_id):
        self.calls.append(("get", object_key, project_id))
        return b"s3"

    async def delete_file(self, object_key, project_id):
        self.calls.append(("delete", object_key, project_id))
        return True


@pytest.mark.asyncio
async def test_ee_storage_backend_s3_selects_s3_service(monkeypatch):
    fake_s3 = _FakeS3Storage()
    s3_module = types.ModuleType("ee.modules.data.services.s3_storage_service")
    s3_module.S3StorageService = lambda: fake_s3

    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setitem(
        sys.modules,
        "ee.modules.data.services.s3_storage_service",
        s3_module,
    )

    service = storage_module.UploadDatasourceStorageService()

    object_key = await service.store_file(
        file_content=b"content",
        project_id="proj-1",
        original_filename="file.parquet",
        content_type="application/x-parquet",
        source_id="src-1",
        organization_id="org-1",
        user_id="user-1",
    )

    assert service.storage_type == "s3"
    assert "orgs/org-1" in object_key
    assert fake_s3.calls[0][0] == "store"


@pytest.mark.asyncio
async def test_ee_s3_get_file_delegates_to_s3_service(monkeypatch):
    fake_s3 = _FakeS3Storage()
    s3_module = types.ModuleType("ee.modules.data.services.s3_storage_service")
    s3_module.S3StorageService = lambda: fake_s3

    monkeypatch.setenv("AISER_EDITION", "enterprise")
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setitem(sys.modules, "ee.modules.data.services.s3_storage_service", s3_module)

    service = storage_module.UploadDatasourceStorageService()
    content = await service.get_file(
        "orgs/org-1/projects/proj-1/data-sources/src-1/compressed/user-1/file.parquet",
        "proj-1",
    )

    assert content == b"s3"
