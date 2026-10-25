"""Data model relationship service — auto-detect and CRUD."""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.charts.models import Chart
from src.modules.data.models import DataModelRelationship, DataSource
from src.modules.data.services.query_routing import PIPELINE_AUDIT_COLUMNS


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


def _schema_tables(schema_info: Any) -> List[dict]:
    if not isinstance(schema_info, dict):
        return []
    return [t for t in (schema_info.get("tables") or []) if isinstance(t, dict) and t.get("name")]


def _detection_schema(ds: Any) -> dict:
    """A source's schema as detection reads it. Uploaded files store one flat column list; that
    is one table, named after the source as the diagram and its relationships name it."""
    schema_info = ds.schema if isinstance(getattr(ds, "schema", None), dict) else {}
    if not schema_info.get("tables") and isinstance(schema_info.get("columns"), list):
        return {**schema_info, "tables": [{"name": ds.name, "columns": schema_info["columns"]}]}
    return schema_info


def _column_name(col: Any) -> Optional[str]:
    if not isinstance(col, dict):
        return None
    name = col.get("name") or col.get("column_name")
    return str(name) if name else None


def _table_basename(table_name: str) -> str:
    name = str(table_name or "").strip()
    if "." in name:
        return name.rsplit(".", 1)[-1]
    return name


def _relationship_key_suffix(column_name: str) -> Optional[str]:
    name = str(column_name or "").strip().lower()
    # Pipeline bookkeeping (_load_id is on every Silver/Gold table) is never a business
    # key: matching on it joins unrelated tables, and served tables don't carry it.
    if name in PIPELINE_AUDIT_COLUMNS:
        return None
    if name.startswith("unnamed") or name in ("index", "row_number", "row_id"):
        return None
    if name.endswith("_id") and len(name) > 3:
        return "_id"
    if name.endswith("_key") and len(name) > 4:
        return "_key"
    if name.endswith("_code") and len(name) > 5:
        return "_code"
    if name.endswith("_number") and len(name) > 8:
        return "_number"
    return None


def _entity_from_key_column(column_name: str) -> Optional[str]:
    suffix = _relationship_key_suffix(column_name)
    if not suffix:
        return None
    entity = str(column_name[: -len(suffix)] or "").strip().lower()
    return entity or None


def _singularize(name: str) -> str:
    n = name.lower()
    if n.endswith("ies") and len(n) > 4:
        return n[:-3] + "y"
    if n.endswith("s") and len(n) > 2:
        return n[:-1]
    return n


def _entity_matches_table(entity: str, table_name: str) -> bool:
    base = _table_basename(table_name).lower()
    ent = entity.lower()
    if base == ent or base == f"{ent}s" or _singularize(base) == ent or _singularize(ent) == _singularize(base):
        return True
    if base.endswith(f"_{ent}") or base.endswith(f"_{ent}s"):
        return True
    return False


def _basename_index(table_names: set[str]) -> Dict[str, List[str]]:
    out: Dict[str, List[str]] = {}
    for t in table_names:
        base = _table_basename(t).lower()
        out.setdefault(base, []).append(t)
        for variant in (_singularize(base), f"{base}s", f"{_singularize(base)}s"):
            out.setdefault(variant, []).append(t)
    return out


def _resolve_table_name(candidate: str, table_names: set[str], basename_index: Dict[str, List[str]]) -> Optional[str]:
    low = candidate.lower()
    if low in table_names:
        return low
    matches = basename_index.get(low) or []
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        return sorted(matches, key=len)[0]
    return None


def _guess_target_table(
    column_name: str,
    table_names: set[str],
    basename_index: Dict[str, List[str]],
) -> Optional[str]:
    """Heuristic: user_id -> users/user, device_key -> dim_device/device, works with schema.table names."""
    entity = _entity_from_key_column(column_name)
    if not entity:
        return None
    candidates = [
        entity,
        f"{entity}s",
        _singularize(entity),
        f"{_singularize(entity)}s",
        f"dim_{entity}",
        f"{entity}_dim",
        f"ref_{entity}",
        f"lookup_{entity}",
    ]
    for cand in candidates:
        resolved = _resolve_table_name(cand, table_names, basename_index)
        if resolved:
            return resolved
    return None


