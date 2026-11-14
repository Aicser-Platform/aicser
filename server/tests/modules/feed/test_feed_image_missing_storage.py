"""An image whose stored bytes are gone answers 404, not a 500 from the storage backend."""

import uuid

import pytest
from fastapi import HTTPException


class _Row:
    def __init__(self, uploader_id):
        self.post_id = None
        self.uploader_id = uploader_id
        self.object_key = "projects/None/data-sources/feed-image-x/compressed/u/feed-image-x.webp"


class _Db:
    def __init__(self, row):
        self._row = row

    async def get(self, model, key):
        return self._row


async def test_missing_bucket_reads_as_not_found(monkeypatch):
    from src.modules.data.services import upload_datasource_storage_service as S
    from src.modules.feed.image_service import read_image

    class NoSuchBucket(Exception):
        pass

    async def _boom(self, object_key, project_id):
        raise NoSuchBucket("The specified bucket does not exist")

    monkeypatch.setattr(S.UploadDatasourceStorageService, "get_file", _boom)
    viewer = uuid.uuid4()
    with pytest.raises(HTTPException) as err:
        await read_image(_Db(_Row(viewer)), uuid.uuid4(), viewer, None)
    assert err.value.status_code == 404
