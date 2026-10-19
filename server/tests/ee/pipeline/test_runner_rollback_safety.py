"""A stage (or a service it calls) can roll the session back on a handled error. Afterwards the
runner must still be able to read its rows (run, pipeline, sheets) in async code; reading an
expired attribute raised MissingGreenlet and left the run stuck at "running".

Checked on SQLite (in memory) and on PostgreSQL through asyncpg, as production runs it (in a
schema of its own, created and dropped here; nothing else in the database is touched)."""

import os
import uuid

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")


def _postgres_url():
    from src.core.config import settings

    url = str(getattr(settings, "DATABASE_URL", "") or "")
    return url if url.startswith("postgresql+asyncpg://") else None


@pytest.mark.asyncio
@pytest.mark.parametrize("backend", ["sqlite", "postgresql"])
async def test_rows_expired_by_a_rollback_are_loaded_again(backend):
    from sqlalchemy import Column, Integer, MetaData, String, exc, text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
    from sqlalchemy.orm import declarative_base

    from src.modules.pipeline.runner import reload_expired

    schema = None
    if backend == "sqlite":
        pytest.importorskip("aiosqlite")
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    else:
        url = _postgres_url()
        if not url:
            pytest.skip("no PostgreSQL database configured")
        engine = create_async_engine(url)
        schema = f"test_rollback_{uuid.uuid4().hex[:10]}"
        try:
            async with engine.begin() as conn:
                await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
        except Exception as exc:  # noqa: BLE001
            await engine.dispose()
            pytest.skip(f"PostgreSQL unavailable: {exc}")

    Base = declarative_base(metadata=MetaData(schema=schema))

    class Sheet(Base):
        __tablename__ = "sheet"
        id = Column(Integer, primary_key=True)
        source_table = Column(String)

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        make = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with make() as session:
            sheet = Sheet(id=1, source_table="Sheet1")
            session.add(sheet)
            await session.commit()
            await session.execute(text("SELECT 1"))  # a stage's work opens a transaction…
            await session.rollback()  # …that a handled error rolls back, expiring every row

            with pytest.raises(exc.MissingGreenlet):
                _ = sheet.source_table  # the old failure
            await reload_expired(session, sheet)
            assert sheet.source_table == "Sheet1"
            await reload_expired(session, sheet)  # nothing expired: no-op
    finally:
        if schema:
            async with engine.begin() as conn:
                await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()


def test_a_sheet_view_carries_what_stages_read():
    """Multi-table runs hand stages a per-table view of the pipeline. Stages read who created it
    (their own saved buckets are its destinations) and its project; the view dropped both, so an
    S3 destination saved by that person was "not found" on every multi-table run."""
    import re
    from pathlib import Path

    from src.modules.pipeline.runner import PipelineSheetView, _sheet_view

    root = Path(__file__).resolve().parents[3] / "ee" / "modules" / "pipeline"
    read = set()
    for path in root.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        read |= set(re.findall(r'ctx\.pipeline\.([a-z_]+)', text)) | set(re.findall(r'getattr\(ctx\.pipeline, "([a-z_]+)"', text))
    fields = set(PipelineSheetView.__dataclass_fields__)
    assert read <= fields, f"stages read {sorted(read - fields)} that the sheet view lacks"

    pipeline = type("P", (), {"id": 1, "organization_id": 2, "name": "n", "slug": "s", "source_asset_type": "data_source",
                              "source_asset_id": "ds", "target_layer": "gold", "ingest_mode": "snapshot", "options": {},
                              "created_by": "u1", "project_id": "p1"})()
    sheet = type("S", (), {"source_table": "orders", "watermark_column": None, "yaml_artifact_id": None})()
    view = _sheet_view(pipeline, sheet)
    assert (view.created_by, view.project_id, view.options["source_table"]) == ("u1", "p1", "orders")
