"""Someone in an organization has one company: the organization's name, changed only there."""

import uuid
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from src.modules.user import service as svc
from src.modules.user.service import _PROFILE_COLUMNS, UserService

USER = uuid.uuid4()


class FakeResult:
    def __init__(self, row=None, scalar=None):
        self.row, self._scalar = row, scalar

    def fetchone(self):
        return self.row

    def scalar(self):
        return self._scalar


class FakeDb:
    def __init__(self, organization):
        self.organization = organization
        self.updates = []

    async def execute(self, statement, params=None):
        sql = str(statement)
        if "user_roles" in sql:
            return FakeResult(scalar=self.organization)
        if sql.strip().startswith("UPDATE"):
            self.updates.append((sql, params))
            return FakeResult()
        if sql.startswith("SELECT id FROM"):
            return FakeResult(SimpleNamespace(id=USER))
        values = {c: None for c in _PROFILE_COLUMNS}
        return FakeResult(SimpleNamespace(id=USER, user_id=USER, **{**values, "company": "Typed by hand"}))

    async def commit(self):
        pass

    async def rollback(self):
        pass


@pytest.fixture
def enterprise():
    with patch.object(svc, "is_ee_enabled", return_value=True):
        yield


@pytest.mark.asyncio
async def test_member_sees_the_organization_name(enterprise):
    profile = await UserService(FakeDb("Acme")).get_profile(str(USER))
    assert profile["company"] == "Acme"
    assert profile["company_managed"] is True


@pytest.mark.asyncio
async def test_no_organization_keeps_the_persons_own_company(enterprise):
    profile = await UserService(FakeDb(None)).get_profile(str(USER))
    assert profile["company"] == "Typed by hand"
    assert profile["company_managed"] is False


@pytest.mark.asyncio
async def test_member_cannot_change_company_through_the_profile(enterprise):
    db = FakeDb("Acme")
    await UserService(db).update_profile(str(USER), {"company": "Other", "first_name": "Sam"})
    assert len(db.updates) == 1
    assert "company" not in db.updates[0][1]
    assert db.updates[0][1]["first_name"] == "Sam"


@pytest.mark.asyncio
async def test_company_only_save_by_a_member_writes_nothing(enterprise):
    db = FakeDb("Acme")
    await UserService(db).update_profile(str(USER), {"company": "Other"})
    assert db.updates == []


@pytest.mark.asyncio
async def test_no_organization_can_change_company(enterprise):
    db = FakeDb(None)
    await UserService(db).update_profile(str(USER), {"company": "New Co"})
    assert db.updates[0][1]["company"] == "New Co"


@pytest.mark.asyncio
async def test_community_never_looks_for_an_organization():
    db = FakeDb("Acme")
    with patch.object(svc, "is_ee_enabled", return_value=False):
        profile = await UserService(db).get_profile(str(USER))
    assert profile["company_managed"] is False
    assert profile["company"] == "Typed by hand"
