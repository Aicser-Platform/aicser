import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import uuid

import pytest  # noqa: E402


async def test_upload_opens_a_session_but_does_not_enqueue_yet(monkeypatch):
    """_try_write_bronze must not enqueue the profiling job itself.

    `session` here is the caller's own, not-yet-committed transaction (the
    parent data_sources row is typically added to it only after this
    returns), and the ARQ worker looks the onboarding session up through a
    *different* DB connection. Enqueueing before the caller's commit would
    race that worker against a row it can't see yet. The caller
    (_save_data_source_to_db) must enqueue only after its own commit
    succeeds.
    """
    from src.modules.data.services import data_connectivity_service as svc

    enqueued = []
    session_id = uuid.uuid4()

    class FakeSession:
        id = session_id

    async def fake_create_session(db, **kwargs):
        return FakeSession()

    async def fake_enqueue(name, **kwargs):
        enqueued.append((name, kwargs))
        return "job-1"

    monkeypatch.setattr(
        "src.modules.pipeline.onboarding.service.create_session", fake_create_session
    )
    monkeypatch.setattr("src.shared.jobs.client.enqueue_job", fake_enqueue)

    result = await svc._try_write_bronze(
        session=None,
        file_path="/tmp/sales.csv",
        organization_id=uuid.uuid4(),
        data_source_id="asset-1",
    )

    assert result == {"onboarding_session_id": str(session_id)}
    assert enqueued == []


class FlushAwareFakeDB:
    """Models Postgres FK enforcement *and* flush/commit semantics closely
    enough to pin the real fix -- verified against a live Postgres-backed
    session, not just guessed:

    SQLAlchemy's unit of work does NOT reorder cross-mapper inserts by FK
    dependency in this codebase (there is no relationship() configured
    between DataSource and DataLakeObject/DataOnboardingSession). A parent
    row and its FK-dependent child, added to the same flush/commit batch,
    raise ForeignKeyViolationError regardless of which was `.add()`-ed first.
    Only flushing the parent in ISOLATION -- before the child is even added
    -- works, because a flushed-but-uncommitted row is visible to later
    statements in the same transaction.
    """

    def __init__(self):
        self.pending = []
        self.known_source_ids = set()
        self.commits = 0
        self.flushes = 0
        self.poisoned = False

    def _check_not_poisoned(self):
        if self.poisoned:
            from sqlalchemy.exc import PendingRollbackError

            raise PendingRollbackError(
                "This Session's transaction has been rolled back due to a "
                "previous exception during flush."
            )

    def add(self, obj):
        self._check_not_poisoned()
        self.pending.append(obj)

    async def execute(self, _stmt):
        """Only the "does this data source already exist" lookup is needed
        by _save_data_source_to_db before anything is added -- always answer
        "no" so it takes the create-new path these tests exercise."""

        class _Result:
            def scalar_one_or_none(self_inner):
                return None

        return _Result()

    def _settle(self):
        from sqlalchemy.exc import IntegrityError

        from src.modules.data.models import DataSource

        for obj in self.pending:
            data_source_id = getattr(obj, "data_source_id", None)
            if (
                data_source_id is not None
                and data_source_id not in self.known_source_ids
            ):
                self.poisoned = True
                raise IntegrityError(
                    "INSERT INTO data_lake_objects (data_source_id, ...) "
                    "VALUES (...)",
                    {},
                    Exception(
                        'insert or update on table "data_lake_objects" '
                        'violates foreign key constraint '
                        '"data_lake_objects_data_source_id_fkey"'
                    ),
                )
        for obj in self.pending:
            if isinstance(obj, DataSource):
                self.known_source_ids.add(obj.id)
        self.pending = []

    async def flush(self):
        self._check_not_poisoned()
        self._settle()
        self.flushes += 1

    async def commit(self):
        self._check_not_poisoned()
        self._settle()
        self.commits += 1


