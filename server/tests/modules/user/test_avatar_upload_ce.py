import base64
import io
import os
from uuid import uuid4

import pytest
from PIL import Image

os.environ["DEBUG"] = "false"

from src.modules.user import router as user_router


class DummyUploadFile:
    content_type = "image/png"

    def __init__(self, content: bytes) -> None:
        self._content = content

    async def read(self) -> bytes:
        return self._content


def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (32, 32), color=(24, 144, 255)).save(buf, format="PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_ce_avatar_upload_persists_data_uri_without_cloud_storage(monkeypatch):
    captured = {}
    user_id = str(uuid4())

    class FakeUserService:
        def __init__(self, db):
            self.db = db

        async def update_profile(self, user_id, data):
            captured["user_id"] = user_id
            captured["data"] = data
            return {
                "id": user_id,
                "user_id": user_id,
                "avatar_url": data["avatar_url"],
            }

    def fail_cloud_storage():
        raise AssertionError("CE avatar upload must not initialize cloud storage")

    monkeypatch.setattr(user_router, "is_ee_enabled", lambda: False)
    monkeypatch.setattr(user_router, "UserService", FakeUserService)
    monkeypatch.setattr(user_router, "AvatarStorageService", fail_cloud_storage)

    result = await user_router.upload_avatar(
        file=DummyUploadFile(_png_bytes()),
        current_token={"sub": user_id},
        db=object(),
    )

    avatar_url = captured["data"]["avatar_url"]
    assert captured["user_id"] == user_id
    assert avatar_url.startswith("data:image/webp;base64,")
    assert result["avatar_url"] == avatar_url

    encoded = avatar_url.split(",", 1)[1]
    webp_bytes = base64.b64decode(encoded)
    assert webp_bytes.startswith(b"RIFF")
    assert b"WEBP" in webp_bytes[:16]
