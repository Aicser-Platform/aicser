"""Data model relationship service — auto-detect and CRUD."""

from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.data.models import DataModelRelationship, DataSource


def _serialize_relationship(rel: DataModelRelationship) -> dict:
    return {
        "id": str(rel.id),
        "data_source_id": rel.data_source_id,
        "to_data_source_id": rel.to_data_source_id,
        "from_table": rel.from_table,
        "from_column": rel.from_column,
        "to_table": rel.to_table,
        "to_column": rel.to_column,
        "join_type": rel.join_type or "LEFT",
        "cardinality": rel.cardinality or "one_to_many",
        "cross_filter_direction": rel.cross_filter_direction or "single",
        "is_active": bool(rel.is_active),
        "assume_integrity": bool(rel.assume_integrity),
        "created_at": rel.created_at.isoformat() if rel.created_at else None,
    }


def _table_names_from_schema(schema_info: Any) -> set[str]:
    names: set[str] = set()
    if not isinstance(schema_info, dict):
        return names
    tables = schema_info.get("tables") or []
    for t in tables:
        if isinstance(t, dict) and t.get("name"):
            names.add(str(t["name"]).lower())
    if schema_info.get("table"):
        names.add(str(schema_info["table"]).lower())
    return names


def _guess_target_table(column_name: str, table_names: set[str]) -> Optional[str]:
    """Heuristic: user_id -> users/user, order_id -> orders/order."""
    if not column_name.endswith("_id"):
        return None
    base = column_name[:-3]
    if not base:
        return None
    candidates = [
        base,
        f"{base}s",
        base.rstrip("s"),
        f"{base.rstrip('s')}s",
    ]
    for cand in candidates:
        if cand.lower() in table_names:
            for t in table_names:
                if t == cand.lower():
                    return t
    return base


class DataModelService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_data_source(self, data_source_id: str) -> Optional[DataSource]:
        return await self.db.get(DataSource, data_source_id)

    async def list_relationships(self, data_source_id: str) -> List[dict]:
        stmt = (
            select(DataModelRelationship)
            .where(DataModelRelationship.data_source_id == data_source_id)
            .order_by(DataModelRelationship.created_at.asc())
        )
        result = await self.db.execute(stmt)
        return [_serialize_relationship(r) for r in result.scalars().all()]

    async def create_relationship(self, data_source_id: str, payload: dict) -> dict:
        rel = DataModelRelationship(
            data_source_id=data_source_id,
            to_data_source_id=payload.get("to_data_source_id"),
            from_table=payload["from_table"],
            from_column=payload["from_column"],
            to_table=payload["to_table"],
            to_column=payload["to_column"],
            join_type=(payload.get("join_type") or "LEFT").upper(),
            cardinality=payload.get("cardinality") or "one_to_many",
            cross_filter_direction=payload.get("cross_filter_direction") or "single",
            is_active=payload.get("is_active", True),
            assume_integrity=payload.get("assume_integrity", False),
        )
        self.db.add(rel)
        await self.db.commit()
        await self.db.refresh(rel)
        return _serialize_relationship(rel)

    async def update_relationship(
        self, data_source_id: str, relationship_id: UUID, payload: dict
    ) -> Optional[dict]:
        rel = await self.db.get(DataModelRelationship, relationship_id)
        if not rel or rel.data_source_id != data_source_id:
            return None
        for field in ("cardinality", "cross_filter_direction", "is_active", "assume_integrity", "join_type"):
            if field in payload:
                setattr(rel, field, payload[field])
        await self.db.commit()
        await self.db.refresh(rel)
        return _serialize_relationship(rel)

    async def delete_relationship(self, data_source_id: str, relationship_id: UUID) -> bool:
        stmt = delete(DataModelRelationship).where(
            DataModelRelationship.id == relationship_id,
            DataModelRelationship.data_source_id == data_source_id,
        )
        result = await self.db.execute(stmt)
        await self.db.commit()
        return result.rowcount > 0

    async def auto_detect(self, data_source_id: str) -> List[dict]:
        ds = await self.get_data_source(data_source_id)
        if not ds:
            return []

        schema_info = ds.schema if isinstance(ds.schema, dict) else {}
        tables = schema_info.get("tables") or []
        table_names = _table_names_from_schema(schema_info)
        detected: List[Dict[str, str]] = []
        seen: set[tuple] = set()

        for table in tables:
            if not isinstance(table, dict):
                continue
            from_table = table.get("name")
            if not from_table:
                continue
            schema_name = table.get("schema") or schema_info.get("schema") or "public"
            for col in table.get("columns") or []:
                if not isinstance(col, dict):
                    continue
                col_name = col.get("name")
                if not col_name:
                    continue

                ref_table = col.get("references_table")
                ref_col = col.get("references_column")
                if col.get("is_foreign_key") and ref_table and ref_col:
                    key = (from_table, col_name, ref_table, ref_col)
                    if key not in seen:
                        seen.add(key)
                        detected.append({
                            "from_table": from_table,
                            "from_column": col_name,
                            "to_table": ref_table,
                            "to_column": ref_col,
                            "join_type": "LEFT",
                            "source": "fk_metadata",
                            "from_schema": schema_name,
                        })
                    continue

                if col_name.endswith("_id"):
                    guessed = _guess_target_table(col_name, table_names)
                    if guessed:
                        key = (from_table, col_name, guessed, "id")
                        if key not in seen:
                            seen.add(key)
                            detected.append({
                                "from_table": from_table,
                                "from_column": col_name,
                                "to_table": guessed,
                                "to_column": "id",
                                "join_type": "LEFT",
                                "source": "heuristic",
                                "from_schema": schema_name,
                            })

        created: List[dict] = []
        existing = await self.list_relationships(data_source_id)
        existing_keys = {
            (r["from_table"], r["from_column"], r["to_table"], r["to_column"]) for r in existing
        }
        for item in detected:
            key = (item["from_table"], item["from_column"], item["to_table"], item["to_column"])
            if key in existing_keys:
                continue
            rel = DataModelRelationship(
                data_source_id=data_source_id,
                from_table=item["from_table"],
                from_column=item["from_column"],
                to_table=item["to_table"],
                to_column=item["to_column"],
                join_type=item.get("join_type", "LEFT"),
                cardinality="one_to_many",
                cross_filter_direction="single",
                is_active=True,
                assume_integrity=False,
            )
            self.db.add(rel)
            await self.db.flush()
            created.append(_serialize_relationship(rel))
            existing_keys.add(key)
        await self.db.commit()
        return await self.list_relationships(data_source_id)
