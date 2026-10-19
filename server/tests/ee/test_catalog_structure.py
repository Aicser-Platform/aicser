"""Filing assets (domain, tags, glossary terms, friendly name, steward) and the glossary, on
PostgreSQL in a schema of its own (created and dropped here)."""

import os
import uuid

import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")


@pytest.fixture
async def db():
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from src.core.config import settings
    from src.modules.catalog.models import CatalogAnnotation, GlossaryTerm

    url = str(getattr(settings, "DATABASE_URL", "") or "")
    if not url.startswith("postgresql+asyncpg://"):
        pytest.skip("no PostgreSQL database configured")
    schema = f"test_catalog_{uuid.uuid4().hex[:10]}"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = engine.execution_options(schema_translate_map={None: schema})
    async with scoped.begin() as conn:
        await conn.run_sync(lambda c: CatalogAnnotation.__table__.create(c))
        await conn.run_sync(lambda c: GlossaryTerm.__table__.create(c))
    make = async_sessionmaker(scoped, class_=AsyncSession, expire_on_commit=False)
    try:
        async with make() as session:
            yield session
    finally:
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        await engine.dispose()


ORG = str(uuid.uuid4())
USER = str(uuid.uuid4())


@pytest.mark.asyncio
async def test_filing_an_asset_and_the_glossary(db):
    from src.modules.catalog import structure

    term = await structure.save_term(db, ORG, USER, None, {"name": "Net revenue", "definition": "Revenue after refunds",
                                                          "synonyms": ["Net Sales", "net sales"], "domain": "Finance"})
    assert term["synonyms"] == ["net sales"] and term["status"] == "draft"
    with pytest.raises(ValueError, match="already"):
        await structure.save_term(db, ORG, USER, None, {"name": "net revenue"})

    ref = "ds1:public.orders"
    filed = await structure.upsert_annotation(db, ORG, USER, "table", ref, {
        "domain": "Sales", "tags": ["Daily", "pii!", "daily"], "terms": [term["id"], str(uuid.uuid4())],
        "display_name": "Orders", "steward_user_id": USER})
    assert filed["tags"] == ["daily", "pii"] and filed["terms"] == [term["id"]]  # unknown term dropped
    assert filed["display_name"] == "Orders" and filed["steward_user_id"] == USER

    # Only the fields sent change.
    again = await structure.upsert_annotation(db, ORG, USER, "table", ref, {"tags": ["weekly"]})
    assert again["domain"] == "Sales" and again["tags"] == ["weekly"]

    assert {d["name"]: d["assets"] for d in await structure.domains(db, ORG)} == {"Sales": 1, "Finance": 0}
    listed = await structure.list_terms(db, ORG, "net sales")
    assert [t["name"] for t in listed] == ["Net revenue"] and listed[0]["assets"] == 1

    await structure.delete_term(db, ORG, term["id"])
    assert (await structure.annotations(db, ORG))[("table", ref)]["terms"] == []
    assert await structure.annotations(db, str(uuid.uuid4())) == {}  # another organization sees nothing