def _preferred_pk_column(table: dict, columns_map: Dict[str, str]) -> Optional[str]:
    for col in table.get("columns") or []:
        if isinstance(col, dict) and col.get("is_primary_key"):
            name = _column_name(col)
            if name:
                return columns_map.get(name.lower(), name)
    base = _table_basename(str(table.get("name") or "")).lower()
    for cand in ("id", f"{base}_id", f"{_singularize(base)}_id"):
        if cand in columns_map:
            return columns_map[cand]
    return columns_map.get("id")


def _column_type_family(col: Any) -> str:
    raw = ""
    if isinstance(col, dict):
        raw = str(col.get("type") or col.get("data_type") or "")
    fam = raw.upper()
    if any(x in fam for x in ("INT", "DECIMAL", "NUMERIC", "DOUBLE", "FLOAT", "REAL", "NUMBER")):
        return "number"
    if any(x in fam for x in ("CHAR", "TEXT", "STRING", "UUID", "VARCHAR")):
        return "text"
    if any(x in fam for x in ("DATE", "TIME")):
        return "date"
    return "unknown"


def _types_compatible(left_col: Any, right_col: Any) -> bool:
    a = _column_type_family(left_col)
    b = _column_type_family(right_col)
    if a == "unknown" or b == "unknown":
        return True
    return a == b


def _col_obj_by_name(table: dict, col_name: str) -> Optional[dict]:
    target = col_name.lower()
    for col in table.get("columns") or []:
        if isinstance(col, dict) and str(col.get("name") or "").lower() == target:
            return col
    return None


def _row_count(table: dict) -> int:
    value = table.get("row_count") or table.get("rows") or table.get("estimated_rows") or 0
    try:
        return int(value)
    except Exception:
        return 0


def _is_fact_like(table_name: str) -> bool:
    name = str(table_name or "").lower()
    return "fact" in name or name.startswith(("f_", "tbl_fact_"))


def _is_dimension_like(table_name: str) -> bool:
    name = str(table_name or "").lower()
    return "dim" in name or name.startswith(("d_", "lookup_", "ref_"))


def _relationship_direction(
    left_table: dict,
    right_table: dict,
) -> Tuple[dict, dict]:
    left_name = str(left_table.get("name") or "")
    right_name = str(right_table.get("name") or "")
    if _is_fact_like(left_name) and not _is_fact_like(right_name):
        return left_table, right_table
    if _is_fact_like(right_name) and not _is_fact_like(left_name):
        return right_table, left_table
    if _is_dimension_like(left_name) and not _is_dimension_like(right_name):
        return right_table, left_table
    if _is_dimension_like(right_name) and not _is_dimension_like(left_name):
        return left_table, right_table
    if _row_count(left_table) >= _row_count(right_table):
        return left_table, right_table
    return right_table, left_table


