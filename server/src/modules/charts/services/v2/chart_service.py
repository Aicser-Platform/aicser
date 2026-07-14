"""
Enhanced Chart Service with comprehensive Group By and Sorting functionality.

This service supports:

AGGREGATION:
- count: COUNT(*) - count records
- sum: SUM(field) - sum numeric field values  
- avg: AVG(field) - average of numeric field values
- max: MAX(field) - maximum field value
- min: MIN(field) - minimum field value

GROUPING:
- x (xField): Primary grouping field (required)
- groupField: Secondary grouping field (optional)

SORTING:
- sortBy: 'x' (field values), 'y' (aggregated values), 'record_order' (original)
- sortOrder: 'asc' (ascending), 'desc' (descending)
- groupSortBy: 'field' (by group field), 'order' (keep current order)
- groupOrder: 'asc' (ascending), 'desc' (descending)

EXAMPLES:
1. Count by region, sorted by region name ascending:
   { x: 'region', aggregate: 'count', sortBy: 'x', sortOrder: 'asc' }

2. Sum sales by region, sorted by total sales descending:
   { x: 'region', aggregate: 'sum', yMetric: 'sales', sortBy: 'y', sortOrder: 'desc' }

3. Multi-level grouping with sorting:
   { x: 'region', groupField: 'product', aggregate: 'sum', yMetric: 'amount', 
     sortBy: 'y', sortOrder: 'desc', groupSortBy: 'field', groupOrder: 'asc' }
"""

import uuid
import json
import hashlib
import os
import logging
import re
from typing import List, Optional, Dict, Any

logger = logging.getLogger(__name__)

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.charts.models import Chart
from src.modules.data.models import DataModelRelationship, DataSource
from src.modules.data.services.multi_engine_query_service import get_multi_engine_query_service


