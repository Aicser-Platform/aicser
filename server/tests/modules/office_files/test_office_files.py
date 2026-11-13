"""Docs and Slides storage: who may read and change a file (owner, approved shares), stale saves, size limits."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from src.modules.data.services.governed_sql import Caller
from src.modules.office_files import router as R
from src.modules.office_files.schemas import OfficeFileCreate, OfficeFileUpdate

ME, OTHER = str(uuid.uuid4()), str(uuid.uuid4())
ORG, OTHER_ORG = str(uuid.uuid4()), str(uuid.uuid4())


def caller(user=ME, org=ORG):
    return Caller(user_id=user, organization_id=org, project_id=None, payload={})


def office_file(owner=ME, org=ORG, visibility="private", deleted=False, kind="document"):
    return SimpleNamespace(
        id=uuid.uuid4(), kind=kind, title="Plan", body={"content": {}}, meta={"words": 3},
        user_id=uuid.UUID(owner), organization_id=uuid.UUID(org) if org else None, project_id=None,
        visibility=visibility, folder_id=None, version=1, is_deleted=deleted, deleted_at=None,
        created_at=None, updated_at=None,
    )


class FakeDB:
    def __init__(self, f):
        self.f = f
        self.committed = False

    async def get(self, _model, _id):
        return self.f

    async def commit(self):
        self.committed = True

    async def refresh(self, _obj):
        pass


@pytest.fixture
def shares(monkeypatch):
    """Each person goes by one id; `granted` maps a person to their approved share role."""
    granted = {}

    async def ids(_db, user_id):
        return {str(user_id)}

    async def role(_db, f, ids_):
        if str(f.user_id) in ids_:
            return "owner"
        return next((granted[i] for i in ids_ if i in granted), None)

    monkeypatch.setattr(R.sharing, "user_ids", ids)
    monkeypatch.setattr(R.sharing, "my_role", role)
    return granted


@pytest.mark.asyncio
async def test_the_owner_reads_and_writes(shares):
    f = office_file()
    assert await R.load(FakeDB(f), str(f.id), caller(), write=True) == (f, "owner")


@pytest.mark.asyncio
async def test_view_shares_are_read_only_and_edit_shares_may_save(shares):
    f = office_file(owner=OTHER)
    shares[ME] = "view"
    assert await R.load(FakeDB(f), str(f.id), caller(), write=False) == (f, "view")
    with pytest.raises(HTTPException) as err:
        await R.load(FakeDB(f), str(f.id), caller(), write=True)
    assert err.value.status_code == 403 and "Make a copy" in err.value.detail
    shares[ME] = "edit"
    assert await R.load(FakeDB(f), str(f.id), caller(), write=True) == (f, "edit")
    with pytest.raises(HTTPException) as err:
        await R.load_owned(FakeDB(f), str(f.id), caller())  # deleting stays the owner's
    assert err.value.status_code == 403


@pytest.mark.asyncio
async def test_unshared_or_deleted_files_are_not_found(shares):
    for f in (office_file(owner=OTHER), office_file(deleted=True), office_file(owner=OTHER, visibility="project")):
        with pytest.raises(HTTPException) as err:
            await R.load(FakeDB(f), str(f.id), caller(), write=False)
        assert err.value.status_code == 404


@pytest.mark.asyncio
async def test_a_stale_save_is_refused_and_a_current_one_bumps_the_version(shares):
    f = office_file()
    db = FakeDB(f)
    with pytest.raises(HTTPException) as err:
        await R.update_file(str(f.id), OfficeFileUpdate(title="New", version=2), {"id": ME, "organization_id": ORG}, db)
    assert err.value.status_code == 409 and f.title == "Plan"
    out = await R.update_file(str(f.id), OfficeFileUpdate(title=" New ", body={"x": 1}, version=1),
                              {"id": ME, "organization_id": ORG}, db)
    assert out["version"] == 2 and out["title"] == "New" and f.body == {"x": 1} and "body" not in out


def test_body_size_and_details_are_limited(monkeypatch):
    monkeypatch.setattr(R, "MAX_BODY_BYTES", 50)
    with pytest.raises(HTTPException) as err:
        R.check_body({"src": "data:image/png;base64," + "A" * 100})
    assert err.value.status_code == 413
    assert OfficeFileCreate(kind="presentation", title="Deck", meta={"slides": 4}).meta == {"slides": 4}
    for meta in ({"nested": {"a": 1}}, {f"k{i}": i for i in range(11)}, {"long": "x" * 201}):
        with pytest.raises(ValidationError):
            OfficeFileCreate(kind="document", title="Doc", meta=meta)
    with pytest.raises(ValidationError):
        OfficeFileCreate(kind="spreadsheet", title="Nope")


@pytest.mark.asyncio
async def test_saving_details_keeps_the_ones_set_at_creation(shares):
    f = office_file()
    f.meta = {"words": 3, "source": "report:c:m"}
    await R.update_file(str(f.id), OfficeFileUpdate(meta={"words": 9}, version=1), {"id": ME, "organization_id": ORG}, FakeDB(f))
    assert f.meta == {"words": 9, "source": "report:c:m"}