def _detect_relationship_candidates(schema_info: Any) -> List[Dict[str, str]]:
    """Infer relationships from FK metadata plus common *_id / *_key patterns.

    File uploads and BI-style workbooks frequently model facts and dimensions
    with shared natural keys (for example fact.device_key = dim_device.device_key).
    The older detector only guessed ``*_id -> id``, which missed those schemas.
    """
    if not isinstance(schema_info, dict):
        return []

    tables = _schema_tables(schema_info)
    table_names = _table_names_from_schema(schema_info)
    basename_index = _basename_index(table_names)
    table_by_lname = {str(t.get("name")).lower(): t for t in tables}
    columns_by_table: Dict[str, Dict[str, str]] = {}
    for table in tables:
        table_name = str(table.get("name"))
        columns_by_table[table_name.lower()] = {}
        for col in table.get("columns") or []:
            name = _column_name(col)
            if name:
                columns_by_table[table_name.lower()][name.lower()] = name

    detected: List[Dict[str, str]] = []
    seen: set[tuple] = set()

    def _add(
        from_table: str,
        from_column: str,
        to_table: str,
        to_column: str,
        *,
        source: str,
        schema_name: str,
    ) -> None:
        key = (from_table, from_column, to_table, to_column)
        reverse = (to_table, to_column, from_table, from_column)
        if from_table == to_table or key in seen or reverse in seen:
            return
        seen.add(key)
        detected.append(
            {
                "from_table": from_table,
                "from_column": from_column,
                "to_table": to_table,
                "to_column": to_column,
                "join_type": "LEFT",
                "source": source,
                "from_schema": schema_name,
            }
        )

    for table in tables:
        from_table = str(table.get("name"))
        schema_name = str(table.get("schema") or schema_info.get("schema") or "public")
        for col in table.get("columns") or []:
            col_name = _column_name(col)
            if not col_name:
                continue
            ref_table = col.get("references_table")
            ref_col = col.get("references_column")
            if col.get("is_foreign_key") and ref_table and ref_col:
                _add(
                    from_table,
                    col_name,
                    str(ref_table),
                    str(ref_col),
                    source="fk_metadata",
                    schema_name=schema_name,
                )

    for table in tables:
        from_table = str(table.get("name"))
        from_lname = from_table.lower()
        schema_name = str(table.get("schema") or schema_info.get("schema") or "public")
        for col in table.get("columns") or []:
            col_name = _column_name(col)
            if not col_name or not _relationship_key_suffix(col_name):
                continue

            # Strongest file/workbook signal: same key column exists in another
            # table. Direction points from fact/wider table to dimension/smaller table.
            matches = [
                other
                for other in tables
                if str(other.get("name")).lower() != from_lname
                and col_name.lower() in columns_by_table.get(str(other.get("name")).lower(), {})
            ]
            for other in matches:
                source_table, target_table = _relationship_direction(table, other)
                source_name = str(source_table.get("name"))
                target_name = str(target_table.get("name"))
                source_col = columns_by_table[source_name.lower()][col_name.lower()]
                target_col = columns_by_table[target_name.lower()][col_name.lower()]
                _add(
                    source_name,
                    source_col,
                    target_name,
                    target_col,
                    source="shared_key",
                    schema_name=schema_name,
                )

            if matches:
                continue

            entity = _entity_from_key_column(col_name)
            if entity:
                for other in tables:
                    other_name = str(other.get("name"))
                    if other_name.lower() == from_lname:
                        continue
                    if not _entity_matches_table(entity, other_name):
                        continue
                    target_cols = columns_by_table.get(other_name.lower(), {})
                    to_col = (
                        target_cols.get(col_name.lower())
                        or _preferred_pk_column(other, target_cols)
                    )
                    if not to_col:
                        continue
                    from_col_obj = _col_obj_by_name(table, col_name)
                    to_col_obj = _col_obj_by_name(other, to_col)
                    if from_col_obj and to_col_obj and not _types_compatible(from_col_obj, to_col_obj):
                        continue
                    _add(
                        from_table,
                        col_name,
                        other_name,
                        to_col,
                        source="entity_pk",
                        schema_name=schema_name,
                    )

            # Legacy fallback: order_id -> orders.id / order.id (schema-qualified names supported).
            guessed = _guess_target_table(col_name, table_names, basename_index)
            if not guessed:
                continue
            target = table_by_lname.get(guessed.lower())
            target_cols = columns_by_table.get(guessed.lower(), {})
            if not target:
                continue
            to_col = target_cols.get(col_name.lower()) or _preferred_pk_column(target, target_cols)
            if not to_col:
                continue
            _add(
                from_table,
                col_name,
                str(target.get("name")),
                to_col,
                source="heuristic",
                schema_name=schema_name,
            )

    return detected


