"""Core dimensions are defined once and used wherever the engine can join to them."""

import pytest

from src.modules.semantic_domains.core import availability, core_dimensions


def test_where_a_core_dimension_can_be_used():
    lake = {"wh-1", "wh-2"}
    assert availability("db-1", "db-1", lake) == "same_connection"
    assert availability("wh-2", "wh-1", lake) == "lakehouse"
    assert availability("db-2", "wh-1", lake) == "needs_lakehouse"
    assert availability("db-2", "db-1", lake) == "needs_lakehouse"


class _DB:
    def __init__(self, dims, warehouses):
        self.dims, self.warehouses = dims, warehouses

    async def execute(self, statement, params=None):
        sql = str(statement)
        rows = self.dims if "semantic_dimensions" in sql else [(w,) for w in self.warehouses if w in (params or {}).get("ids", [])]

        class _R:
            def all(self):
                return rows

        return _R()

    async def rollback(self):
        pass


@pytest.mark.asyncio
async def test_core_dimensions_seen_from_a_domain_connection():
    db = _DB(
        dims=[("d1", "fiscal_month", "DATE_TRUNC('month', d.date)", None, "wh-1", None),
              ("d2", "legal_entity", "e.entity_name", "Company in the group", "wh-1", None)],
        warehouses=["wh-1", "wh-2"],
    )
    seen = await core_dimensions(db, "00000000-0000-0000-0000-000000000001", "wh-2")
    assert [(d["name"], d["availability"]) for d in seen] == [("fiscal_month", "lakehouse"), ("legal_entity", "lakehouse")]
    live = await core_dimensions(db, "00000000-0000-0000-0000-000000000001", "postgres-sales")
    assert {d["availability"] for d in live} == {"needs_lakehouse"}
    assert await core_dimensions(db, None, "wh-2") == []
