import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import uuid
from pathlib import Path

import pytest  # noqa: E402

FIXTURES = Path(__file__).parent / "fixtures" / "onboarding"


def test_staging_key_is_namespaced_by_org_asset_and_session():
    from src.modules.pipeline.onboarding.service import staging_key

    org, session = uuid.uuid4(), uuid.uuid4()
    key = staging_key(org, "asset-1", session, "sales.csv")

    assert key == f"orgs/{org}/staging/asset-1/session={session}/sales.csv"


def test_staging_key_sanitises_a_hostile_filename():
    from src.modules.pipeline.onboarding.service import staging_key

    key = staging_key(uuid.uuid4(), "a1", uuid.uuid4(), "../../etc/passwd")

    assert ".." not in key
    assert key.endswith("/passwd")


def test_cast_plan_keeps_only_confirmed_columns_that_exist():
    from src.modules.pipeline.onboarding.service import cast_plan

    plan = cast_plan(
        {"types": {"amount": "double", "ghost": "bigint", "region": "varchar"}},
        ["amount", "region"],
    )

    assert plan == {"amount": "double"}


def test_cast_plan_rejects_a_type_outside_the_allowed_set():
    from src.modules.pipeline.onboarding.service import cast_plan

    with pytest.raises(ValueError, match="unsupported cast type"):
        cast_plan({"types": {"amount": "DROP TABLE users"}}, ["amount"])


def test_bad_row_predicate_is_false_when_nothing_is_typed():
    from src.modules.pipeline.onboarding.service import bad_row_predicate

    assert bad_row_predicate({}) == "false"


def test_bad_row_predicate_flags_values_lost_to_a_cast():
    import duckdb

    from src.modules.pipeline.onboarding.service import bad_row_predicate

    predicate = bad_row_predicate({"amount": "double"})
    rows = (
        duckdb.connect()
        .execute(
            "SELECT amount FROM (VALUES ('1.5'), ('oops'), (NULL)) AS t(amount) "
            f"WHERE {predicate}"
        )
        .fetchall()
    )

    assert rows == [("oops",)]


def test_bad_row_predicate_treats_a_blank_string_as_missing_not_bad():
    import duckdb

    from src.modules.pipeline.onboarding.service import bad_row_predicate

    predicate = bad_row_predicate({"amount": "double"})
    rows = (
        duckdb.connect()
        .execute(
            "SELECT amount FROM (VALUES ('1.5'), ('')) AS t(amount) "
            f"WHERE {predicate}"
        )
        .fetchall()
    )

    assert rows == []


def test_bad_row_predicate_treats_a_whitespace_only_string_as_missing_not_bad():
    import duckdb

    from src.modules.pipeline.onboarding.service import bad_row_predicate

    predicate = bad_row_predicate({"amount": "double"})
    rows = (
        duckdb.connect()
        .execute(
            "SELECT amount FROM (VALUES ('1.5'), ('   ')) AS t(amount) "
            f"WHERE {predicate}"
        )
        .fetchall()
    )

    assert rows == []


def test_bad_row_predicate_treats_null_tokens_as_missing_not_bad():
    import duckdb

    from src.modules.pipeline.onboarding.service import bad_row_predicate

    predicate = bad_row_predicate({"amount": "double"})
    rows = (
        duckdb.connect()
        .execute(
            "SELECT amount FROM (VALUES ('1.5'), ('N/A'), ('n/a'), ('NULL')) "
            f"AS t(amount) WHERE {predicate}"
        )
        .fetchall()
    )

    assert rows == []


def test_bad_row_predicate_still_flags_a_genuinely_malformed_value():
    import duckdb

    from src.modules.pipeline.onboarding.service import bad_row_predicate

    predicate = bad_row_predicate({"amount": "double"})
    rows = (
        duckdb.connect()
        .execute(
            "SELECT amount FROM (VALUES ('1.5'), ('oops')) AS t(amount) "
            f"WHERE {predicate}"
        )
        .fetchall()
    )

    assert rows == [("oops",)]


def test_bad_row_predicate_does_not_flag_a_valid_value():
    import duckdb

    from src.modules.pipeline.onboarding.service import bad_row_predicate

    predicate = bad_row_predicate({"amount": "double"})
    rows = (
        duckdb.connect()
        .execute(f"SELECT amount FROM (VALUES ('1.5')) AS t(amount) WHERE {predicate}")
        .fetchall()
    )

    assert rows == []


def test_bad_row_predicate_does_not_flag_a_sql_null():
    import duckdb

    from src.modules.pipeline.onboarding.service import bad_row_predicate

    predicate = bad_row_predicate({"amount": "double"})
    rows = (
        duckdb.connect()
        .execute(
            "SELECT amount FROM (VALUES ('1.5'), (NULL)) AS t(amount) "
            f"WHERE {predicate}"
        )
        .fetchall()
    )

    assert rows == []