def _detect_cross_source_candidates(
    sources: List[Tuple[str, Any]],
) -> List[Dict[str, str]]:
    """Match natural keys across data sources (e.g. enrollment.student_id ↔ students.student_id)."""
    entries: List[Dict[str, Any]] = []
    for data_source_id, schema_info in sources:
        if not isinstance(schema_info, dict):
            continue
        for table in _schema_tables(schema_info):
            table_name = str(table.get("name"))
            schema_name = str(table.get("schema") or schema_info.get("schema") or "public")
            for col in table.get("columns") or []:
                col_name = _column_name(col)
                if not col_name or not _relationship_key_suffix(col_name):
                    continue
                entries.append(
                    {
                        "data_source_id": data_source_id,
                        "table": table,
                        "table_name": table_name,
                        "schema_name": schema_name,
                        "col_name": col_name,
                        "col": col,
                        "col_lower": col_name.lower(),
                    }
                )

    detected: List[Dict[str, str]] = []
    seen: set[tuple] = set()

    def _add_cross(
        host_source_id: str,
        from_table: str,
        from_column: str,
        to_source_id: str,
        to_table: str,
        to_column: str,
        schema_name: str,
    ) -> None:
        if host_source_id == to_source_id and from_table == to_table:
            return
        key = (host_source_id, from_table, from_column, to_source_id, to_table, to_column)
        rev = (host_source_id, to_table, to_column, to_source_id, from_table, from_column)
        if key in seen or rev in seen:
            return
        seen.add(key)
        detected.append(
            {
                "data_source_id": host_source_id,
                "to_data_source_id": to_source_id if to_source_id != host_source_id else None,
                "from_table": from_table,
                "from_column": from_column,
                "to_table": to_table,
                "to_column": to_column,
                "join_type": "LEFT",
                "source": "cross_source",
                "from_schema": schema_name,
            }
        )

    by_col: Dict[str, List[Dict[str, Any]]] = {}
    for e in entries:
        by_col.setdefault(e["col_lower"], []).append(e)

    for col_lower, group in by_col.items():
        if len(group) < 2:
            continue
        for i, left in enumerate(group):
            for right in group[i + 1 :]:
                if left["data_source_id"] == right["data_source_id"] and left["table_name"] == right["table_name"]:
                    continue
                if not _types_compatible(left["col"], right["col"]):
                    continue
                source_table, target_table = _relationship_direction(left["table"], right["table"])
                if source_table is left["table"]:
                    from_e, to_e = left, right
                else:
                    from_e, to_e = right, left
                host = str(from_e["data_source_id"])
                to_src = str(to_e["data_source_id"])
                _add_cross(
                    host,
                    from_e["table_name"],
                    from_e["col_name"],
                    to_src,
                    to_e["table_name"],
                    to_e["col_name"],
                    str(from_e["schema_name"]),
                )

        # Same column name across sources but entity PK pattern (student_id -> dim with id).
        entity = _entity_from_key_column(col_lower)
        if not entity:
            continue
        for fact in group:
            for dim in group:
                if fact["table_name"] == dim["table_name"] and fact["data_source_id"] == dim["data_source_id"]:
                    continue
                if not _entity_matches_table(entity, dim["table_name"]):
                    continue
                dim_cols = {
                    str(_column_name(c) or "").lower(): _column_name(c)
                    for c in dim["table"].get("columns") or []
                    if _column_name(c)
                }
                to_col = dim_cols.get(col_lower) or _preferred_pk_column(dim["table"], dim_cols)
                if not to_col:
                    continue
                to_col_obj = _col_obj_by_name(dim["table"], to_col)
                if not _types_compatible(fact["col"], to_col_obj or {}):
                    continue
                source_table, target_table = _relationship_direction(fact["table"], dim["table"])
                if source_table is fact["table"]:
                    from_e, to_e = fact, dim
                else:
                    from_e, to_e = dim, fact
                _add_cross(
                    str(from_e["data_source_id"]),
                    from_e["table_name"],
                    from_e["col_name"],
                    str(to_e["data_source_id"]),
                    to_e["table_name"],
                    to_col,
                    str(from_e["schema_name"]),
                )

    return detected