async def test_the_parent_source_must_be_flushed_in_isolation_before_onboarding_opens(
    tmp_path, monkeypatch
):
    """Regression test for the real production FK-violation bug.

    Merely `.add()`-ing the parent DataSource before calling
    _try_write_bronze is NOT enough -- confirmed against live Postgres, that
    still fails at commit time, because SQLAlchemy does not order these two
    mappers' inserts relative to each other without a relationship(). The fix
    in _save_data_source_to_db is to `db.add()` the parent and then
    `await db.flush()` it ALONE -- before _try_write_bronze (which opens
    onboarding and adds the FK-dependent staging DataLakeObject /
    DataOnboardingSession) is even called.

    This test pins both halves: the naive "add parent first, commit once"
    shape still fails, and the real fix's "flush the parent alone first"
    shape succeeds.
    """
    from sqlalchemy.exc import IntegrityError, PendingRollbackError

    from src.core.config import settings
    from src.modules.data.models import DataSource
    from src.modules.data.services import data_connectivity_service as svc

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    upload = tmp_path / "sales.csv"
    upload.write_text("a,b\n1,2\n")

    # --- the naive shape: parent added first, but never flushed alone ---
    naive_db = FlushAwareFakeDB()
    naive_db.add(DataSource(id="asset-naive", name="sales", type="file"))
    bronze = await svc._try_write_bronze(
        naive_db, str(upload), uuid.uuid4(), "asset-naive"
    )
    assert bronze is not None  # _try_write_bronze itself never flushes/commits
    with pytest.raises(IntegrityError):
        await naive_db.commit()
    assert naive_db.poisoned
    with pytest.raises(PendingRollbackError):
        await naive_db.commit()  # further use of a poisoned session also fails

    # --- the real fix's shape: parent flushed alone before onboarding opens ---
    db = FlushAwareFakeDB()
    db.add(DataSource(id="asset-fixed", name="sales", type="file"))
    await db.flush()
    assert db.flushes == 1
    assert not db.poisoned

    bronze = await svc._try_write_bronze(
        db, str(upload), uuid.uuid4(), "asset-fixed"
    )
    assert bronze is not None
    assert not db.poisoned

    await db.commit()
    assert db.commits == 1
    assert not db.poisoned


async def test_save_data_source_to_db_flushes_the_parent_before_opening_onboarding(
    tmp_path, monkeypatch
):
    """End-to-end (within the fake) regression test against the *real*
    _save_data_source_to_db, not just a hand-rolled call order: proves the
    live method actually performs the parent-flush-then-open-onboarding
    sequence the fix requires, and that it still returns True and enqueues
    the profiling job only after its own single real commit.
    """
    from src.core.config import settings
    from src.modules.data.services import data_connectivity_service as svc
    from src.modules.data.services.data_source_access_service import (
        DataSourceAccessService,
    )

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    upload = tmp_path / "sales.csv"
    upload.write_text("a,b\n1,2\n")

    async def fake_grant_project_access(**kwargs):
        return None

    monkeypatch.setattr(
        DataSourceAccessService, "grant_project_access", fake_grant_project_access
    )

    db = FlushAwareFakeDB()

    class FakeSessionCtx:
        async def __aenter__(self):
            return db

        async def __aexit__(self, *_exc):
            return False

    monkeypatch.setattr("src.db.session.async_session", lambda: FakeSessionCtx())

    enqueued = []

    async def fake_enqueue(name, **kwargs):
        enqueued.append((name, kwargs))

    monkeypatch.setattr("src.shared.jobs.client.enqueue_job", fake_enqueue)

    data_source_id = str(uuid.uuid4())
    data_source = {
        "id": data_source_id,
        "name": "sales",
        "type": "file",
        "schema": {"columns": ["a", "b"]},
        "file_path": "orgs/x/staging/sales.csv",
        "project_id": str(uuid.uuid4()),
        "organization_id": str(uuid.uuid4()),
        "user_id": None,
        "source_file_path": str(upload),
    }

    service = svc.DataConnectivityService()
    ok = await service._save_data_source_to_db(data_source)

    assert ok is True
    assert not db.poisoned
    assert db.flushes == 1, (
        "the parent DataSource must be flushed exactly once, in isolation, "
        "before onboarding's FK-dependent rows are added"
    )
    assert db.commits == 1
    onboarding = data_source["schema"]["storage"]["onboarding"]
    assert enqueued == [
        ("profile_staged_asset", {"session_id": onboarding["onboarding_session_id"]})
    ]


async def test_an_onboarding_failure_never_breaks_the_upload(monkeypatch):
    from src.modules.data.services import data_connectivity_service as svc

    async def boom(db, **kwargs):
        raise RuntimeError("object store unreachable")

    monkeypatch.setattr("src.modules.pipeline.onboarding.service.create_session", boom)

    result = await svc._try_write_bronze(
        session=None,
        file_path="/tmp/sales.csv",
        organization_id=uuid.uuid4(),
        data_source_id="asset-1",
    )

    assert result is None


async def test_no_organization_means_no_session():
    from src.modules.data.services import data_connectivity_service as svc

    result = await svc._try_write_bronze(
        session=None,
        file_path="/tmp/sales.csv",
        organization_id=None,
        data_source_id="asset-1",
    )

    assert result is None