async def test_staged_table_reads_a_csv_through_file_source(tmp_path):
    from src.modules.pipeline.onboarding.service import staged_table
    from src.modules.pipeline.storage import LocalObjectStore

    store = LocalObjectStore(root=str(tmp_path))
    await store.store_file((FIXTURES / "clean.csv").read_bytes(), "k/clean.csv")

    class Obj:
        object_key = "k/clean.csv"
        format = "csv"

    table = await staged_table(store, Obj())

    assert table.num_rows == 3
    assert "label" in table.schema.names


async def test_staged_table_defaults_to_the_first_sheet_of_a_workbook(tmp_path):
    """Regression: pd.read_excel() with no sheet_name silently takes sheet 0.
    Unchanged behaviour when the caller doesn't ask for a specific sheet."""
    import pandas as pd

    from src.modules.pipeline.onboarding.service import staged_table
    from src.modules.pipeline.storage import LocalObjectStore

    workbook = tmp_path / "book.xlsx"
    with pd.ExcelWriter(workbook) as writer:
        pd.DataFrame({"a": [1, 2]}).to_excel(writer, sheet_name="First", index=False)
        pd.DataFrame({"b": [3, 4, 5]}).to_excel(
            writer, sheet_name="Second", index=False
        )

    store = LocalObjectStore(root=str(tmp_path))
    await store.store_file(workbook.read_bytes(), "k/book.xlsx")

    class Obj:
        object_key = "k/book.xlsx"
        format = "xlsx"

    table = await staged_table(store, Obj())

    assert table.schema.names == ["a"]
    assert table.num_rows == 2


async def test_staged_table_reads_the_requested_sheet(tmp_path):
    import pandas as pd

    from src.modules.pipeline.onboarding.service import staged_table
    from src.modules.pipeline.storage import LocalObjectStore

    workbook = tmp_path / "book.xlsx"
    with pd.ExcelWriter(workbook) as writer:
        pd.DataFrame({"a": [1, 2]}).to_excel(writer, sheet_name="First", index=False)
        pd.DataFrame({"b": [3, 4, 5]}).to_excel(
            writer, sheet_name="Second", index=False
        )

    store = LocalObjectStore(root=str(tmp_path))
    await store.store_file(workbook.read_bytes(), "k/book.xlsx")

    class Obj:
        object_key = "k/book.xlsx"
        format = "xlsx"

    table = await staged_table(store, Obj(), sheet_name="Second")

    assert table.schema.names == ["b"]
    assert table.num_rows == 3


async def test_staged_table_rejects_an_unsupported_format(tmp_path):
    from src.modules.pipeline.onboarding.service import staged_table
    from src.modules.pipeline.storage import LocalObjectStore

    store = LocalObjectStore(root=str(tmp_path))
    await store.store_file(b"binary", "k/thing.exe")

    class Obj:
        object_key = "k/thing.exe"
        format = "exe"

    with pytest.raises(ValueError, match="unsupported file format"):
        await staged_table(store, Obj())


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeDB:
    """Enough AsyncSession surface for the service; no database required."""

    def __init__(self, *objects):
        self.objects = list(objects)
        self.added = []
        self.commits = 0

    async def execute(self, _statement):
        return FakeResult(self.objects[0] if self.objects else None)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def flush(self):
        pass

    async def refresh(self, _obj):
        pass


def _session(status="review", decisions=None):
    from src.modules.data.models import DataOnboardingSession

    return DataOnboardingSession(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        data_source_id="asset-1",
        staging_object_id=uuid.uuid4(),
        status=status,
        decisions=decisions or {},
    )


async def test_create_session_does_not_commit_the_callers_session(
    tmp_path, monkeypatch
):
    """Regression test: create_session must never commit a session it does not
    own. The caller (the onboarding router's create handler, and
    _try_write_bronze's caller in data_connectivity_service) may still need to
    add more objects -- notably the parent data_sources row -- before it is
    safe to commit. A premature commit here previously flushed a
    DataLakeObject/DataOnboardingSession pair whose data_source_id FK pointed
    at a data_sources row that did not exist yet, raising
    ForeignKeyViolationError and poisoning the caller's session.
    """
    from src.core.config import settings
    from src.modules.pipeline.onboarding.service import create_session

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    upload = tmp_path / "sales.csv"
    upload.write_text("a,b\n1,2\n")

    db = FakeDB()

    session = await create_session(
        db,
        org_id=uuid.uuid4(),
        data_source_id="asset-1",
        file_path=str(upload),
        filename="sales.csv",
    )

    assert db.commits == 0
    assert len(db.added) == 2
    assert session.data_source_id == "asset-1"


async def test_create_session_records_available_sheets_when_the_workbook_has_several(
    tmp_path, monkeypatch
):
    from src.core.config import settings
    from src.modules.pipeline.onboarding.service import create_session

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    upload = tmp_path / "book.xlsx"
    upload.write_bytes(b"not a real workbook, staging doesn't parse it")

    session = await create_session(
        FakeDB(),
        org_id=uuid.uuid4(),
        data_source_id="asset-1",
        file_path=str(upload),
        filename="book.xlsx",
        available_sheets=["First", "Second"],
    )

    assert session.decisions == {"available_sheets": ["First", "Second"]}