class DataModelService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_data_source(self, data_source_id: str) -> Optional[DataSource]:
        return await self.db.get(DataSource, data_source_id)

    async def list_relationships(self, data_source_id: str) -> List[dict]:
        stmt = (
            select(DataModelRelationship)
            .where(
                (DataModelRelationship.data_source_id == data_source_id)
                | (DataModelRelationship.to_data_source_id == data_source_id)
            )
            .order_by(DataModelRelationship.created_at.asc())
        )
        result = await self.db.execute(stmt)
        seen: set[str] = set()
        out: List[dict] = []
        for r in result.scalars().all():
            rid = str(r.id)
            if rid in seen:
                continue
            seen.add(rid)
            out.append(_serialize_relationship(r))
        return out

    async def create_relationship(self, data_source_id: str, payload: dict) -> dict:
        # Idempotent create: a relationship is uniquely identified by its
        # (from_table, from_column, to_table, to_column) tuple within a data
        # source. Return the existing row instead of inserting a duplicate — the
        # ERD can fire the create path more than once for a single gesture.
        existing = await self.db.execute(
            select(DataModelRelationship).where(
                DataModelRelationship.data_source_id == data_source_id,
                DataModelRelationship.from_table == payload["from_table"],
                DataModelRelationship.from_column == payload["from_column"],
                DataModelRelationship.to_table == payload["to_table"],
                DataModelRelationship.to_column == payload["to_column"],
            )
        )
        duplicate = existing.scalars().first()
        if duplicate is not None:
            return _serialize_relationship(duplicate)

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

    @staticmethod
    def _bare_table_name(value: Optional[str]) -> str:
        if not value:
            return ""
        return str(value).split(".")[-1].strip().lower()

    @staticmethod
    def _field_ref_parts(value: Any) -> tuple[str, str]:
        if not isinstance(value, str):
            return "", ""
        parts = [p.strip().lower() for p in value.split(".") if p.strip()]
        if len(parts) < 2:
            return "", parts[-1] if parts else ""
        return parts[-2], parts[-1]

    def _join_matches_relationship(self, join: Any, rel: DataModelRelationship) -> bool:
        if not isinstance(join, dict):
            return False

        rel_id = str(rel.id)
        join_rel_id = join.get("relationshipId") or join.get("relationship_id")
        if join_rel_id and str(join_rel_id) == rel_id:
            return True

        on = join.get("on")
        if isinstance(on, str) and "=" in on:
            left, right = [part.strip() for part in on.split("=", 1)]
        elif isinstance(on, dict):
            left = on.get("left")
            right = on.get("right")
        else:
            return False

        left_ref = self._field_ref_parts(left)
        right_ref = self._field_ref_parts(right)
        from_ref = (
            self._bare_table_name(rel.from_table),
            str(rel.from_column).strip().lower(),
        )
        to_ref = (
            self._bare_table_name(rel.to_table),
            str(rel.to_column).strip().lower(),
        )
        return (left_ref == from_ref and right_ref == to_ref) or (
            left_ref == to_ref and right_ref == from_ref
        )

    async def _remove_relationship_from_chart_queries(
        self,
        data_source_id: str,
        rel: DataModelRelationship,
    ) -> int:
        result = await self.db.execute(select(Chart).where(Chart.data_source_id == data_source_id))
        changed = 0
        for chart in result.scalars().all():
            chart_query = chart.chart_query if isinstance(chart.chart_query, dict) else {}
            joins = chart_query.get("joins")
            if not isinstance(joins, list) or not joins:
                continue

            next_joins = [
                join for join in joins if not self._join_matches_relationship(join, rel)
            ]
            if len(next_joins) == len(joins):
                continue

            chart.chart_query = {**chart_query, "joins": next_joins}
            self.db.add(chart)
            changed += 1

        if changed:
            await self.db.flush()
        return changed

    async def delete_relationship(self, data_source_id: str, relationship_id: UUID) -> bool:
        result = await self.db.execute(
            select(DataModelRelationship).where(
                DataModelRelationship.id == relationship_id,
                DataModelRelationship.data_source_id == data_source_id,
            )
        )
        rel = result.scalar_one_or_none()
        if not rel:
            return False

        await self._remove_relationship_from_chart_queries(data_source_id, rel)
        await self.db.delete(rel)
        await self.db.commit()
        return True

    async def _persist_detected(
        self,
        data_source_id: str,
        detected: List[Dict[str, Any]],
        *,
        existing_keys: Optional[set] = None,
    ) -> int:
        if existing_keys is None:
            existing = await self.list_relationships(data_source_id)
            existing_keys = {
                (r["from_table"], r["from_column"], r["to_table"], r["to_column"]) for r in existing
            }
        added = 0
        for item in detected:
            host_id = str(item.get("data_source_id") or data_source_id)
            key = (item["from_table"], item["from_column"], item["to_table"], item["to_column"])
            if key in existing_keys:
                continue
            rel = DataModelRelationship(
                data_source_id=host_id,
                to_data_source_id=item.get("to_data_source_id"),
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
            existing_keys.add(key)
            added += 1
        return added

    async def auto_detect(
        self,
        data_source_id: str,
        *,
        peer_source_ids: Optional[List[str]] = None,
    ) -> List[dict]:
        ids = list(dict.fromkeys([data_source_id] + [str(s) for s in (peer_source_ids or []) if s]))
        result = await self.auto_detect_project(data_source_id, ids)
        return result["relationships"]

    async def auto_detect_project(
        self,
        host_data_source_id: str,
        source_ids: List[str],
    ) -> Dict[str, Any]:
        """Run within-source detect on every source, then cross-source links owned by host."""
        ordered = list(dict.fromkeys([host_data_source_id] + [s for s in source_ids if s]))
        counts: Dict[str, int] = {}
        for sid in ordered:
            before = await self.list_relationships(sid)
            before_keys = {
                (r["from_table"], r["from_column"], r["to_table"], r["to_column"]) for r in before
            }
            ds = await self.get_data_source(sid)
            if not ds:
                counts[sid] = 0
                continue
            within = _detect_relationship_candidates(_detection_schema(ds))
            added = await self._persist_detected(sid, within, existing_keys=set(before_keys))
            counts[sid] = added

        peers = [s for s in ordered if s != host_data_source_id]
        sources_for_cross: List[Tuple[str, Any]] = []
        for sid in ordered:
            ds = await self.get_data_source(sid)
            if ds and isinstance(ds.schema, dict):
                sources_for_cross.append((sid, _detection_schema(ds)))
        cross_added = 0
        if len(sources_for_cross) > 1:
            cross = _detect_cross_source_candidates(sources_for_cross)
            for item in cross:
                item["data_source_id"] = item.get("data_source_id") or host_data_source_id
            host_existing = await self.list_relationships(host_data_source_id)
            host_keys = {
                (r["from_table"], r["from_column"], r["to_table"], r["to_column"]) for r in host_existing
            }
            cross_added = await self._persist_detected(host_data_source_id, cross, existing_keys=host_keys)
            counts[host_data_source_id] = counts.get(host_data_source_id, 0) + cross_added

        await self.db.commit()
        total = sum(counts.values())
        return {"counts": counts, "total_added": total, "relationships": await self.list_relationships(host_data_source_id)}
