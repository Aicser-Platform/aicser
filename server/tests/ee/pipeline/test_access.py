import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pytest
from fastapi import HTTPException


def _payload(org_id):
    return {"sub": str(uuid.uuid4()), "organization_id": str(org_id)}


async def test_access_allowed_when_the_user_has_a_grant():
    from unittest.mock import AsyncMock, patch

    from src.modules.pipeline.access import require_source_access

    org = uuid.uuid4()
    with patch(
        "src.modules.pipeline.access.DataSourceRBACService.can_access_data_source",
        new=AsyncMock(return_value=True),
    ):
        ctx = await require_source_access(AsyncMock(), _payload(org), "ds-1")

    assert ctx.organization_id == str(org)


async def test_access_denied_raises_403_not_404():
    """A grant failure must deny, never fall back to unfiltered access."""
    from unittest.mock import AsyncMock, patch

    from src.modules.pipeline.access import require_source_access

    with patch(
        "src.modules.pipeline.access.DataSourceRBACService.can_access_data_source",
        new=AsyncMock(return_value=False),
    ):
        with pytest.raises(HTTPException) as exc:
            await require_source_access(AsyncMock(), _payload(uuid.uuid4()), "ds-1")

    assert exc.value.status_code == 403


async def test_resolution_failure_denies_rather_than_allowing():
    """Policy resolution failure means deny."""
    from unittest.mock import AsyncMock, patch

    from src.modules.pipeline.access import require_source_access

    with patch(
        "src.modules.pipeline.access.DataSourceRBACService.can_access_data_source",
        new=AsyncMock(side_effect=RuntimeError("policy store unreachable")),
    ):
        with pytest.raises(HTTPException) as exc:
            await require_source_access(AsyncMock(), _payload(uuid.uuid4()), "ds-1")

    assert exc.value.status_code == 403


async def test_missing_organization_context_is_rejected():
    from unittest.mock import AsyncMock

    from src.modules.pipeline.access import require_source_access

    with pytest.raises(HTTPException) as exc:
        await require_source_access(AsyncMock(), {"sub": str(uuid.uuid4())}, "ds-1")

    assert exc.value.status_code == 400