async def test_create_session_ignores_a_single_sheet(tmp_path, monkeypatch):
    """A single sheet is not a choice -- no picker gate, same as today."""
    from src.core.config import settings
    from src.modules.pipeline.onboarding.service import create_session

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    upload = tmp_path / "sales.csv"
    upload.write_text("a,b\n1,2\n")

    session = await create_session(
        FakeDB(),
        org_id=uuid.uuid4(),
        data_source_id="asset-1",
        file_path=str(upload),
        filename="sales.csv",
        available_sheets=["Sheet1"],
    )

    assert session.decisions == {}


async def test_select_sheets_reuses_the_origin_session_for_the_first_pick():
    from src.modules.pipeline.onboarding.service import select_sheets

    origin = _session(
        status="profiling", decisions={"available_sheets": ["First", "Second"]}
    )
    db = FakeDB(origin)

    sessions = await select_sheets(db, origin.id, ["First"])

    assert len(sessions) == 1
    assert sessions[0] is origin
    assert origin.decisions["sheet_name"] == "First"
    assert origin.status == "profiling"
    assert db.added == []


async def test_select_sheets_creates_a_sibling_session_per_additional_pick():
    from src.modules.data.models import DataOnboardingSession
    from src.modules.pipeline.onboarding.service import select_sheets

    origin = _session(
        status="review", decisions={"available_sheets": ["First", "Second", "Third"]}
    )
    db = FakeDB(origin)

    sessions = await select_sheets(db, origin.id, ["Second", "Third"])

    assert [s.decisions["sheet_name"] for s in sessions] == ["Second", "Third"]
    assert sessions[0] is origin
    assert origin.status == "profiling"
    assert len(db.added) == 1
    sibling = db.added[0]
    assert isinstance(sibling, DataOnboardingSession)
    assert sibling.staging_object_id == origin.staging_object_id
    assert sibling.organization_id == origin.organization_id
    assert sibling.data_source_id == origin.data_source_id
    assert sibling.decisions["sheet_name"] == "Third"


async def test_select_sheets_rejects_an_empty_selection():
    from src.modules.pipeline.onboarding.service import select_sheets

    origin = _session(decisions={"available_sheets": ["First", "Second"]})

    with pytest.raises(ValueError, match="select at least one sheet"):
        await select_sheets(FakeDB(origin), origin.id, [])


async def test_select_sheets_rejects_a_sheet_not_in_the_workbook():
    from src.modules.pipeline.onboarding.service import select_sheets

    origin = _session(decisions={"available_sheets": ["First", "Second"]})

    with pytest.raises(ValueError, match="unknown sheet"):
        await select_sheets(FakeDB(origin), origin.id, ["Nonexistent"])


async def test_apply_decisions_merges_rather_than_replaces():
    from src.modules.pipeline.onboarding.service import apply_decisions

    session = _session(decisions={"types": {"a": "bigint"}, "on_fail": "warn"})
    db = FakeDB(session)

    updated = await apply_decisions(db, session.id, {"primary_key": ["a"]})

    assert updated.decisions["types"] == {"a": "bigint"}
    assert updated.decisions["on_fail"] == "warn"
    assert updated.decisions["primary_key"] == ["a"]
    assert db.commits == 1


async def test_apply_decisions_is_rejected_outside_review():
    from src.modules.pipeline.onboarding.service import apply_decisions

    session = _session(status="profiling")

    with pytest.raises(ValueError, match="only editable while in review"):
        await apply_decisions(FakeDB(session), session.id, {"on_fail": "fail"})


async def test_apply_decisions_rejects_an_unknown_policy():
    from src.modules.pipeline.onboarding.service import apply_decisions

    session = _session()

    with pytest.raises(ValueError, match="unsupported on_fail"):
        await apply_decisions(FakeDB(session), session.id, {"on_fail": "explode"})


async def test_ingest_is_rejected_when_the_session_is_not_in_review():
    from src.modules.pipeline.onboarding.service import run_ingest

    session = _session(status="ingested")

    status = await run_ingest(FakeDB(session), session.id)

    assert status == "ingested"


async def test_quarantine_splits_bad_rows_out_of_bronze(tmp_path, monkeypatch):
    """A cast that loses a value diverts the row."""
    import duckdb
    import pyarrow as pa

    from src.core.config import settings
    from src.modules.pipeline.onboarding.service import bad_row_predicate

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    conn = duckdb.connect()
    conn.register(
        "src",
        pa.table({"amount": pa.array(["1.5", "oops", None], type=pa.string())}),
    )
    predicate = bad_row_predicate({"amount": "double"})

    good = conn.execute(f"SELECT * FROM src WHERE NOT ({predicate})").arrow()
    if hasattr(good, "read_all"):
        good = good.read_all()
    bad = conn.execute(f"SELECT * FROM src WHERE {predicate}").arrow()
    if hasattr(bad, "read_all"):
        bad = bad.read_all()

    assert good.num_rows == 2
    assert bad.num_rows == 1