class ChartService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def _sample_duckdb_file_available() -> bool:
        from src.shared.sample_data.generate_duckdb import resolve_sample_duckdb_path

        return resolve_sample_duckdb_path() is not None

    # =========================================================
    # CRUD
    # =========================================================
    async def create(self, data: dict, commit: bool = True) -> Chart:
        chart = Chart(**data)
        self.db.add(chart)
        await self.db.flush()
        await self.db.refresh(chart)
        if commit:
            await self.db.commit()
        return chart

    async def get(self, chart_id: uuid.UUID) -> Optional[Chart]:
        if not isinstance(chart_id, uuid.UUID):
            chart_id = uuid.UUID(str(chart_id))
        stmt = select(Chart).where(Chart.id == chart_id)
        res = await self.db.execute(stmt)
        return res.scalar_one_or_none()

    async def list(self) -> List[Chart]:
        stmt = select(Chart)
        res = await self.db.execute(stmt)
        return res.scalars().all()

    async def update(self, chart: Chart, data: dict) -> Chart:
        for key, value in data.items():
            if hasattr(chart, key) and value is not None:
                setattr(chart, key, value)
        await self.db.flush()
        await self.db.refresh(chart)
        return chart

    async def delete(self, chart: Chart) -> None:
        await self.db.delete(chart)
        await self.db.flush()
        await self.db.commit()

    async def list_by_user_id_and_project_id(self, user_id: uuid.UUID, project_id: uuid.UUID) -> List[Chart]:
        if not isinstance(user_id, uuid.UUID):
            user_id = uuid.UUID(str(user_id))
        if not isinstance(project_id, uuid.UUID):
            project_id = uuid.UUID(str(project_id))
        stmt = select(Chart).where(Chart.user_id == user_id, Chart.project_id == project_id)
        res = await self.db.execute(stmt)
        return res.scalars().all()

    async def list_by_user_id(self, user_id: uuid.UUID) -> List[Chart]:
        if not isinstance(user_id, uuid.UUID):
            user_id = uuid.UUID(str(user_id))
        stmt = select(Chart).where(Chart.user_id == user_id, Chart.project_id.is_(None))
        res = await self.db.execute(stmt)
        return res.scalars().all()

    async def list_by_project_id(self, project_id: uuid.UUID) -> List[Chart]:
        """EE: list all standalone charts in a project (project-scoped, shared across members)."""
        if not isinstance(project_id, uuid.UUID):
            project_id = uuid.UUID(str(project_id))
        stmt = select(Chart).where(Chart.project_id == project_id)
        res = await self.db.execute(stmt)
        return res.scalars().all()

    def _resolve_table_and_schema(self, schema_info: Any) -> tuple[Optional[str], str]:
        """Resolves (table, schema) from schema_info, supporting various formats."""
        if not schema_info:
            return None, "public"

        schema_info = self._schema_dict(schema_info)
        
        if not isinstance(schema_info, dict):
            return None, "public"
        
        # 1. Direct 'table' and 'schema' keys
        table = schema_info.get("table")
        schema = schema_info.get("schema", "public")
        if table:
            return table, schema
            
        # 2. 'tables' list
        tables = schema_info.get("tables")
        if isinstance(tables, list) and len(tables) > 0:
            target = tables[0]
            for t in tables:
                if t.get("active") or t.get("is_active"):
                    target = t
                    break
            return target.get("name"), target.get("schema") or schema_info.get("schema") or "public"
            
        return None, "public"

    def _schema_dict(self, schema_info: Any) -> Dict[str, Any]:
        if isinstance(schema_info, dict):
            return schema_info
        if isinstance(schema_info, str):
            try:
                parsed = json.loads(schema_info)
                return parsed if isinstance(parsed, dict) else {}
            except Exception:
                return {}
        return {}

    def _resolve_table_from_chart(self, chart_query: Optional[Dict], schema_info: Any) -> tuple[Optional[str], str]:
        """Prefer explicit chart_query.tableName over schema default table."""
        cq = chart_query or {}
        explicit = cq.get("tableName")
        if explicit and isinstance(explicit, str) and explicit.strip():
            raw = explicit.strip().strip('"')
            if "." in raw:
                schema_part, table_part = raw.split(".", 1)
                return self._canonical_schema_table_name(table_part.strip(), schema_info), schema_part.strip() or "public"
            return self._canonical_schema_table_name(raw, schema_info), "public"
        return self._resolve_table_and_schema(schema_info)

    def _is_valid_table_reference(self, ref: str) -> bool:
        if not ref or not isinstance(ref, str):
            return False
        return bool(re.match(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$", ref.strip()))

    def _table_alias_from_ref(self, ref: str) -> str:
        return ref.strip().split(".")[-1]

    def _quote_table_reference(self, ref: str) -> str:
        """Quote schema/table references for SQL engines such as PostgreSQL.

        PostgreSQL folds unquoted mixed-case identifiers to lower case. A source
        table named "QuizAttempt" must therefore be emitted as
        "public"."QuizAttempt", not public.QuizAttempt.
        """
        clean_ref = str(ref or "").strip()
        if not self._is_valid_table_reference(clean_ref):
            raise ValueError(f"Invalid table reference: {ref}")
        return self._quote_identifier(clean_ref)

    def _quote_table_alias(self, alias: str) -> str:
        clean_alias = str(alias or "").strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", clean_alias):
            raise ValueError(f"Invalid table alias: {alias}")
        return self._quote_identifier(clean_alias)

    def _format_table_reference(self, ref: str, alias: Optional[str] = None) -> str:
        clean_ref = str(ref or "").strip()
        if not self._is_valid_table_reference(clean_ref):
            raise ValueError(f"Invalid table reference: {ref}")
        clean_alias = str(alias or self._table_alias_from_ref(clean_ref)).strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", clean_alias):
            clean_alias = self._table_alias_from_ref(clean_ref)
        quoted_ref = self._quote_table_reference(clean_ref)
        return f"{quoted_ref} AS {self._quote_table_alias(clean_alias)}" if clean_alias else quoted_ref

    def _build_from_clause(self, base_table: str, joins: Optional[List[Dict]]) -> str:
        if not joins:
            return self._format_table_reference(base_table)
        clause = self._format_table_reference(base_table)
        for join in joins:
            if not isinstance(join, dict):
                continue
            join_table = join.get("table") or join.get("alias")
            if not join_table:
                continue
            if not self._is_valid_table_reference(str(join_table)):
                continue
            join_type = str(join.get("type") or "LEFT").upper()
            if join_type not in ("LEFT", "RIGHT", "INNER", "FULL", "OUTER"):
                join_type = "LEFT"
            on = join.get("on")
            if isinstance(on, dict):
                left = on.get("left")
                right = on.get("right")
                if not left or not right:
                    continue
                if not self._is_valid_field_name(left) or not self._is_valid_field_name(right):
                    continue
                on_sql = f"{self._quote_identifier(left)} = {self._quote_identifier(right)}"
            elif isinstance(on, str) and on.strip():
                on_sql = on.strip()
            else:
                continue
            join_alias = join.get("alias") or self._table_alias_from_ref(str(join_table))
            clause += f" {join_type} JOIN {self._format_table_reference(str(join_table), str(join_alias))} ON {on_sql}"
        return clause

    def _quote_known_table_refs_in_sql(self, sql: str, schema_info: Any) -> str:
        """Quote known schema table references in saved/template SQL.

        Older generated widgets may have persisted SQL such as
        ``FROM public.QuizAttempt``. Normalize those references before execution
        so existing dashboards keep working after schema introspection discovers
        mixed-case PostgreSQL tables.
        """
        schema_info = self._schema_dict(schema_info)
        if not sql or not schema_info:
            return sql
        tables = schema_info.get("tables") or []
        if not isinstance(tables, list):
            return sql

        normalized = sql
        refs: List[tuple[str, str]] = []
        for table in tables:
            if not isinstance(table, dict):
                continue
            name = str(table.get("name") or "").strip()
            schema = str(table.get("schema") or schema_info.get("schema") or "public").strip()
            if not name:
                continue
            if self._is_valid_table_reference(name):
                refs.append((name, self._quote_table_reference(name)))
            if schema and self._is_valid_table_reference(f"{schema}.{name}"):
                refs.append((f"{schema}.{name}", self._quote_table_reference(f"{schema}.{name}")))

        for raw_ref, quoted_ref in sorted(refs, key=lambda item: len(item[0]), reverse=True):
            pattern = re.compile(
                rf'(?i)\b(FROM|JOIN)\s+({re.escape(raw_ref)})(?=\s|$)',
            )
            normalized = pattern.sub(lambda m: f"{m.group(1)} {quoted_ref}", normalized)
        return normalized

    def _unquote_sql_identifier_ref(self, ref: str) -> str:
        parts = [part.strip().strip('"').strip("`") for part in str(ref or "").split(".")]
        return ".".join(part for part in parts if part)

    def _base_table_schema_name(self, schema_info: Any, table_name: str) -> str:
        schema_info = self._schema_dict(schema_info)
        wanted = self._bare_table_name(table_name).lower()
        for table in schema_info.get("tables") or []:
            if not isinstance(table, dict) or not table.get("name"):
                continue
            if self._bare_table_name(table.get("name")).lower() == wanted:
                return str(table.get("schema") or schema_info.get("schema") or "public")
        return str(schema_info.get("schema") or "public")

    def _rewrite_sql_fk_display_labels(self, sql: str, schema_info: Any) -> str:
        """Rewrite simple saved/compiled SQL FK groupings to friendly labels.

        Example:
          SELECT "userId", SUM(...) FROM "QuizAttempt" GROUP BY "userId"
        becomes a LEFT JOIN to "User" and selects User.name as x.
        """
        if not sql:
            return sql
        select_match = re.match(r'(?is)^\s*SELECT\s+((?:"[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*))\s*,', sql)
        from_match = re.search(
            r'(?is)\bFROM\s+((?:"[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_]*))?)',
            sql,
        )
        if not select_match or not from_match:
            return sql

        raw_x = select_match.group(1)
        raw_base_ref = from_match.group(1)
        x_column = self._unquote_sql_identifier_ref(raw_x).split(".")[-1]
        base_table = self._bare_table_name(self._unquote_sql_identifier_ref(raw_base_ref))
        if not x_column or not base_table:
            return sql

        inferred = self._infer_fk_display_dimension(schema_info, base_table, x_column, [])
        if not inferred or not inferred.get("join"):
            return sql

        join = inferred["join"]
        on = join.get("on") if isinstance(join, dict) else None
        if not isinstance(on, dict):
            return sql

        base_schema = self._base_table_schema_name(schema_info, base_table)
        from_sql = self._format_table_reference(f"{base_schema}.{base_table}", base_table)
        join_sql = self._format_table_reference(str(join["table"]), str(join.get("alias") or join["table"]))
        on_sql = f"{self._quote_identifier(on['left'])} = {self._quote_identifier(on['right'])}"
        rewritten = sql[:from_match.start()] + f"FROM {from_sql} LEFT JOIN {join_sql} ON {on_sql}" + sql[from_match.end():]

        rewritten = re.sub(
            rf'(?is)^(\s*SELECT\s+){re.escape(raw_x)}(\s*,)',
            lambda m: f"{m.group(1)}{inferred['expression']} AS x{m.group(2)}",
            rewritten,
            count=1,
        )
        group_pattern = re.compile(rf'(?is)\bGROUP\s+BY\s+{re.escape(raw_x)}(?=\s+(ORDER\s+BY|LIMIT)\b|\s*$)')
        rewritten = group_pattern.sub(f"GROUP BY {inferred['expression']}", rewritten, count=1)
        return rewritten

    def _bare_table_name(self, table: Optional[str]) -> str:
        if not table:
            return ""
        return str(table).split(".")[-1].strip()

    @staticmethod
    def _logical_table_name(table: Optional[str]) -> str:
        bare = str(table or "").split(".")[-1].strip().lower()
        return re.sub(r"^sheet_\d+_", "", bare)

    def _schema_table_alias_map(self, schema_info: Any) -> Dict[str, str]:
        schema_info = self._schema_dict(schema_info)
        """Map logical/short table aliases to physical schema table names.

        Uploaded workbook sheets are stored as physical tables such as
        ``sheet_0_dim_campaign``. Semantic hints and LLM output often refer to
        the logical table name ``dim_campaign``. Canonicalizing that here keeps
        chart execution single-table when the selected sheet already contains
        the field, instead of requiring a nonexistent modeled relationship.
        """
        tables = schema_info.get("tables") if isinstance(schema_info, dict) else []
        aliases: Dict[str, str] = {}
        if not isinstance(tables, list):
            return aliases
        for table in tables:
            if not isinstance(table, dict) or not table.get("name"):
                continue
            physical = self._bare_table_name(table.get("name"))
            if not physical:
                continue
            physical_lower = physical.lower()
            aliases.setdefault(physical_lower, physical)
            aliases.setdefault(self._logical_table_name(physical), physical)
        return aliases

    def _canonical_schema_table_name(self, table: Optional[str], schema_info: Any) -> str:
        bare = self._bare_table_name(table)
        if not bare:
            return ""
        aliases = self._schema_table_alias_map(schema_info)
        return aliases.get(bare.lower()) or aliases.get(self._logical_table_name(bare)) or bare

    def _schema_column_table_map(self, schema_info: Any) -> Dict[str, List[str]]:
        schema_info = self._schema_dict(schema_info)
        tables = schema_info.get("tables") if isinstance(schema_info, dict) else []
        column_tables: Dict[str, List[str]] = {}
        if not isinstance(tables, list):
            return column_tables
        for table in tables:
            if not isinstance(table, dict) or not table.get("name"):
                continue
            table_name = self._bare_table_name(table.get("name"))
            for col in table.get("columns") or []:
                col_name = col.get("name") if isinstance(col, dict) else col
                if not col_name:
                    continue
                column_tables.setdefault(str(col_name).lower(), []).append(table_name)
        return column_tables

    def _schema_table_columns_map(self, schema_info: Any) -> Dict[str, List[str]]:
        schema_info = self._schema_dict(schema_info)
        tables = schema_info.get("tables") if isinstance(schema_info, dict) else []
        table_columns: Dict[str, List[str]] = {}
        if not isinstance(tables, list):
            return table_columns
        for table in tables:
            if not isinstance(table, dict) or not table.get("name"):
                continue
            table_name = self._bare_table_name(table.get("name"))
            columns: List[str] = []
            for col in table.get("columns") or []:
                col_name = col.get("name") if isinstance(col, dict) else col
                if col_name:
                    columns.append(str(col_name))
            table_columns[table_name] = columns
        return table_columns

    def _schema_column_type_map(self, schema_info: Any) -> Dict[str, Dict[str, str]]:
        """table -> {column_lower: normalized_type_family}."""
        schema_info = self._schema_dict(schema_info)
        tables = schema_info.get("tables") if isinstance(schema_info, dict) else []
        type_map: Dict[str, Dict[str, str]] = {}
        if not isinstance(tables, list):
            return type_map
        for table in tables:
            if not isinstance(table, dict) or not table.get("name"):
                continue
            table_name = self._bare_table_name(table.get("name"))
            cols: Dict[str, str] = {}
            for col in table.get("columns") or []:
                if not isinstance(col, dict) or not col.get("name"):
                    continue
                cols[str(col["name"]).lower()] = self._type_family(col.get("type"))
            type_map[table_name] = cols
        return type_map

    @staticmethod
    def _type_family(raw_type: Any) -> str:
        t = str(raw_type or "").upper()
        if any(k in t for k in ("INT", "DECIMAL", "NUMERIC", "DOUBLE", "FLOAT", "REAL", "NUMBER")):
            return "number"
        if any(k in t for k in ("DATE", "TIME")):
            return "date"
        if "BOOL" in t:
            return "bool"
        if any(k in t for k in ("CHAR", "TEXT", "STRING", "UUID")):
            return "text"
        return "unknown"

    def _schema_tables_by_bare_name(self, schema_info: Any) -> Dict[str, Dict[str, Any]]:
        schema_info = self._schema_dict(schema_info)
        tables = schema_info.get("tables") if isinstance(schema_info, dict) else []
        by_name: Dict[str, Dict[str, Any]] = {}
        if not isinstance(tables, list):
            return by_name
        for table in tables:
            if not isinstance(table, dict) or not table.get("name"):
                continue
            by_name[self._bare_table_name(table.get("name")).lower()] = table
        return by_name

    def _schema_column_names_for_table(self, table: Dict[str, Any]) -> Dict[str, str]:
        names: Dict[str, str] = {}
        for col in table.get("columns") or []:
            name = col.get("name") if isinstance(col, dict) else col
            if name:
                names[str(name).lower()] = str(name)
        return names

    def _fk_root_from_column(self, column: str) -> str:
        name = str(column or "").strip()
        lower = name.lower()
        if lower.endswith("_id"):
            return name[:-3]
        if lower.endswith("id") and len(name) > 2:
            return name[:-2]
        if lower.endswith("_key"):
            return name[:-4]
        if lower.endswith("key") and len(name) > 3:
            return name[:-3]
        return ""

    def _choose_display_column(self, target_table: Dict[str, Any]) -> Optional[str]:
        columns = self._schema_column_names_for_table(target_table)
        priority = [
            "name",
            "title",
            "displayname",
            "display_name",
            "fullname",
            "full_name",
            "username",
            "email",
            "label",
            "code",
            "slug",
        ]
        for candidate in priority:
            if candidate in columns:
                return columns[candidate]
        for lower_name, original in columns.items():
            if lower_name == "id" or lower_name.endswith(("id", "_id", "key", "_key")):
                continue
            return original
        return None

    def _infer_fk_display_dimension(
        self,
        schema_info: Any,
        base_table: str,
        x_field: Optional[str],
        joins: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        """Use related table labels for FK dimensions, e.g. userId -> User.name."""
        if not x_field or not isinstance(x_field, str):
            return None
        parts = [part.strip() for part in str(x_field).split(".") if part.strip()]
        column = parts[-1] if parts else ""
        explicit_table = self._bare_table_name(parts[-2]) if len(parts) >= 2 else ""
        if explicit_table and explicit_table.lower() != base_table.lower():
            return None
        root = self._fk_root_from_column(column)
        if not root:
            return None

        tables = self._schema_tables_by_bare_name(schema_info)
        target_table: Optional[Dict[str, Any]] = None
        target_name = ""
        root_lower = root.lower()
        candidates = [
            root_lower,
            f"{root_lower}s",
            root_lower.rstrip("s"),
        ]
        for candidate in candidates:
            if candidate in tables:
                target_table = tables[candidate]
                target_name = self._bare_table_name(target_table.get("name"))
                break
        if not target_table or not target_name:
            return None

        target_columns = self._schema_column_names_for_table(target_table)
        target_id = target_columns.get("id")
        display_col = self._choose_display_column(target_table)
        if not target_id or not display_col:
            return None

        type_map = self._schema_column_type_map(schema_info)
        if not self._join_columns_compatible(type_map, base_table, column, target_name, target_id):
            return None

        joined = {
            self._bare_table_name(j.get("alias") or j.get("table")).lower()
            for j in joins
            if isinstance(j, dict)
        }
        join: Optional[Dict[str, Any]] = None
        if target_name.lower() not in joined:
            schema_name = str(target_table.get("schema") or schema_info.get("schema") or "public").strip()
            table_ref = f"{schema_name}.{target_name}" if schema_name else target_name
            join = {
                "table": table_ref,
                "alias": target_name,
                "type": "LEFT",
                "modelJoin": True,
                "inferredDisplayJoin": True,
                "on": {
                    "left": f"{base_table}.{column}",
                    "right": f"{target_name}.{target_id}",
                },
            }

        display_sql = self._quote_identifier(f"{target_name}.{display_col}")
        fk_sql = self._quote_identifier(f"{base_table}.{column}")
        # Fall back to the raw FK only when the label is blank/null. Existing
        # dashboards still show all categories even if a dimension row is missing.
        expression = f"COALESCE(NULLIF({display_sql}, ''), {fk_sql})"
        return {
            "join": join,
            "expression": expression,
            "target_table": target_name,
            "display_column": display_col,
        }

    def _join_columns_compatible(
        self,
        type_map: Dict[str, Dict[str, str]],
        left_table: str,
        left_col: str,
        right_table: str,
        right_col: str,
    ) -> bool:
        """A join is only sound when both sides share a comparable type family.

        Unknown/missing types are treated as compatible so we never reject a join
        just because the schema lacks type metadata — we only skip clear
        mismatches (e.g. INT date_id joined to a TEXT order_id)."""
        left = (type_map.get(left_table) or {}).get(left_col.lower())
        right = (type_map.get(right_table) or {}).get(right_col.lower())
        if not left or not right or "unknown" in (left, right):
            return True
        return left == right

    def _infer_join_from_schema(self, schema_info: Any, base_table: str, target_table: str) -> Optional[Dict[str, Any]]:
        table_columns = self._schema_table_columns_map(schema_info)
        base_columns = table_columns.get(base_table) or []
        target_columns = table_columns.get(target_table) or []
        if not base_columns or not target_columns:
            return None

        base_by_lower = {c.lower(): c for c in base_columns}
        target_by_lower = {c.lower(): c for c in target_columns}
        common = set(base_by_lower).intersection(target_by_lower)

        target_root = target_table
        if target_root.startswith("dim_"):
            target_root = target_root[4:]
        preferred = [
            f"{target_root}_id",
            "id",
            f"{target_table}_id",
        ]
        preferred.extend(sorted(c for c in common if c.endswith("_id")))
        preferred.extend(sorted(common))

        for candidate in preferred:
            key = candidate.lower()
            if key in common:
                base_column = base_by_lower[key]
                target_column = target_by_lower[key]
                return {
                    "table": target_table,
                    "alias": target_table,
                    "type": "LEFT",
                    "on": {
                        "left": f"{base_table}.{base_column}",
                        "right": f"{target_table}.{target_column}",
                    },
                }
        return None

    def _field_ref_parts(self, value: Any) -> tuple[str, str]:
        if not isinstance(value, str):
            return "", ""
        parts = [p.strip().lower() for p in value.split(".") if p.strip()]
        if len(parts) < 2:
            return "", parts[-1] if parts else ""
        return self._bare_table_name(parts[-2]), parts[-1]

    def _join_matches_relationship(self, join: Dict[str, Any], rel: DataModelRelationship) -> bool:
        if not isinstance(join, dict):
            return False

        join_rel_id = join.get("relationshipId") or join.get("relationship_id")
        if join_rel_id and str(join_rel_id) == str(rel.id):
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
            self._bare_table_name(rel.from_table).lower(),
            str(rel.from_column).strip().lower(),
        )
        to_ref = (
            self._bare_table_name(rel.to_table).lower(),
            str(rel.to_column).strip().lower(),
        )
        return (left_ref == from_ref and right_ref == to_ref) or (
            left_ref == to_ref and right_ref == from_ref
        )

    def _relationship_for_join(
        self,
        join: Dict[str, Any],
        relationships: List[DataModelRelationship],
    ) -> Optional[DataModelRelationship]:
        for rel in relationships:
            if self._join_matches_relationship(join, rel):
                return rel
        return None

    def _missing_relationship_error(self, base_table: str, target_tables: set[str]) -> ValueError:
        tables = ", ".join(sorted(target_tables))
        return ValueError(
            "Missing active data model relationship for chart query. "
            f"Create or activate a relationship from {base_table} to {tables}."
        )

    def _field_table(
        self,
        field: Optional[str],
        base_table: str,
        column_tables: Dict[str, List[str]],
        table_aliases: Optional[Dict[str, str]] = None,
    ) -> Optional[str]:
        if not field or not isinstance(field, str):
            return None
        clean = field.strip()
        if "." in clean:
            explicit = self._bare_table_name(clean.rsplit(".", 1)[0])
            return (table_aliases or {}).get(explicit.lower()) or explicit
        candidates = column_tables.get(clean.lower()) or []
        if base_table in candidates:
            return base_table
        return candidates[0] if candidates else None

    def _qualify_field(self, field: Optional[str], table: Optional[str]) -> Optional[str]:
        if not field or not table:
            return field
        if "." in str(field):
            return f"{self._bare_table_name(table)}.{str(field).rsplit('.', 1)[-1].strip()}"
        return f"{self._bare_table_name(table)}.{field}"

    async def _apply_modeled_joins_to_chart_query(
        self,
        data_source: DataSource,
        chart_query: Dict[str, Any],
        x_field: Optional[str],
        y_metric: Optional[str],
        y_metrics: Optional[List[Dict[str, Any]]],
        y_metrics_secondary: Optional[List[Dict[str, Any]]],
        group_field: Optional[str],
        filters: Optional[List[Dict[str, Any]]] = None,
    ) -> tuple[Dict[str, Any], Optional[str], Optional[str], Optional[List[Dict[str, Any]]], Optional[List[Dict[str, Any]]], Optional[str]]:
        """Apply active modeled joins and qualify fields for multi-table charts."""
        schema_info = data_source.schema or {}
        table, _schema = self._resolve_table_from_chart(chart_query, schema_info)
        base_table = self._bare_table_name(table)
        if not base_table:
            return chart_query, x_field, y_metric, y_metrics, y_metrics_secondary, group_field

        column_tables = self._schema_column_table_map(schema_info)
        if not column_tables:
            return chart_query, x_field, y_metric, y_metrics, y_metrics_secondary, group_field
        table_aliases = self._schema_table_alias_map(schema_info)

        needed_tables: set[str] = set()

        def qualify_plain_field(field: Optional[str]) -> Optional[str]:
            table_name = self._field_table(field, base_table, column_tables, table_aliases)
            if table_name and table_name != base_table:
                needed_tables.add(table_name)
            return self._qualify_field(field, table_name)

        next_query = dict(chart_query)
        next_x = qualify_plain_field(x_field)
        next_y_metric = qualify_plain_field(y_metric)
        next_group_field = qualify_plain_field(group_field)

        def qualify_metrics(metrics: Optional[List[Dict[str, Any]]]) -> Optional[List[Dict[str, Any]]]:
            if metrics is None:
                return None
            next_metrics: List[Dict[str, Any]] = []
            for metric in metrics:
                if not isinstance(metric, dict):
                    next_metrics.append(metric)
                    continue
                next_metric = dict(metric)
                field = next_metric.get("field")
                if field:
                    next_metric["field"] = qualify_plain_field(field)
                next_metrics.append(next_metric)
            return next_metrics

        next_y_metrics = qualify_metrics(y_metrics)
        next_y_metrics_secondary = qualify_metrics(y_metrics_secondary)

        next_filters: Optional[List[Dict[str, Any]]] = None
        if filters is not None:
            next_filters = []
            for flt in filters:
                if not isinstance(flt, dict):
                    next_filters.append(flt)
                    continue
                next_filter = dict(flt)
                field = next_filter.get("field")
                if field:
                    next_filter["field"] = qualify_plain_field(field)
                next_filters.append(next_filter)

        rel_result = await self.db.execute(
            select(DataModelRelationship).where(
                DataModelRelationship.data_source_id == str(data_source.id),
                DataModelRelationship.is_active == True,  # noqa: E712
            )
        )
        relationships = list(rel_result.scalars().all())
        type_map = self._schema_column_type_map(schema_info)

        existing_joins = next_query.get("joins") if isinstance(next_query.get("joins"), list) else []
        joins: List[Dict[str, Any]] = []
        for join in existing_joins:
            if not isinstance(join, dict):
                continue
            rel = self._relationship_for_join(join, relationships)
            if not rel:
                continue
            joins.append({
                **join,
                "relationshipId": str(rel.id),
                "modelJoin": True,
            })

        joined_tables = {self._bare_table_name(j.get("table")) for j in joins if isinstance(j, dict)}
        missing_tables = {t for t in needed_tables if t and t != base_table and t not in joined_tables}

        if missing_tables:
            for target_table in sorted(missing_tables):
                join_added = False
                for rel in relationships:
                    from_table = self._bare_table_name(rel.from_table)
                    to_table = self._bare_table_name(rel.to_table)
                    connects = (from_table == base_table and to_table == target_table) or (
                        to_table == base_table and from_table == target_table
                    )
                    if not connects:
                        continue
                    # Skip relationships whose columns have incompatible types — a
                    # mis-modeled join (e.g. INT date_id = TEXT order_id) would make
                    # the entire DuckDB query fail with a conversion error.
                    if not self._join_columns_compatible(
                        type_map, from_table, rel.from_column, to_table, rel.to_column
                    ):
                        logger.warning(
                            "Skipping incompatible modeled join %s.%s = %s.%s (type mismatch)",
                            from_table, rel.from_column, to_table, rel.to_column,
                        )
                        continue
                    joined = to_table if from_table == base_table else from_table
                    joins.append({
                        "table": joined,
                        "alias": joined,
                        "type": (rel.join_type or "LEFT").upper(),
                        "relationshipId": str(rel.id),
                        "modelJoin": True,
                        "on": {
                            "left": f"{from_table}.{rel.from_column}",
                            "right": f"{to_table}.{rel.to_column}",
                        },
                    })
                    join_added = True
                    break
                if not join_added:
                    raise self._missing_relationship_error(base_table, {target_table})

        next_query["joins"] = joins
        if next_x:
            next_query["x"] = next_x
        if next_y_metric:
            next_query["yMetric"] = next_y_metric
        if next_group_field:
            next_query["groupField"] = next_group_field
        if next_y_metrics is not None:
            next_query["yMetrics"] = next_y_metrics
        if next_y_metrics_secondary is not None:
            next_query["yMetricsSecondary"] = next_y_metrics_secondary
        if next_filters is not None:
            next_query["filters"] = next_filters

        return next_query, next_x, next_y_metric, next_y_metrics, next_y_metrics_secondary, next_group_field

    async def _load_saved_query_sql(self, saved_query_id: str) -> Optional[str]:
        try:
            qid = uuid.UUID(str(saved_query_id))
        except (ValueError, TypeError):
            return None
        res = await self.db.execute(
            text("SELECT sql FROM saved_queries WHERE id = :id LIMIT 1"),
            {"id": str(qid)},
        )
        row = res.first()
        if not row:
            return None
        sql = row[0] if isinstance(row, tuple) else row.sql
        return str(sql).strip() if sql else None

    async def _ensure_data_source_schema(self, data_source: DataSource) -> None:
        """Lazily fetch schema for types that might not have it pre-populated (database, sample_duckdb, google_sheets)."""
        # If schema already exists and has tables, we're good
        if data_source.schema:
            try:
                schema_info = data_source.schema
                if isinstance(schema_info, str):
                    schema_info = json.loads(schema_info)
                
                if isinstance(schema_info, dict) and schema_info.get("tables"):
                    return
            except:
                pass

        # If it's a file, it should already have it.
        if data_source.type not in ("database", "warehouse", "sample_duckdb", "google_sheets"):
            return

        try:
            from src.modules.data.services.data_connectivity_service import DataConnectivityService
            ds_service = DataConnectivityService()
            
            # Simple dict for schema fetching methods
            ds_dict = {
                "id": str(data_source.id),
                "type": data_source.type,
                "db_type": data_source.db_type,
                "format": data_source.format,
                "connection_config": data_source.connection_config,
            }

            schema_result = None
            if data_source.type == "sample_duckdb":
                schema_result = await ds_service.get_sample_duckdb_schema(ds_dict)
            elif data_source.type == "google_sheets":
                schema_result = await ds_service.get_google_sheets_schema(ds_dict)
            elif data_source.type in ("database", "warehouse"):
                schema_result = await ds_service.get_database_schema(str(data_source.id))

            if schema_result and schema_result.get("success") and schema_result.get("schema"):
                data_source.schema = schema_result["schema"]
                # Save back to DB for future use
                try:
                    self.db.add(data_source)
                    await self.db.commit()
                except Exception as save_err:
                    pass
        except Exception as e:
            pass
    # =========================================================
    # EXECUTE CHART (DB OR FILE)
    # =========================================================
    async def execute(self, chart: Chart) -> Dict[str, Any]:
        if chart.chart_type == 'text':
            return {"x": [], "y": [], "series": []}

        from src.modules.data.services.semantic_context_service import resolve_semantic_chart_query

        if chart.chart_query:
            chart.chart_query = await resolve_semantic_chart_query(self.db, dict(chart.chart_query))

        chart_query = chart.chart_query or {}
        compiled_sql = chart_query.get("compiled_semantic_sql")
        if compiled_sql and isinstance(compiled_sql, str) and compiled_sql.strip():
            return await self._execute_with_sample_sql(chart, compiled_sql)

        # Template charts store a pre-built JOIN query in chart_options.sample_sql.
        # Use it directly so JOINed fields (e.g. status_name) render correctly.
        chart_options = chart.chart_options or {}
        if isinstance(chart_options, str):
            try:
                chart_options = json.loads(chart_options)
            except Exception:
                chart_options = {}
        sample_sql = chart_options.get("sample_sql") if isinstance(chart_options, dict) else None
        if sample_sql and isinstance(sample_sql, str) and sample_sql.strip():
            return await self._execute_with_sample_sql(chart, sample_sql)

        chart_query = chart.chart_query or {}
        saved_query_id = chart_query.get("saved_query_id")
        if saved_query_id:
            saved_sql = await self._load_saved_query_sql(str(saved_query_id))
            if saved_sql:
                return await self._execute_with_sample_sql(chart, saved_sql)

        filters = chart_query.get("filters", [])
        metric_filters = chart_query.get("metricFilters", [])

        # -------------------------
        # 1. Normalize query
        # -------------------------
        x_field = chart_query.get("x") or chart_query.get("xField")
        x_grain = chart_query.get("xGrain") # date bucketing (year, month, day, etc)
        # x_field is optional now for multi-metric charts
            
        # Basic validation for field names (SQL injection protection)
        if x_field and not self._is_valid_field_name(x_field):
            raise ValueError(f"Invalid x_field name: {x_field}")

        aggregate = chart_query.get("aggregate")
        y_metric = chart_query.get("yMetric")  # Field to aggregate
        y_metrics = chart_query.get("yMetrics") # Array of {field, aggregation}
        has_y_metrics_defined = "yMetrics" in chart_query
        group_field = chart_query.get("groupField")  # Secondary grouping field
        
        # Validate additional field names
        if y_metric and not self._is_valid_field_name(y_metric):
            raise ValueError(f"Invalid yMetric field name: {y_metric}")
        if group_field and not self._is_valid_field_name(group_field):
            raise ValueError(f"Invalid groupField name: {group_field}")
        
        y_metrics_secondary = chart_query.get("yMetricsSecondary") or []
        
        for ym in (y_metrics or []):
            field = ym.get("field")
            if field and not self._is_valid_field_name(field):
                raise ValueError(f"Invalid yMetric field name: {field}")

        for ym in y_metrics_secondary:
            field = ym.get("field")
            if field and not self._is_valid_field_name(field):
                raise ValueError(f"Invalid yMetric field name: {field}")
            
        sort_by = self._normalize_sort_by(chart_query.get("sortBy"))
        sort_order = chart_query.get("sortOrder", "desc")  # Default to desc
        group_sort_by = chart_query.get("groupSortBy", "field")  # field or order
        group_order = chart_query.get("groupOrder", "desc")  # Default to desc
        limit = chart_query.get("limit")
        if limit is not None:
            try: 
                limit = int(limit)
                if limit < 1: limit = 1
            except: 
                limit = 5000
        else:
            limit = 5000

        series_limit = chart_query.get("seriesLimit")
        if series_limit is not None:
            try: series_limit = int(series_limit)
            except: series_limit = None
            
        y_metrics_list = (y_metrics or []) + y_metrics_secondary
        n_primary = len(y_metrics) if y_metrics is not None else 1
        order_clause = self._build_order_clause(sort_by, sort_order, x_field, has_y_metrics=len(y_metrics_list) > 0)

        # -------------------------
        # 3. Handle Scatter Chart
        # -------------------------
        if chart.chart_type == 'scatter':
            x_metrics = chart_query.get("xMetrics") or []
            y_metrics = chart_query.get("yMetrics") or []
            legend_field = chart_query.get("legend")

            # Fallback for old charts/migration
            if not x_metrics and chart_query.get("x"):
                x_metrics = [{"field": chart_query.get("x"), "aggregation": "none"}]
            if not y_metrics and chart_query.get("y"):
                y_metrics = [{"field": chart_query.get("y"), "aggregation": "none"}]

            # Validate field names
            for ym in x_metrics + y_metrics:
                f = ym.get("field")
                if f and not self._is_valid_field_name(f):
                    raise ValueError(f"Invalid field name: {f}")
            if legend_field and not self._is_valid_field_name(legend_field):
                raise ValueError(f"Invalid legend field name: {legend_field}")

            stmt = select(DataSource).where(DataSource.id == chart.data_source_id)
            res = await self.db.execute(stmt)
            data_source = res.scalar_one_or_none()

            if not data_source:
                raise ValueError("Data source not found")

            if data_source.type == "sample_duckdb" and not self._sample_duckdb_file_available():
                return self._sample_template_fallback_result(chart)

            # Lazily fetch schema for databases/sample_duckdb if missing
            await self._ensure_data_source_schema(data_source)

            if data_source.type == "file":
                return await self._execute_scatter_db(data_source, x_metrics, y_metrics, legend_field, filters=filters, metric_filters=metric_filters, limit=limit, series_limit=series_limit)
            else:
                try:
                    return await self._execute_scatter_db(data_source, x_metrics, y_metrics, legend_field, filters=filters, metric_filters=metric_filters, limit=limit, series_limit=series_limit)
                except Exception:
                    if data_source.type == "sample_duckdb":
                        return self._sample_template_fallback_result(chart)
                    raise

        # -------------------------
        # 4. Execute Standard Charts
        # -------------------------
        stmt = select(DataSource).where(DataSource.id == chart.data_source_id)
        res = await self.db.execute(stmt)
        data_source = res.scalar_one_or_none()

        if not data_source:
            raise ValueError("Data source not found")

        if data_source.type == "sample_duckdb" and not self._sample_duckdb_file_available():
            return self._sample_template_fallback_result(chart)

        # Lazily fetch schema for databases/sample_duckdb if missing
        await self._ensure_data_source_schema(data_source)

        chart_query, x_field, y_metric, y_metrics, y_metrics_secondary, group_field = (
            await self._apply_modeled_joins_to_chart_query(
                data_source,
                chart_query,
                x_field,
                None if y_metrics else y_metric,
                y_metrics,
                y_metrics_secondary,
                group_field,
                filters,
            )
        )
        filters = chart_query.get("filters", filters)
        y_metrics_list = (y_metrics or []) + (y_metrics_secondary or [])
        n_primary = len(y_metrics) if y_metrics is not None else 1
        order_clause = self._build_order_clause(
            sort_by,
            sort_order,
            x_field,
            has_y_metrics=len(y_metrics_list) > 0,
        )

        # File sources use MultiEngine (DuckDB) — same path as databases
        if data_source.type == "file":
            try:
                result = await self._execute_db_source(
                    data_source, x_field, aggregate, y_metric, y_metrics_list,
                    has_y_metrics_defined, group_field, order_clause,
                    n_primary=n_primary, x_grain=x_grain,
                    filters=filters, metric_filters=metric_filters,
                    limit=limit, series_limit=series_limit,
                    chart_query=chart_query,
                )
            except Exception as file_err:
                logger.warning("File MultiEngine chart path failed, falling back: %s", file_err)
                has_joined_query = bool(chart_query.get("joins"))
                fields_for_fallback_check = [
                    x_field,
                    y_metric,
                    group_field,
                    *[m.get("field") for m in (y_metrics_list or []) if isinstance(m, dict)],
                ]
                has_qualified_fields = any("." in str(field) for field in fields_for_fallback_check if field)
                if has_joined_query or has_qualified_fields:
                    raise ValueError(str(file_err)) from file_err
                result = self._execute_file_source(
                    data_source, x_field, aggregate, y_metric, y_metrics_list,
                    has_y_metrics_defined, group_field, sort_by, sort_order,
                    group_sort_by, group_order, n_primary=n_primary,
                    x_grain=x_grain, filters=filters,
                    metric_filters=metric_filters, limit=limit,
                    series_limit=series_limit,
                )
        else:
            try:
                result = await self._execute_db_source(
                    data_source, x_field, aggregate, y_metric, y_metrics_list,
                    has_y_metrics_defined, group_field, order_clause,
                    n_primary=n_primary, x_grain=x_grain,
                    filters=filters, metric_filters=metric_filters,
                    limit=limit,
                    series_limit=series_limit,
                    chart_query=chart_query,
                )
            except Exception:
                if data_source.type == "sample_duckdb":
                    return self._sample_template_fallback_result(chart)
                raise

        # Stat charts must return {"value": N}. Normalize if the execution path
        # returned the generic {"x": [...], "y": [...]} shape instead.
        # Preserve series/y for sparklines and period-over-period on KPI cards.
        if chart.chart_type == "stat" and "value" not in result:
            y_data = result.get("y") or []
            series = result.get("series") or []
            series_data = series[0].get("data") if series and isinstance(series[0], dict) else []
            val = None
            if y_data:
                val = y_data[-1]
            elif series_data:
                val = series_data[-1]
            if val is not None:
                normalized: Dict[str, Any] = {"value": val}
                if y_data:
                    normalized["y"] = y_data
                if series:
                    normalized["series"] = series
                if len(y_data) >= 2:
                    normalized["comparisonValue"] = y_data[-2]
                    normalized["comparisonLabel"] = "prior period"
                elif len(series_data) >= 2:
                    normalized["comparisonValue"] = series_data[-2]
                    normalized["comparisonLabel"] = "prior period"
                result = normalized

        return result

    # =========================================================
    # SCATTER EXECUTION
    # =========================================================
    async def _execute_scatter_db(self, data_source: DataSource, x_metrics: List[Dict], y_metrics: List[Dict], legend_field: Optional[str] = None, filters: List[Dict] = [], metric_filters: List[Dict] = [], limit: int = 5000, series_limit: Optional[int] = None) -> Dict[str, Any]:
        if not x_metrics or not y_metrics: return {"series": []}
        
        xm, ym = x_metrics[0], y_metrics[0]
        x_field, y_field = xm.get("field"), ym.get("field")
        x_agg, y_agg = xm.get("aggregation", "none"), ym.get("aggregation", "none")
        if not x_field or not y_field: return {"series": []}

        # Determine grouping and aggregation requirements
        is_x_agg, is_y_agg = x_agg != 'none', y_agg != 'none'
        is_fully_raw = not is_x_agg and not is_y_agg
        
        select_fields, group_by = [], []
        if legend_field:
            legend_sql = self._quote_identifier(legend_field)
            select_fields.append(f"{legend_sql} as legend")
            if not is_fully_raw:
                group_by.append(legend_sql)

        # X column/agg
        if is_x_agg:
            select_fields.append(f"{self._get_aggregate_func(x_agg, x_field)} as x")
        else:
            x_sql = self._quote_identifier(x_field)
            select_fields.append(f"{x_sql} as x")
            if not is_fully_raw:
                group_by.append(x_sql)

        # Y column/agg
        if is_y_agg:
            select_fields.append(f"{self._get_aggregate_func(y_agg, y_field)} as y")
        else:
            y_sql = self._quote_identifier(y_field)
            select_fields.append(f"{y_sql} as y")
            if not is_fully_raw:
                group_by.append(y_sql)

        schema_info = data_source.schema or {}
        table, schema = self._resolve_table_and_schema(schema_info)
        
        if not table:
            raise ValueError("Table name missing in data source schema")

        table_full_name = self._quote_table_reference(f"{schema}.{table}")
        where_clause = self._apply_filters_db(filters)
        having_clause = self._apply_metric_filters_db(metric_filters)
        group_by_clause = f"GROUP BY {', '.join(set(group_by))}" if group_by else ""
        sql = f"SELECT {', '.join(select_fields)} FROM {table_full_name} {where_clause} {group_by_clause} {having_clause} LIMIT {limit}"
        
        # USE MultiEngineQueryService for external databases
        ds_dict = {
            "id": data_source.id,
            "type": data_source.type,
            "db_type": data_source.db_type,
            "format": data_source.format,
            "schema": schema_info,
            "connection_config": data_source.connection_config,
            "project_id": str(data_source.project_id),
            "user_id": str(data_source.user_id) if data_source.user_id else None,
            "file_path": data_source.file_path,
        }

        sql = self._quote_known_table_refs_in_sql(sql, data_source.schema or {})
        multi = get_multi_engine_query_service()
        exec_res = await multi.execute_query(sql, ds_dict)

        if not exec_res.get("success"):
            raise Exception(f"Query execution failed: {exec_res.get('error')}")

        rows = exec_res.get("data", [])

        # Apply series limit if requested
        if legend_field and series_limit:
            series_sums = {}
            for r in rows:
                leg = r.get("legend")
                y = r.get("y", 0)
                try: y = float(y)
                except: y = 0
                series_sums[leg] = series_sums.get(leg, 0) + abs(y)
            
            top_legends = sorted(series_sums.keys(), key=lambda k: series_sums[k], reverse=True)[:series_limit]
            rows = [r for r in rows if r.get("legend") in top_legends]

        # Build efficient payload
        data = []
        for row in rows:
            # MultiEngineQueryService returns list of DICTs
            data.append([row.get("x"), row.get("y"), row.get("legend")])

        y_label = f"{y_agg.capitalize()} of {y_field}" if is_y_agg else y_field
        return {
            "series": [{"name": y_label, "data": data}],
            "xAxisLabel": f"{x_agg.capitalize()} of {x_field}" if is_x_agg else x_field,
            "yAxisLabel": y_label
        }

    def _execute_scatter_file(self, data_source: DataSource, x_metrics: List[Dict], y_metrics: List[Dict], legend_field: Optional[str] = None, filters: List[Dict] = [], metric_filters: List[Dict] = [], limit: int = 5000, series_limit: Optional[int] = None) -> Dict[str, Any]:
        if not data_source.sample_data or not x_metrics or not y_metrics: return {"series": []}
        
        xm, ym = x_metrics[0], y_metrics[0]
        x_field, y_field = xm.get("field"), ym.get("field")
        x_agg, y_agg = xm.get("aggregation", "none"), ym.get("aggregation", "none")
        
        import pandas as pd
        df = pd.DataFrame(json.loads(data_source.sample_data) if isinstance(data_source.sample_data, str) else data_source.sample_data)
        
        # Apply filters
        df = self._apply_filters_pandas(df, filters)
        
        # Clean numeric data before aggregation for scatter
        for m in x_metrics + y_metrics:
            f = m.get("field")
            if f and f in df.columns:
                df[f] = pd.to_numeric(df[f], errors='coerce').fillna(0)

        is_x_agg, is_y_agg = x_agg != 'none', y_agg != 'none'
        is_fully_raw = not is_x_agg and not is_y_agg
        
        # Clean numeric data
        for f in [x_field, y_field]: df[f] = pd.to_numeric(df[f], errors='coerce').fillna(0)

        if is_fully_raw:
            final_df = df
            # Map raw columns to standardized names for the data loop
            final_df = final_df.assign(x=final_df[x_field], y=final_df[y_field])
        else:
            agg_map = {'sum':'sum','avg':'mean','min':'min','max':'max','count':'count','distinct_count':'nunique','none':'first'}
            group_cols = list(set([legend_field] if legend_field and legend_field in df.columns else []))
            if not is_x_agg: group_cols.append(x_field)
            if not is_y_agg: group_cols.append(y_field)
            group_cols = list(set(group_cols))
            
            if group_cols:
                final_df = df.groupby(group_cols).agg(
                    x=pd.NamedAgg(column=x_field, aggfunc=agg_map.get(x_agg, 'first')),
                    y=pd.NamedAgg(column=y_field, aggfunc=agg_map.get(y_agg, 'first'))
                ).reset_index()
            else:
                # Global aggregation (Scenario 3 with no legend)
                # Compute aggregates and force into a DataFrame with consistent columns
                x_val = df[x_field].agg(agg_map.get(x_agg, 'sum'))
                y_val = df[y_field].agg(agg_map.get(y_agg, 'sum'))
                final_df = pd.DataFrame([{'x': x_val, 'y': y_val}])

        # Apply metric filters (HAVING)
        # In scatter, metrics are explicitly mapped to x and y aliases
        output_metrics_scatter = [
            {"alias": "x", "name": "X", "field": x_field, "aggregation": x_agg},
            {"alias": "y", "name": "Y", "field": y_field, "aggregation": y_agg}
        ]
        final_df = self._apply_metric_filters_pandas(final_df, metric_filters, output_metrics_scatter)

        # Apply comprehensive sorting
        sort_by = self._normalize_sort_by(sort_by)
        sort_order = self._normalize_sort_order(sort_order)
        
        if sort_by == "x" and "x" in final_df.columns:
            final_df = final_df.sort_values(by="x", ascending=(sort_order == "asc"))
        elif sort_by == "y" and "y" in final_df.columns:
            final_df = final_df.sort_values(by="y", ascending=(sort_order == "asc"))

        # Apply series limit if requested
        if legend_field and series_limit and legend_field in final_df.columns:
            top_series = final_df.groupby(legend_field)['y'].sum().abs().sort_values(ascending=False).head(series_limit).index
            final_df = final_df[final_df[legend_field].isin(top_series)]

        # Protect frontend rendering performance with cap
        final_df = final_df.head(limit)

        data = []
        has_legend_col = legend_field and legend_field in final_df.columns
        for _, row in final_df.iterrows():
            # Use .get() or direct access after ensuring we have a DataFrame
            data.append([row['x'], row['y'], row[legend_field] if has_legend_col else None])

        y_label = f"{y_agg.capitalize()} of {y_field}" if is_y_agg else y_field
        return {
            "series": [{"name": y_label, "data": data}],
            "xAxisLabel": f"{x_agg.capitalize()} of {x_field}" if is_x_agg else x_field,
            "yAxisLabel": y_label
        }

    # =========================================================
    # SAMPLE SQL EXECUTION (template charts with JOINs)
    # =========================================================
    async def _execute_with_sample_sql(self, chart: Chart, sample_sql: str) -> Dict[str, Any]:
        chart_query = chart.chart_query or {}
        filters = chart_query.get("filters") or []
        metric_filters = chart_query.get("metricFilters") or []
        sql = sample_sql.strip().rstrip(";")
        if isinstance(filters, list):
            filters = self._filters_projected_by_saved_sql(filters, sql)
        where_clause = self._apply_filters_db(filters if isinstance(filters, list) else [])
        having_clause = self._apply_metric_filters_db(metric_filters if isinstance(metric_filters, list) else [])
        if where_clause or having_clause:
            wrapped = f"SELECT * FROM ({sql}) AS _aicser_saved"
            if where_clause:
                wrapped += f" {where_clause}"
            if having_clause:
                wrapped += f" {having_clause}"
            sql = wrapped

        stmt = select(DataSource).where(DataSource.id == chart.data_source_id)
        res = await self.db.execute(stmt)
        data_source = res.scalar_one_or_none()
        if not data_source:
            raise ValueError("Data source not found")

        sql = self._rewrite_sql_fk_display_labels(sql, data_source.schema or {})
        sql = self._quote_known_table_refs_in_sql(sql, data_source.schema or {})

        ds_dict = {
            "id": data_source.id,
            "type": data_source.type,
            "db_type": data_source.db_type,
            "format": data_source.format,
            "schema": data_source.schema or {},
            "connection_config": data_source.connection_config,
            "project_id": str(data_source.project_id),
            "user_id": str(data_source.user_id) if data_source.user_id else None,
            "file_path": data_source.file_path,
        }

        multi = get_multi_engine_query_service()
        exec_res = await multi.execute_query(sql, ds_dict)
        if not exec_res.get("success"):
            if data_source.type == "sample_duckdb":
                return self._sample_template_fallback_result(chart)
            raise Exception(f"Query execution failed: {exec_res.get('error')}")

        rows = exec_res.get("data", [])
        return self._map_sql_rows_to_chart_data(rows, chart.chart_type)

    def _map_sql_rows_to_chart_data(
        self, rows: List[Dict[str, Any]], chart_type: Optional[str] = None
    ) -> Dict[str, Any]:
        """Map raw SQL result rows to the renderer's {x, y, series} / {value} shape.

        compiled_semantic_sql (AI planner) and saved/template SQL return columns
        under their real aliased names — e.g. `SELECT "product_type", SUM(...) AS
        total` — NOT the literal columns ``x``/``y`` the dashboard renderer reads.
        Reading ``row["x"]`` there yields ``None`` for every row, which is why
        such widgets rendered all-``null`` categories / empty bars. We map by
        position instead:

          * stat            -> single headline value (``value``/``y`` alias, else first column)
          * legacy x/y SQL  -> honor explicit ``x``/``y`` aliases (template charts)
          * grouped result  -> first column = category (x), remaining columns = series
        """
        if not rows:
            return {"x": [], "y": [], "series": []}

        first_row = rows[0]
        columns = list(first_row.keys())

        # Stat KPIs come from a single-row aggregate with no category dimension,
        # so positional "first column = x" would consume the headline metric.
        if chart_type == "stat":
            if "value" in first_row:
                return {"value": first_row["value"]}
            if "y" in columns:
                y_vals = [row.get("y") for row in rows]
                return {"value": y_vals[-1] if y_vals else None}
            primary = columns[0] if columns else None
            return {"value": first_row.get(primary) if primary else None}

        # Template / saved SQL that already aliases its output as x / y.
        if "x" in columns or "y" in columns:
            x_vals = [row.get("x") for row in rows]
            y_vals = [row.get("y") for row in rows]
            return {"x": x_vals, "y": y_vals, "series": [{"name": "Value", "data": y_vals}]}

        # Single explicit value column (e.g. gauge SQL aliased as `value`).
        if len(columns) == 1 and "value" in first_row:
            return {"value": first_row["value"]}

        # Generic GROUP BY result: first column is the category dimension,
        # each remaining column becomes a numeric series.
        x_col = columns[0]
        series_cols = columns[1:]
        x_vals = [row.get(x_col) for row in rows]
        if not series_cols:
            return {"x": x_vals, "y": [], "series": []}
        series = [
            {"name": str(col), "data": [row.get(col) for row in rows]}
            for col in series_cols
        ]
        return {"x": x_vals, "y": series[0]["data"], "series": series}

    def _sample_template_fallback_result(self, chart: Chart) -> Dict[str, Any]:
        """
        Return deterministic demo data when optional sample DuckDB files are not
        present. This keeps CE-only/new-dev template dashboards renderable.
        """
        seed_text = f"{chart.title}|{chart.chart_type}|{chart.chart_query}"
        seed = int(hashlib.sha256(seed_text.encode("utf-8")).hexdigest()[:8], 16)

        def value(offset: int, minimum: int = 20, spread: int = 180) -> int:
            return minimum + ((seed >> (offset % 16)) % spread)

        if chart.chart_type == "stat":
            return {"value": value(3, minimum=8, spread=950)}

        if chart.chart_type == "scatter":
            points = [
                [value(i * 2, minimum=5, spread=120), value(i * 3, minimum=10, spread=180), "Sample"]
                for i in range(12)
            ]
            return {
                "series": [{"name": chart.title or "Sample", "data": points}],
                "xAxisLabel": "Sample X",
                "yAxisLabel": "Sample Y",
            }

        chart_query = chart.chart_query or {}
        x_field = str(chart_query.get("x") or "").lower()

        if "date" in x_field or chart.chart_type in {"line", "area"}:
            labels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
        elif "status" in x_field:
            labels = ["Active", "Pending", "Closed", "Overdue"]
        elif "type" in x_field:
            labels = ["Type A", "Type B", "Type C", "Type D"]
        elif "branch" in x_field:
            labels = ["Branch 1", "Branch 2", "Branch 3", "Branch 4"]
        else:
            labels = ["Segment A", "Segment B", "Segment C", "Segment D"]

        y_vals = [value(i * 3, minimum=10, spread=240) for i, _ in enumerate(labels)]
        return {
            "x": labels,
            "y": y_vals,
            "series": [{"name": chart.title or "Value", "data": y_vals}],
        }

    # =========================================================
    # DATABASE EXECUTION
    # =========================================================
    async def _execute_db_source(
        self, data_source: DataSource, x_field: Optional[str], aggregate: Optional[str], 
        y_metric: Optional[str], y_metrics: List[Dict],
        has_y_metrics_defined: bool,
        group_field: Optional[str], order_clause: str,
        n_primary: int = 1,
        x_grain: Optional[str] = None,
        filters: List[Dict] = [],
        metric_filters: List[Dict] = [],
        limit: int = 5000,
        series_limit: Optional[int] = None,
        chart_query: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        chart_query = chart_query or {}
        schema_info = data_source.schema or {}
        table, schema = self._resolve_table_from_chart(chart_query, schema_info)

        if not table:
            raise ValueError("Table name missing in data source schema")

        joins = chart_query.get("joins") if isinstance(chart_query.get("joins"), list) else []
        display_dimension = self._infer_fk_display_dimension(schema_info, self._bare_table_name(table), x_field, joins)
        if display_dimension and display_dimension.get("join"):
            joins = [*joins, display_dimension["join"]]
        from_clause = self._build_from_clause(f"{schema}.{table}", joins)
        
        # USE MultiEngineQueryService for external databases
        ds_dict = {
            "id": data_source.id,
            "type": data_source.type,
            "db_type": data_source.db_type,
            "format": data_source.format,
            "schema": schema_info,
            "connection_config": data_source.connection_config,
            "project_id": str(data_source.project_id),
            "user_id": str(data_source.user_id) if data_source.user_id else None,
            "file_path": data_source.file_path,
        }
        multi = get_multi_engine_query_service()

        # If we have multiple y_metrics and no x_field, we calculate them as standalone values
        if not x_field and y_metrics:
            select_fields = []
            for i, ym in enumerate(y_metrics):
                expr = self._build_metric_sql(ym)
                if not expr:  # malformed/unsafe computed metric → fail closed
                    expr = "0"
                select_fields.append(f"{expr} AS val_{i}")
            
            where_clause = self._apply_filters_db(filters)
            having_clause = self._apply_metric_filters_db(metric_filters)
            sql = f"SELECT {', '.join(select_fields)} FROM {from_clause} {where_clause} {having_clause}"
            exec_res = await multi.execute_query(sql, ds_dict)
            if not exec_res.get("success"):
                raise Exception(f"Query execution failed: {exec_res.get('error')}")
            
            rows = exec_res.get("data", [])
            row = rows[0] if rows else {}
            
            # For Pie chart with multiple metrics but no x: 
            # x values are the metric names, y values are the results
            labels = []
            values = []
            for i, ym in enumerate(y_metrics):
                agg_type = ym.get("aggregation", "count")
                field = ym.get("field")
                label = ym.get("label") or (f"{agg_type.capitalize()} of {field}" if field else "Count")
                labels.append(label)
                values.append(row.get(f"val_{i}", 0))
            
            return {"x": labels, "y": values}

        # Standard grouping logic
        agg_func = self._get_aggregate_func(aggregate, y_metric)
        
        # Override with first y_metric if available for single-metric view
        if y_metrics:
            first_ym = y_metrics[0]
            agg_func = self._get_aggregate_func(first_ym.get("aggregation", "count"), first_ym.get("field"))

        # Build GROUP BY clause
        group_by_fields = []
        if x_field:
            if display_dimension:
                group_by_fields.append(display_dimension["expression"])
            elif x_grain:
                db_type = data_source.db_type or "postgres"
                transformed_x = self._get_date_trunc(x_field, x_grain, db_type)
                group_by_fields.append(transformed_x)
            else:
                group_by_fields.append(self._quote_identifier(x_field))
        if group_field and group_field != x_field:
            group_by_fields.append(self._quote_identifier(group_field))
        
        group_by_clause = f"GROUP BY {', '.join(group_by_fields)}" if group_by_fields else ""

        # Build SELECT clause
        select_fields = []
        if x_field:
            if display_dimension:
                select_fields.append(f"{display_dimension['expression']} AS x")
            elif x_grain:
                db_type = data_source.db_type or "postgres"
                transformed_x = self._get_date_trunc(x_field, x_grain, db_type)
                select_fields.append(f"{transformed_x} AS x")
            else:
                select_fields.append(f"{self._quote_identifier(x_field)} AS x")
        else:
            select_fields.append("'Total' AS x")
            
        if group_field and group_field != x_field:
            select_fields.append(f"{self._quote_identifier(group_field)} AS group_field")
            
        # Support multiple metrics
        metric_aliases = []
        if y_metrics:
            for i, ym in enumerate(y_metrics):
                agg_type = ym.get("aggregation", "count")
                field = ym.get("field")
                expr = self._build_metric_sql(ym)
                if not expr:  # malformed/unsafe computed metric → fail closed
                    expr = "0"
                alias = f"y_{i}"
                select_fields.append(f"{expr} AS {alias}")
                metric_aliases.append({
                    "alias": alias,
                    "name": ym.get("label") or field or agg_type.capitalize()
                })
        elif has_y_metrics_defined:
            # yMetrics explicitly provided but empty - return 0s so we see labels but no values
            select_fields.append("0 AS y")
            metric_aliases.append({"alias": "y", "name": "Value"})
        else:
            # Fallback for old charts / simple aggregate mode
            agg_func = self._get_aggregate_func(aggregate or "count", y_metric)
            select_fields.append(f"{agg_func} AS y")
            metric_aliases.append({"alias": "y", "name": "Value"})
        
        select_clause = ", ".join(select_fields)
        where_clause = self._apply_filters_db(filters)
        having_clause = self._apply_metric_filters_db(metric_filters)

        sql = f"SELECT {select_clause} FROM {from_clause} {where_clause} {group_by_clause} {having_clause} {order_clause} LIMIT {limit}"


        exec_res = await multi.execute_query(sql, ds_dict)
        if not exec_res.get("success"):
            raise Exception(f"Query execution failed: {exec_res.get('error')}")
            
        rows = exec_res.get("data", [])

        result = {
            "x": [row.get("x") for row in rows],
        }

        all_series = [
            {"name": m["name"], "data": [row.get(m["alias"]) for row in rows]}
            for m in metric_aliases
        ]

        # Use n_primary to split into series and secondarySeries
        result["series"] = all_series[:n_primary]
        result["secondarySeries"] = all_series[n_primary:]

        # Provide x, y, y2 for simple cases or backward compatibility
        if result["series"]:
            result["y"] = result["series"][0]["data"]
        
        if result["secondarySeries"]:
            result["y2"] = result["secondarySeries"][0]["data"]

        if group_field and group_field != x_field:
            result["group_field"] = [row.get("group_field") for row in rows]

        return result

    # =========================================================
    # FILE (PANDAS) EXECUTION
    # =========================================================
    def _execute_file_source(
        self, data_source: DataSource, x_field: Optional[str], aggregate: Optional[str], 
        y_metric: Optional[str], y_metrics: List[Dict],
        has_y_metrics_defined: bool,
        group_field: Optional[str], sort_by: str, sort_order: str, 
        group_sort_by: str, group_order: str,
        n_primary: int = 1,
        x_grain: Optional[str] = None,
        filters: List[Dict] = [],
        metric_filters: List[Dict] = [],
        limit: int = 5000,
        series_limit: Optional[int] = None
    ) -> Dict[str, Any]:
        if not data_source.sample_data:
            raise ValueError("No sample data available")

        import pandas as pd

        data = (
            json.loads(data_source.sample_data)
            if isinstance(data_source.sample_data, str)
            else data_source.sample_data
        )
        df = pd.DataFrame(data)

        # Apply filters
        df = self._apply_filters_pandas(df, filters)

        if x_field and x_field not in df.columns:
            raise ValueError(f"Field {x_field} not found in file data")

        # Apply x_grain (date bucketing) if requested
        if x_field and x_grain:
            try:
                # Try to convert to datetime
                df[x_field] = pd.to_datetime(df[x_field], errors='coerce')
                # Drop rows where datetime conversion failed if they existed
                df = df.dropna(subset=[x_field])
                
                # Apply grain
                if x_grain == 'year':
                    df[x_field] = df[x_field].dt.to_period('Y').dt.to_timestamp()
                elif x_grain == 'quarter':
                    df[x_field] = df[x_field].dt.to_period('Q').dt.to_timestamp()
                elif x_grain == 'month':
                    df[x_field] = df[x_field].dt.to_period('M').dt.to_timestamp()
                elif x_grain == 'week':
                    df[x_field] = df[x_field].dt.to_period('W').dt.to_timestamp()
                elif x_grain == 'day':
                    df[x_field] = df[x_field].dt.to_period('D').dt.to_timestamp()
                elif x_grain == 'hour':
                    df[x_field] = df[x_field].dt.to_period('H').dt.to_timestamp()
            except Exception as e:
                # Fallback to raw if date conversion fails
                pass

        # Multi-metric no-x case
        if not x_field and y_metrics:
            labels = []
            values = []
            for ym in y_metrics:
                agg_type = ym.get("aggregation", "count")
                field = ym.get("field")

                if ym.get("computed"):
                    try:
                        cm = self._compute_metric_pandas(df, ym, group_by=[])
                        col = ym.get("field", "value")
                        val = float(cm[col].iloc[0]) if col in cm.columns and len(cm) else 0
                    except Exception:
                        val = 0
                    labels.append(ym.get("label") or field or "Ratio")
                    values.append(val)
                    continue

                val = 0
                if agg_type == "count":
                    val = len(df)
                elif agg_type == "distinct_count":
                    val = df[field].nunique() if field in df.columns else 0
                elif field in df.columns:
                    col_data = pd.to_numeric(df[field], errors='coerce').dropna()
                    if not col_data.empty:
                        if agg_type == "sum": val = col_data.sum()
                        elif agg_type == "avg": val = col_data.mean()
                        elif agg_type == "max": val = col_data.max()
                        elif agg_type == "min": val = col_data.min()
                
                label = ym.get("label") or (f"{agg_type.capitalize()} of {field}" if field else "Count")
                labels.append(label)
                values.append(val)
            return {"x": labels, "y": values}
        
        # Explicit empty metrics case for no-x
        if not x_field and has_y_metrics_defined and not y_metrics:
            return {"x": ["Total"], "y": [0]}

        # Determine grouping fields
        group_by_fields = []
        if x_field:
            group_by_fields.append(x_field)
        if group_field and group_field != x_field:
            group_by_fields.append(group_field)

        # Determine aggregator
        agg_to_use = aggregate
        metric_to_use = y_metric
        if y_metrics:
            agg_to_use = y_metrics[0].get("aggregation", "count")
            metric_to_use = y_metrics[0].get("field")

        # Apply grouping if x_field exists
        output_metrics = []
        if x_field:
            if not y_metrics:
                if has_y_metrics_defined:
                    # Explicitly no metrics, return 0s
                    grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                    grouped["y"] = 0
                else:
                    # Single metric fallback (old style)
                    metric_to_use = y_metric
                    agg_to_use = aggregate or "count"
                    
                    if agg_to_use == "count":
                        if metric_to_use and metric_to_use in df.columns:
                            grouped = df.groupby(group_by_fields)[metric_to_use].count().reset_index(name="y")
                        else:
                            grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                    elif agg_to_use == "distinct_count" and metric_to_use:
                        grouped = df.groupby(group_by_fields)[metric_to_use].nunique().reset_index(name="y")
                    elif metric_to_use and metric_to_use in df.columns:
                        df[metric_to_use] = pd.to_numeric(df[metric_to_use], errors='coerce')
                        df_clean = df.dropna(subset=[metric_to_use])
                        if agg_to_use == "sum": grouped = df_clean.groupby(group_by_fields)[metric_to_use].sum().reset_index(name="y")
                        elif agg_to_use == "avg": grouped = df_clean.groupby(group_by_fields)[metric_to_use].mean().reset_index(name="y")
                        elif agg_to_use == "max": grouped = df_clean.groupby(group_by_fields)[metric_to_use].max().reset_index(name="y")
                        elif agg_to_use == "min": grouped = df_clean.groupby(group_by_fields)[metric_to_use].min().reset_index(name="y")
                        else: grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                    else:
                        grouped = df.groupby(group_by_fields).size().reset_index(name="y")
                output_metrics.append({
                    "alias": "y", 
                    "name": y_metric if y_metric else (aggregate.capitalize() if aggregate else "Count"),
                    "field": y_metric,
                    "aggregation": aggregate or "count"
                })
            else:
                # Multiple metrics
                agg_map = {}
                numeric_fields_to_cast = set()
                computed_metrics = []  # (alias, ym) — merged after grouping

                for i, ym in enumerate(y_metrics):
                    agg_type = ym.get("aggregation", "count")
                    field = ym.get("field")
                    alias = f"y_{i}"

                    if ym.get("computed"):
                        computed_metrics.append((alias, ym))
                        output_metrics.append({
                            "alias": alias,
                            "name": ym.get("label") or field or "Ratio",
                            "field": field,
                            "aggregation": "computed",
                        })
                        continue

                    if agg_type == "count":
                        # If field is provided, count non-nulls. Otherwise count all rows (size).
                        agg_map[alias] = (field, "count") if field and field in df.columns else (df.columns[0], "size")
                    elif agg_type == "distinct_count":
                        agg_map[alias] = (field, "nunique")
                    else:
                        # Normalize common aggregations for Pandas
                        pandas_agg = agg_type
                        if agg_type == "avg":
                            pandas_agg = "mean"
                        
                        agg_map[alias] = (field, pandas_agg)
                        
                        # Collect fields that need numeric casting
                        if field and field in df.columns and pandas_agg in ("sum", "mean", "min", "max"):
                            numeric_fields_to_cast.add(field)
                    
                    output_metrics.append({
                        "alias": alias,
                        "name": ym.get("label") or field or agg_type.capitalize(),
                        "field": field,
                        "aggregation": agg_type
                    })

                # Cast required fields to numeric to avoid "no numeric types" errors in Pandas
                for field in numeric_fields_to_cast:
                    df[field] = pd.to_numeric(df[field], errors='coerce')
                
                # Build aggregation dict
                agg_dict = {}
                for alias, (field, agg) in agg_map.items():
                    if agg == "size":
                        continue # size is handled separately
                    agg_dict[alias] = pd.NamedAgg(column=field, aggfunc=agg)

                if not agg_dict:
                    # Only size-based counts
                    grouped = df.groupby(group_by_fields).size().reset_index(name="y_0")
                    # If there were multiple size-based counts (weird but possible), they'd all be the same anyway
                else:
                    grouped = df.groupby(group_by_fields).agg(**agg_dict).reset_index()
                    # Add size-based counts if any
                    for alias, (field, agg) in agg_map.items():
                        if agg == "size":
                            # We need to compute size and join or assign
                            # Since it's the same grouping, we can just assign the values from a size() call
                            sizes = df.groupby(group_by_fields).size().values
                            grouped[alias] = sizes

                # Merge computed (ratio) metrics, aligned on the same grouping keys
                for alias, ym in computed_metrics:
                    try:
                        cm_df = self._compute_metric_pandas(df, ym, group_by_fields)
                        value_col = ym.get("field", "value")
                        cm_df = cm_df.rename(columns={value_col: alias})
                        if alias in grouped.columns:
                            grouped = grouped.drop(columns=[alias])
                        grouped = grouped.merge(cm_df, on=group_by_fields, how="left")
                        grouped[alias] = grouped[alias].fillna(0)
                    except Exception:
                        if alias not in grouped.columns:
                            grouped[alias] = 0
        else:
            # Fallback for no-x if y_metrics didn't handle it (handled by early return in _execute_file_source)
            grouped = pd.DataFrame([{"x": "Total", "y": len(df)}])
            x_field = "x"
            output_metrics.append({"alias": "y", "name": "Value"})

        # Apply comprehensive sorting
        sort_by = self._normalize_sort_by(sort_by)
        sort_order = self._normalize_sort_order(sort_order)

        # Apply series limit if grouped
        if group_field and series_limit and group_field in grouped.columns:
            # Find top N series by total value of the first metric
            metric_col = output_metrics[0]["alias"]
            if metric_col in grouped.columns:
                top_series = grouped.groupby(group_field)[metric_col].sum().abs().sort_values(ascending=False).head(series_limit).index
                grouped = grouped[grouped[group_field].isin(top_series)]
        
        # Apply metric filters
        grouped = self._apply_metric_filters_pandas(grouped, metric_filters, output_metrics)

        if sort_by == "x" and x_field in grouped.columns:
            grouped = grouped.sort_values(by=x_field, ascending=(sort_order == "asc"))
        elif sort_by == "y":
            primary_y = "y" if "y" in grouped.columns else "y_0"
            if primary_y in grouped.columns:
                grouped = grouped.sort_values(by=primary_y, ascending=(sort_order == "asc"))
            
        # Group field secondary sort
        if group_field and group_field != x_field and group_field in grouped.columns:
            if group_sort_by == "field":
                group_ascending = self._normalize_sort_order(group_order) == "asc"
                primary_sort = x_field if sort_by=="x" else ( "y" if "y" in grouped.columns else "y_0")
                if primary_sort in grouped.columns:
                    grouped = grouped.sort_values(by=[primary_sort, group_field], 
                                               ascending=[sort_order=="asc", group_ascending])

        # Prevent massive unpaginated responses
        grouped = grouped.head(limit)


        result = {
            "x": grouped[x_field].astype(str).tolist(),
        }

        all_series = [
            {"name": m["name"], "data": grouped[m["alias"]].tolist()}
            for m in output_metrics
        ]

        # Use n_primary to split into series and secondarySeries
        result["series"] = all_series[:n_primary]
        result["secondarySeries"] = all_series[n_primary:]

        # Provide x, y, y2 for simple cases or backward compatibility
        if result["series"]:
            result["y"] = result["series"][0]["data"]
        
        if result["secondarySeries"]:
            result["y2"] = result["secondarySeries"][0]["data"]

        if group_field and group_field != x_field and group_field in grouped.columns:
            result["group_field"] = grouped[group_field].astype(str).tolist()

        return result

    # =========================================================
    # HELPERS
    # =========================================================
    def _is_valid_field_name(self, field_name: str) -> bool:
        if not field_name or not isinstance(field_name, str):
            return False
        # Uploaded files and spreadsheets commonly contain display-style column
        # names ("Units Sold", "Manufacturing Price"). Allow those names, but
        # reject SQL syntax and quoting characters.
        return bool(re.match(r"^[A-Za-z0-9_][A-Za-z0-9_ .-]*$", field_name.strip()))

    def _quote_identifier(self, identifier: str) -> str:
        """Quote a validated table/column identifier, preserving dotted paths."""
        if not self._is_valid_field_name(identifier):
            raise ValueError(f"Invalid field name: {identifier}")
        parts = [part.strip() for part in str(identifier).split(".") if part.strip()]
        return ".".join(f'"{part.replace(chr(34), chr(34) + chr(34))}"' for part in parts)

    def _projected_sql_columns(self, sql: str) -> set[str]:
        """Best-effort output-column extraction for saved SQL filter safety."""
        text_sql = (sql or "").strip().rstrip(";")
        match = re.match(r"(?is)^\s*select\s+(.*?)\s+from\s+", text_sql)
        if not match:
            return set()

        select_clause = match.group(1)
        columns: set[str] = set()
        depth = 0
        quote: Optional[str] = None
        token = []
        parts: List[str] = []
        for ch in select_clause:
            if quote:
                token.append(ch)
                if ch == quote:
                    quote = None
                continue
            if ch in ("'", '"', "`"):
                quote = ch
                token.append(ch)
                continue
            if ch == "(":
                depth += 1
            elif ch == ")" and depth > 0:
                depth -= 1
            if ch == "," and depth == 0:
                parts.append("".join(token).strip())
                token = []
            else:
                token.append(ch)
        if token:
            parts.append("".join(token).strip())

        for part in parts:
            if part == "*":
                return set()
            alias_match = re.search(r'(?is)\s+as\s+("([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_ .-]*))\s*$', part)
            if alias_match:
                alias = next((g for g in alias_match.groups()[1:] if g), "")
                if alias:
                    columns.add(alias.strip())
                continue
            simple_match = re.match(r'(?is)^(?:"([^"]+)"|`([^`]+)`|([A-Za-z_][A-Za-z0-9_ .-]*))(?:\s*)$', part)
            if simple_match:
                name = next((g for g in simple_match.groups() if g), "")
                if name:
                    columns.add(name.split(".")[-1].strip())
        return columns

    def _filters_projected_by_saved_sql(self, filters: List[Dict], sql: str) -> List[Dict]:
        projected = self._projected_sql_columns(sql)
        if not projected:
            return filters
        cleaned: List[Dict] = []
        for f in filters or []:
            if not isinstance(f, dict):
                continue
            if f.get("type") == "sql":
                logger.info("Skipping raw SQL runtime filter for saved chart SQL")
                continue
            field = str(f.get("field") or "").strip()
            if not field or field in projected or field.split(".")[-1] in projected:
                cleaned.append(f)
            else:
                logger.info(
                    "Skipping runtime filter %s for saved chart SQL; projected columns=%s",
                    field,
                    sorted(projected),
                )
        return cleaned
    
    def _build_order_clause(self, sort_by: str, sort_order: str, x_field: Optional[str], has_y_metrics: bool = False) -> str:
        sort_by = self._normalize_sort_by(sort_by)
        sort_order = self._normalize_sort_order(sort_order)
        if sort_by == "x" and x_field:
            # Order by the "x" output alias, not the raw column: when date
            # bucketing (x_grain) is applied, SELECT/GROUP BY use date_trunc(...)
            # AS x, and ordering by the raw column breaks on engines (DuckDB)
            # that require it to appear in GROUP BY. The alias matches both cases.
            return f"ORDER BY x {'ASC' if sort_order == 'asc' else 'DESC'}"
        if sort_by == "y":
            # If multiple metrics, sort by the first one y_0, else y
            alias = "y_0" if has_y_metrics else "y"
            return f"ORDER BY {alias} {'DESC' if sort_order == 'desc' else 'ASC'}"
        return ""

    def _normalize_sort_by(self, sort_by: Optional[str]) -> str:
        if sort_by in (None, "", "order", "record_order"): return "record_order"
        return sort_by if sort_by in ("x", "y") else "record_order"
    
    def _normalize_sort_order(self, sort_order: Optional[str]) -> str:
        if not sort_order: return "desc"
        return "asc" if sort_order.lower() in ("asc", "ascending") else "desc"
    
    def _apply_filters_db(self, filters: List[Dict]) -> str:
        if not filters:
            return ""
        
        clauses = []
        for f in filters:
            field = f.get("field")
            operator = f.get("operator", "=")
            value = f.get("value")
            f_type = f.get("type", "simple")

            if not field or not self._is_valid_field_name(field):
                continue
            field_sql = self._quote_identifier(field)
            
            if f_type == 'sql' and f.get('sql'):
                clauses.append(f"({f.get('sql')})")
                continue

            # Basic SQL injection protection for operator
            valid_operators = ["=", "!=", ">", ">=", "<", "<=", "like", "like_case", "in", "not_in", "is_null", "is_not_null"]
            if operator not in valid_operators:
                continue
            
            # Format value
            if operator == "is_null":
                clauses.append(f"{field_sql} IS NULL")
            elif operator == "is_not_null":
                clauses.append(f"{field_sql} IS NOT NULL")
            elif operator in ("in", "not_in"):
                # Expecting a comma-separated string or list
                if isinstance(value, str):
                    vals = [v.strip() for v in value.split(",")]
                elif isinstance(value, list):
                    vals = value
                else:
                    vals = [value]
                
                formatted_vals = []
                for v in vals:
                    if isinstance(v, (int, float)):
                        formatted_vals.append(str(v))
                    else:
                        safe_v = str(v).replace("'", "''")
                        formatted_vals.append(f"'{safe_v}'")
                
                op_sql = "IN" if operator == "in" else "NOT IN"
                clauses.append(f"{field_sql} {op_sql} ({', '.join(formatted_vals)})")
            elif operator in ("like", "like_case"):
                val_str = str(value).replace("'", "''")
                clauses.append(f"{field_sql} {'ILIKE' if operator == 'like' else 'LIKE'} '%{val_str}%'")
            else:
                if isinstance(value, (int, float)):
                    clauses.append(f"{field_sql} {operator} {value}")
                else:
                    val_str = str(value).replace("'", "''")
                    clauses.append(f"{field_sql} {operator} '{val_str}'")
        
        if not clauses:
            return ""
        
        return "WHERE " + " AND ".join(clauses)

    def _apply_filters_pandas(self, df, filters: List[Dict]):
        if not filters:
            return df
        
        import pandas as pd
        
        for f in filters:
            field = f.get("field")
            operator = f.get("operator", "=")
            value = f.get("value")
            
            if not field or field not in df.columns:
                continue
                
            # Handle is_null/is_not_null
            if operator == "is_null":
                df = df[df[field].isna()]
            elif operator == "is_not_null":
                df = df[df[field].notna()]
            elif operator == "in":
                vals = value if isinstance(value, list) else [v.strip() for v in str(value).split(",")]
                df = df[df[field].astype(str).isin([str(v) for v in vals])]
            elif operator == "not_in":
                vals = value if isinstance(value, list) else [v.strip() for v in str(value).split(",")]
                df = df[~df[field].astype(str).isin([str(v) for v in vals])]
            elif operator in ("like", "like_case"):
                case = operator == "like_case"
                df = df[df[field].astype(str).str.contains(str(value), case=case, na=False)]
            else:
                # Comparison operators
                try:
                    # Try to compare as numbers if possible
                    if operator == "=": df = df[df[field].astype(str) == str(value)]
                    elif operator == "!=": df = df[df[field].astype(str) != str(value)]
                    elif operator == ">": df = df[pd.to_numeric(df[field], errors='coerce') > float(value)]
                    elif operator == ">=": df = df[pd.to_numeric(df[field], errors='coerce') >= float(value)]
                    elif operator == "<": df = df[pd.to_numeric(df[field], errors='coerce') < float(value)]
                    elif operator == "<=": df = df[pd.to_numeric(df[field], errors='coerce') <= float(value)]
                except:
                    # Fallback to string comparison
                    if operator == "=": df = df[df[field].astype(str) == str(value)]
                    elif operator == "!=": df = df[df[field].astype(str) != str(value)]
        
        return df

        # If no y_metric but agg_type is a function that needs it, 
        # it might be that agg_type itself is "count" or we fallback
        return "COUNT(*)"

    # =========================================================
    # COMPUTED (RATIO) METRICS — structured, injection-safe
    # =========================================================
    def _build_metric_side_sql(self, side: Dict[str, Any]) -> Optional[str]:
        """SQL for one side of a computed metric: AGG(field) [FILTER (WHERE ...)].

        Returns None (fail-closed) if the field is invalid, so the caller drops
        the whole metric rather than emitting partial/unsafe SQL.
        """
        if not isinstance(side, dict):
            return None
        agg = side.get("aggregation", "sum")
        field = side.get("field")
        if not field or not self._is_valid_field_name(field):
            return None
        agg_sql = self._get_aggregate_func(agg, field)
        # Reuse the existing safe filter compiler (whitelisted ops, escaped values).
        side_filters = side.get("filter") or []
        where = self._apply_filters_db(side_filters if isinstance(side_filters, list) else [])
        if where:
            return f"{agg_sql} FILTER ({where})"
        return agg_sql

    def _build_metric_sql(self, ym: Dict[str, Any]) -> Optional[str]:
        """SQL expression for a yMetric entry. Supports plain {field,aggregation}
        and computed ratio metrics. Returns None when a computed metric is
        malformed/unsafe (caller should skip that metric)."""
        if not isinstance(ym, dict):
            return None
        computed = ym.get("computed")
        if computed:
            if not isinstance(computed, dict) or computed.get("type") != "ratio":
                return None
            num = self._build_metric_side_sql(computed.get("numerator") or {})
            den = self._build_metric_side_sql(computed.get("denominator") or {})
            if not num or not den:
                return None
            mult = computed.get("multiplier", 1)
            if mult not in (1, 100):
                mult = 1
            expr = f"{num} / NULLIF({den}, 0)"
            return f"{expr} * {mult}" if mult != 1 else expr
        return self._get_aggregate_func(ym.get("aggregation", "count"), ym.get("field"))

    def _compute_metric_pandas(self, df, ym: Dict[str, Any], group_by: List[str]):
        """Compute a ratio metric over a (optionally grouped) DataFrame.

        Returns a DataFrame: grouped -> columns [*group_by, alias]; ungrouped ->
        single column [alias]. Mirrors _build_metric_sql semantics for file sources.
        """
        import pandas as pd

        computed = ym.get("computed") or {}
        alias = ym.get("field", "value")
        mult = computed.get("multiplier", 1)
        if mult not in (1, 100):
            mult = 1

        agg_map = {
            "sum": "sum", "avg": "mean", "min": "min", "max": "max",
            "count": "count", "distinct_count": "nunique",
        }

        def _side(side: Dict[str, Any]):
            sub = self._apply_filters_pandas(df, side.get("filter") or [])
            field = side.get("field")
            pagg = agg_map.get(side.get("aggregation", "sum"), "sum")
            if group_by:
                all_idx = df.groupby(group_by).size().index
                if field and field in sub.columns and len(sub):
                    g = sub.groupby(group_by)[field].agg(pagg)
                else:
                    g = pd.Series(dtype=float)
                return g.reindex(all_idx).fillna(0)
            series = sub[field] if (field and field in sub.columns) else pd.Series(dtype=float)
            value = getattr(series, pagg)() if len(series) else 0
            return pd.Series([value])

        num = _side(computed.get("numerator") or {})
        den = _side(computed.get("denominator") or {})
        ratio = (num / den.replace(0, pd.NA)).fillna(0) * mult

        if group_by:
            out = ratio.reset_index()
            out.columns = list(group_by) + [alias]
            return out
        return pd.DataFrame({alias: list(ratio)})

    def _get_aggregate_func(self, aggregate: Any, y_metric: Optional[str] = None) -> str:
        """Generate SQL aggregate function based on aggregate type and metric field."""
        # Normalize aggregate type if it's a boolean or string "true"/"false"
        agg_type = aggregate
        if agg_type is True or agg_type == "true":
            # If it's just a toggle, we look at y_metric. 
            # If y_metric is one of the valid functions, we use it.
            if y_metric in ["count", "sum", "avg", "max", "min", "distinct_count"]:
                agg_type = y_metric
                y_metric = None # It was the function, not the field
            else:
                agg_type = "count"
        elif agg_type is False or agg_type == "false":
            return "COUNT(*)" # Default fallback

        valid_aggregates = ["count", "sum", "avg", "max", "min", "distinct_count"]
        if agg_type not in valid_aggregates:
            agg_type = "count"
            
        if agg_type == "count":
            return f"COUNT({self._quote_identifier(y_metric)})" if y_metric else "COUNT(*)"
        if agg_type == "distinct_count":
            return f"COUNT(DISTINCT {self._quote_identifier(y_metric)})" if y_metric else "COUNT(*)"
            
        if y_metric and self._is_valid_field_name(y_metric):
            field_sql = self._quote_identifier(y_metric)
            if agg_type == "sum": return f"SUM({field_sql})"
            if agg_type == "avg": return f"AVG({field_sql})"
            if agg_type == "max": return f"MAX({field_sql})"
            if agg_type == "min": return f"MIN({field_sql})"
            
        # If no y_metric but agg_type is a function that needs it, 
        # it might be that agg_type itself is "count" or we fallback
        return "COUNT(*)"

    def _apply_metric_filters_db(self, filters: List[Dict]) -> str:
        if not filters:
            return ""
        
        clauses = []
        for f in filters:
            field = f.get("field")
            agg_type = f.get("aggregation", "sum")
            operator = f.get("operator", "=")
            value = f.get("value")

            if not field or not self._is_valid_field_name(field):
                continue
            
            # Simple SQL injection protection for operator
            valid_operators = ["=", "!=", ">", ">=", "<", "<="]
            if operator not in valid_operators:
                continue
            
            agg_func = self._get_aggregate_func(agg_type, field)
            
            if isinstance(value, (int, float)):
                clauses.append(f"{agg_func} {operator} {value}")
            else:
                try:
                    num_val = float(value)
                    clauses.append(f"{agg_func} {operator} {num_val}")
                except:
                    continue
        
        if not clauses:
            return ""
        
        return "HAVING " + " AND ".join(clauses)

    def _apply_metric_filters_pandas(self, df, filters: List[Dict], output_metrics: List[Dict] = []):
        if not filters or df.empty:
            return df
        
        import pandas as pd
        for f in filters:
            field = f.get("field")
            agg_type = str(f.get("aggregation", "sum")).lower()
            operator = f.get("operator", "=")
            value = f.get("value")
            
            if value is None or value == "":
                continue

            # Try to identify the target column in the aggregated DataFrame
            target_col = None
            
            # 1. Match against output_metrics metadata
            if output_metrics:
                for m in output_metrics:
                    m_field = m.get("field")
                    m_agg = str(m.get("aggregation", "count")).lower()
                    if m_field == field and m_agg == agg_type:
                        target_col = m.get("alias")
                        break

            # 2. Fallback to direct field name (for scatter or simple raw charts)
            if not target_col and field in df.columns:
                target_col = field
            
            # 3. Last resort fallback
            if not target_col and "y" in df.columns:
                target_col = "y"
            
            if not target_col:
                continue

            try:
                num_val = float(value)
                col_data = pd.to_numeric(df[target_col], errors='coerce')
                if operator == "=": df = df[col_data == num_val]
                elif operator == "!=": df = df[col_data != num_val]
                elif operator == ">": df = df[col_data > num_val]
                elif operator == ">=": df = df[col_data >= num_val]
                elif operator == "<": df = df[col_data < num_val]
                elif operator == "<=": df = df[col_data <= num_val]
            except Exception as e:
                continue

        return df

    def _get_date_trunc(self, field: str, grain: str, db_type: str) -> str:
        field_sql = self._quote_identifier(field)
        if db_type == "postgres":
            return f"DATE_TRUNC('{grain}', {field_sql})"
        if db_type == "mysql":
            if grain == "year": return f"DATE_FORMAT({field_sql}, '%Y-01-01')"
            if grain == "month": return f"DATE_FORMAT({field_sql}, '%Y-%m-01')"
            if grain == "day": return f"DATE_FORMAT({field_sql}, '%Y-%m-%d')"
            return field_sql
        if db_type == "sqlite":
            if grain == "year": return f"strftime('%Y-01-01', {field_sql})"
            if grain == "month": return f"strftime('%Y-%m-01', {field_sql})"
            if grain == "day": return f"strftime('%Y-%m-%d', {field_sql})"
            return field_sql
        return field_sql
