"""Organization logos on S3/Azure are private objects.

Every API response must hand the client a signed link (like profile photos), signed
with the runtime storage config (Settings > Lake storage) when that is S3. Inline
data URIs pass through unchanged.
"""

import os

# See test_report_branding.py: the EE organizations package only resolves with the
# enterprise edition set.
os.environ.setdefault("AISER_EDITION", "enterprise")

from datetime import datetime, timezone  # noqa: E402
from unittest.mock import AsyncMock, patch  # noqa: E402

import src.core.system_settings.runtime_config as runtime_config  # noqa: E402
import src.modules.user.avatar_storage_service as avatar_storage  # noqa: E402
from ee.modules.organizations.router import (  # noqa: E402
    _display_logo_url,
    _with_display_logo,
)
from ee.modules.organizations.schemas import OrganizationResponse  # noqa: E402

STORED = "https://aicser-media.s3.us-east-1.amazonaws.com/orgs/o1/avatars/logo.webp"
S3_CONFIG = {
    "enabled": True,
    "backend": "s3",
    "bucket_name": "aicser-media",
    "access_key_id": "k",
    "secret_access_key": "s",
}


async def test_inline_logos_pass_through():
    inline = "data:image/webp;base64,AAAA"
    assert await _display_logo_url(inline) == inline
    assert await _display_logo_url(None) is None
    assert await _display_logo_url("") == ""


async def test_signs_with_the_runtime_s3_config():
    with (
        patch.object(
            runtime_config,
            "get_effective_storage_config",
            new=AsyncMock(return_value=S3_CONFIG),
        ),
        patch.object(
            avatar_storage,
            "generate_avatar_s3_url",
            return_value=f"{STORED}?X-Amz-Signature=abc",
        ) as s3,
        patch.object(avatar_storage, "generate_avatar_sas_url") as sas,
    ):
        assert await _display_logo_url(STORED) == f"{STORED}?X-Amz-Signature=abc"
    s3.assert_called_once_with(STORED, config=S3_CONFIG)
    sas.assert_not_called()


async def test_falls_back_to_the_env_signer_without_runtime_s3():
    with (
        patch.object(
            runtime_config,
            "get_effective_storage_config",
            new=AsyncMock(return_value={"enabled": False}),
        ),
        patch.object(
            avatar_storage,
            "generate_avatar_sas_url",
            return_value=f"{STORED}?sig=azure",
        ) as sas,
    ):
        assert await _display_logo_url(STORED) == f"{STORED}?sig=azure"
    sas.assert_called_once_with(STORED)


async def test_signs_logo_url_and_branding_logo_of_a_response():
    response = OrganizationResponse.model_validate(
        {
            "id": "00000000-0000-0000-0000-000000000001",
            "name": "Aiser",
            "created_at": datetime.now(timezone.utc),
            "is_active": True,
            "is_deleted": False,
            "logo_url": STORED,
            "settings": {
                "branding": {"logo_url": STORED, "app_name": "Aiser"},
                "other": 1,
            },
        }
    )
    with (
        patch.object(
            runtime_config,
            "get_effective_storage_config",
            new=AsyncMock(return_value=S3_CONFIG),
        ),
        patch.object(
            avatar_storage,
            "generate_avatar_s3_url",
            side_effect=lambda url, config: f"{url}?signed",
        ),
    ):
        signed = await _with_display_logo(response)
    assert signed.logo_url == f"{STORED}?signed"
    assert signed.settings == {
        "branding": {"logo_url": f"{STORED}?signed", "app_name": "Aiser"},
        "other": 1,
    }
