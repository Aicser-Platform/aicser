"""OrganizationService helpers used by /organizations/me/* routes."""
import pytest
from unittest.mock import AsyncMock, patch

from src.modules.organizations.service import OrganizationService


@pytest.mark.asyncio
async def test_get_user_organizations_delegates_to_list():
    fake_orgs = [object(), object()]
    with patch.object(
        OrganizationService,
        "list_user_organizations",
        new_callable=AsyncMock,
        return_value=(fake_orgs, 2),
    ) as list_mock:
        result = await OrganizationService.get_user_organizations("user-123")

    list_mock.assert_awaited_once_with(user_id="user-123", page=1, page_size=100)
    assert result == fake_orgs
