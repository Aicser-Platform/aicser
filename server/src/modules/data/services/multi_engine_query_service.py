"""
Multi-Engine Query Execution Service
Handles queries across different engines: DuckDB, Cube.js, Spark, Direct SQL
"""

import logging
import asyncio
import os
import re
import json
import time
from typing import Dict, List, Any, Optional, Tuple, Iterable
from datetime import datetime
from enum import Enum
import pandas as pd
import aiohttp
import sqlalchemy as sa

# DuckDB for local analytics
import duckdb
import shutil
try:
    from src.modules.ai.data_source_capabilities import (
        uses_duckdb_for_execution,
        is_file_upload_duckdb,
        is_single_table_source,
    )
except ImportError:
    def uses_duckdb_for_execution(source_type: str | None, db_type: str | None = None) -> bool:
        source = (source_type or "").lower()
        dialect = (db_type or "").lower()
        return source in {"file", "file_upload", "sample_duckdb"} or dialect in {
            "csv",
            "duckdb",
            "excel",
            "json",
            "parquet",
            "xlsx",
        }

    def is_file_upload_duckdb(source_type: str | None, db_type: str | None = None) -> bool:
        return uses_duckdb_for_execution(source_type, db_type)

    def is_single_table_source(source_type: str | None, db_type: str | None = None) -> bool:
        return uses_duckdb_for_execution(source_type, db_type)
import importlib.util

# Spark for big data processing - import lazily inside SparkEngine to avoid heavy startup at import time
#  Always apply fall back here ??
from src.core.edition import is_ee_enabled
from src.modules.data.services.query_identity import (
    QueryAccess,
    QueryIdentity,
    RowSecurityDenied,
    RowSecurityIdentityRequired,
    SystemQuery,
)
from src.shared.query_limits import PANDAS_FALLBACK_MAX_ROWS

logger = logging.getLogger(__name__)

_multi_engine_service: Optional["MultiEngineQueryService"] = None

# date_trunc('grain', <simple column>) — only a bare or double-quoted identifier
# is matched, so expressions (CAST(...), col + 1, CURRENT_DATE - INTERVAL ...) are
# left alone and the rewrite stays idempotent (already-cast args contain parens).
_DATE_TRUNC_COL_RE = re.compile(
    r"date_trunc\(\s*('[^']*')\s*,\s*(\"?[A-Za-z_][\w]*\"?)\s*\)",
    re.IGNORECASE,
)
_DATE_KEYWORDS = {"CURRENT_DATE", "CURRENT_TIMESTAMP", "NOW", "TODAY", "LOCALTIMESTAMP"}


def _schema_dict(schema_info: Any) -> Dict[str, Any]:
    if isinstance(schema_info, dict):
        return schema_info
    if isinstance(schema_info, str):
        try:
            parsed = json.loads(schema_info)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _quote_ident_part(part: str) -> str:
    return '"' + str(part).replace('"', '""') + '"'


def _quote_table_ref(ref: str) -> str:
    parts = [p.strip().strip('"') for p in str(ref or "").split(".") if p.strip()]
    if not parts or any(not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", p) for p in parts):
        return ref
    return ".".join(_quote_ident_part(p) for p in parts)


def _table_ref_variants(schema_name: str, table_name: str) -> List[str]:
    if not schema_name:
        return [table_name, _quote_ident_part(table_name)]
    return [
        f"{schema_name}.{table_name}",
        f'{schema_name}.{_quote_ident_part(table_name)}',
        f'{_quote_ident_part(schema_name)}.{table_name}',
        f'{_quote_ident_part(schema_name)}.{_quote_ident_part(table_name)}',
    ]


def quote_known_table_refs_for_sql(
    query: str,
    schema_info: Any,
    schema_aliases: Optional[Iterable[str]] = None,
) -> str:
    """Quote known table refs in user SQL for mixed-case database tables.

    PostgreSQL folds unquoted identifiers to lower case. If schema introspection
    found a table named Account, raw SQL like ``FROM public.Account`` must be
    sent as ``FROM "public"."Account"``. This only rewrites identifiers directly
    following FROM/JOIN/UPDATE/INTO, leaving columns and string literals alone.
    """
    schema = _schema_dict(schema_info)
    if not query or not schema:
        return query
    tables = schema.get("tables") or []
    if not isinstance(tables, list):
        return query

    aliases = {
        str(alias).strip()
        for alias in (schema_aliases or [])
        if str(alias or "").strip() and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", str(alias).strip())
    }
    refs: List[tuple[str, str]] = []
    for table in tables:
        if not isinstance(table, dict):
            continue
        name = str(table.get("name") or "").strip()
        schema_name = str(table.get("schema") or schema.get("schema") or "public").strip()
        if not name or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
            continue
        refs.append((name, _quote_table_ref(name)))
        refs.append((_quote_ident_part(name), _quote_table_ref(name)))
        if schema_name and re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", schema_name):
            for raw_ref in _table_ref_variants(schema_name, name):
                refs.append((raw_ref, _quote_table_ref(f"{schema_name}.{name}")))
            for alias in aliases:
                if alias.lower() != schema_name.lower():
                    for raw_ref in _table_ref_variants(alias, name):
                        refs.append((raw_ref, _quote_table_ref(f"{schema_name}.{name}")))

    normalized = query
    for raw_ref, quoted_ref in sorted(refs, key=lambda item: len(item[0]), reverse=True):
        pattern = re.compile(
            rf'(?i)\b(FROM|JOIN|UPDATE|INTO)\s+({re.escape(raw_ref)})(?=\s|;|$)',
        )
        normalized = pattern.sub(lambda m: f"{m.group(1)} {quoted_ref}", normalized)
    return normalized


_DUCKDB_TABLE_REF_RE = re.compile(
    r'\b(FROM|JOIN)\s+((?:"[^"]+"|`[^`]+`|[A-Za-z_][\w$-]*)(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|[A-Za-z_][\w$-]*))?)',
    re.IGNORECASE,
)


def _normalize_duckdb_table_ref(ref: str) -> str:
    parts = []
    for part in re.split(r"\s*\.\s*", str(ref or "").strip()):
        clean = part.strip().strip('"').strip("`").strip()
        if clean:
            parts.append(clean)
    return ".".join(parts).lower()


def rewrite_file_duckdb_table_refs(query: str, data_source: Dict[str, Any]) -> Tuple[str, Optional[str], List[str]]:
    """Normalize file-upload SQL table refs to the DuckDB execution surface.

    Single-table uploads execute as ``data``. Multi-sheet uploads expose physical
    ``sheet_*`` tables, with ``schema.duckdb_tables`` mapping friendly/logical
    names to those physical names. This function handles quoted schema-qualified
    refs such as ``FROM "data"."fact_marketing_campaign"``.
    """
    if not query or not isinstance(query, str):
        return query, None, []

    ds_schema = data_source.get("schema") or {}
    duckdb_tables_map = ds_schema.get("duckdb_tables") or {}
    logical_to_duckdb: Dict[str, str] = {
        str(k).strip().lower(): str(v).strip()
        for k, v in duckdb_tables_map.items()
        if k and v
    } if isinstance(duckdb_tables_map, dict) else {}
    direct_duckdb_names = {
        str(v).strip().lower()
        for v in duckdb_tables_map.values()
        if v
    } if isinstance(duckdb_tables_map, dict) else set()

    for table in ds_schema.get("tables") or []:
        if not isinstance(table, dict):
            continue
        name = str(table.get("name") or "").strip()
        logical_name = str(table.get("logical_name") or "").strip()
        if name:
            direct_duckdb_names.add(name.lower())
            logical_to_duckdb.setdefault(name.lower(), name)
        if name and logical_name and logical_name.lower() != name.lower():
            logical_to_duckdb[logical_name.lower()] = name

    storage_format = ""
    if isinstance(ds_schema, dict):
        storage_format = str(((ds_schema.get("storage") or {}).get("format") or "")).lower()
    if storage_format == "parquet" and isinstance(duckdb_tables_map, dict) and duckdb_tables_map:
        primary_physical = str(ds_schema.get("table_name") or "")
        logical_to_duckdb = {
            str(logical).strip().lower(): "data"
            for logical, physical in duckdb_tables_map.items()
            if str(physical) == primary_physical
        }
        direct_duckdb_names = {"data"}
        unavailable_logical_tables = {
            str(logical).strip().lower()
            for logical, physical in duckdb_tables_map.items()
            if str(physical) != primary_physical
        }
    else:
        unavailable_logical_tables = set()

    replacements: List[Tuple[int, int, str]] = []
    translated_refs: List[str] = []
    fallback_refs: List[str] = []
    unavailable_found: List[str] = []

    for match in _DUCKDB_TABLE_REF_RE.finditer(query):
        keyword = match.group(1).upper()
        raw_ref = match.group(2)
        clean_ref = _normalize_duckdb_table_ref(raw_ref)
        if not clean_ref:
            continue
        bare_name = clean_ref.split(".")[-1]

        is_single_valid = (
            "." not in clean_ref
            and (clean_ref in ("data", "_aiser_inline_df") or clean_ref.startswith("file_"))
        )
        if is_single_valid:
            continue
        if bare_name in unavailable_logical_tables:
            unavailable_found.append(bare_name)
            continue
        if bare_name in logical_to_duckdb:
            target = logical_to_duckdb[bare_name]
            replacements.append((match.start(), match.end(), f'{keyword} "{target}"'))
            translated_refs.append(raw_ref)
        elif bare_name in direct_duckdb_names:
            replacements.append((match.start(), match.end(), f'{keyword} "{bare_name}"'))
            translated_refs.append(raw_ref)
        else:
            replacements.append((match.start(), match.end(), f'{keyword} "data"'))
            fallback_refs.append(raw_ref)

    if unavailable_found:
        unavailable = sorted(set(unavailable_found))
        primary = next(iter(logical_to_duckdb.keys()), "data")
        return query, (
            "Related table(s) "
            f"{', '.join(unavailable)} are present in the schema/model but not in the stored "
            f"compressed Parquet payload. Only {primary} is available at query time. "
            "Re-upload or refresh the original multi-sheet workbook so relationship joins can run."
        ), []

    if not replacements:
        return query, None, []

    rewritten = query
    for start, end, replacement in reversed(replacements):
        rewritten = rewritten[:start] + replacement + rewritten[end:]

    return rewritten, None, translated_refs + fallback_refs


def cast_date_trunc_args_for_duckdb(query: str) -> str:
    """Wrap the date argument of ``date_trunc(...)`` in ``TRY_CAST(... AS TIMESTAMP)``.

    DuckDB's ``date_trunc`` requires a TIMESTAMP/DATE argument, but file-backed
    (CSV/Excel) data sources store date columns as VARCHAR, so queries such as
    ``date_trunc('month', disbursement_date)`` fail with
    ``Binder Error: No function matches 'date_trunc(VARCHAR, VARCHAR)'`` and the
    time-series widget gets dropped to the heuristic fallback. Casting lets the
    query run for ISO-style date strings while remaining a no-op for columns that
    are already DATE/TIMESTAMP. Only simple column identifiers are wrapped.
    """
    if not query or "date_trunc(" not in query.lower():
        return query

    def _wrap(match: "re.Match[str]") -> str:
        grain, col = match.group(1), match.group(2)
        if col.upper().strip('"') in _DATE_KEYWORDS:
            return match.group(0)
        return f"date_trunc({grain}, TRY_CAST({col} AS TIMESTAMP))"

    return _DATE_TRUNC_COL_RE.sub(_wrap, query)


def get_multi_engine_query_service() -> "MultiEngineQueryService":
    """Process-wide singleton so query caches survive across chart refreshes."""
    global _multi_engine_service
    if _multi_engine_service is None:
        _multi_engine_service = MultiEngineQueryService()
    return _multi_engine_service


# --- API data source: response cache (TTL) and limits ---
API_RESPONSE_CACHE_TTL_SEC = 60
API_MAX_ROWS_DEFAULT = 100_000
API_RESPONSE_CACHE: Dict[str, Tuple[float, pd.DataFrame]] = {}
_api_cache_lock = asyncio.Lock()


def invalidate_api_response_cache(data_source_id: Optional[str] = None) -> None:
    """Invalidate cached API response for a source, or clear all if data_source_id is None."""
    global API_RESPONSE_CACHE
    if data_source_id is None:
        API_RESPONSE_CACHE.clear()
        logger.debug("API response cache cleared (all)")
    elif data_source_id in API_RESPONSE_CACHE:
        del API_RESPONSE_CACHE[data_source_id]
        logger.debug("API response cache invalidated for %s", data_source_id)


def invalidate_query_result_cache() -> None:
    """Clear cached SQL query results after access-control or RLS changes."""
    if _multi_engine_service is not None:
        _multi_engine_service.query_cache.clear()

    try:
        from src.core.cache import cache

        if not cache:
            return
        if cache.redis_client:
            keys = cache._scan_keys("qe:*")
            if keys:
                cache.redis_client.delete(*keys)
                logger.debug("Query execution Redis cache cleared (%s keys)", len(keys))
        fallback_keys = [
            key for key in cache.fallback_cache.keys() if str(key).startswith("qe:")
        ]
        for key in fallback_keys:
            del cache.fallback_cache[key]
    except Exception as exc:
        logger.debug("Query execution cache invalidation skipped: %s", exc)


class QueryEngine(Enum):
    """Supported query engines"""

    DUCKDB = "duckdb"
    CUBE = "cube"
    SPARK = "spark"
    DIRECT_SQL = "direct_sql"
    PANDAS = "pandas"


class QueryOptimizer:
    """Query optimization and engine selection"""

    @staticmethod
    def select_optimal_engine(
        query: str, data_size: int, complexity: str
    ) -> QueryEngine:
        """Select optimal query engine based on query characteristics"""

        # Normalize inputs to avoid TypeErrors when values are None or unexpected
        try:
            ds = int(data_size) if data_size is not None else 0
        except Exception:
            ds = 0
        comp = (complexity or "").lower()

        # Small datasets (< 1M rows) - prefer DuckDB for reliable SQL support
        # DuckDB is fast and supports full SQL so use it as the default for small/medium datasets
        if ds < 1_000_000:
            return QueryEngine.DUCKDB

        # Medium datasets (1M - 100M rows) - use DuckDB or Cube.js
        elif ds < 100_000_000:
            if "aggregation" in query.lower() or "group by" in query.lower():
                return QueryEngine.CUBE
            else:
                return QueryEngine.DUCKDB

        # Large datasets (> 100M rows) - use Spark
        else:
            return QueryEngine.SPARK


class MultiEngineQueryService:
    """Service for executing queries across multiple engines"""

    def __init__(self):
        # Instantiate lightweight engines eagerly; delay Spark engine until needed
        self.engines = {
            QueryEngine.DUCKDB: DuckDBEngine(),
            QueryEngine.CUBE: CubeEngine(),
            QueryEngine.DIRECT_SQL: DirectSQLEngine(),
            QueryEngine.PANDAS: PandasEngine(),
        }

        self.query_cache = {}
        self.cache_ttl = 1800  # 30 minutes — aggressive reuse for same query+source

    def _is_spark_available(self) -> bool:
        """Detect whether Spark (pyspark) and a Java runtime are available.

        This is a lightweight local check to avoid attempting to start Spark
        in environments where Java or pyspark are not installed.
        """
        try:
            # Check for pyspark package
            if importlib.util.find_spec("pyspark") is None:
                logger.debug("pyspark package not found")
                return False

            # Check for Java runtime or JAVA_HOME
            if shutil.which("java") is None and not ("JAVA_HOME" in __import__("os").environ):
                logger.debug("Java runtime not found and JAVA_HOME not set")
                return False

            return True
        except Exception as e:
            logger.debug(f"Spark availability check failed: {e}")
            return False

    async def _source_has_row_security(self, data_source_id: str) -> bool:
        """Whether this source has any active grant or row-filter policy.

        Sources that never opted into row security keep working without an
        identity; sources that did are never readable without one.
        """
        if not data_source_id:
            return False
        try:
            from sqlalchemy import select

            from src.db.session import async_session
            from src.modules.data.models import (
                DataSourceAccessGrant,
                DataSourceRLSPolicy,
            )

            async with async_session() as session:
                for model in (DataSourceRLSPolicy, DataSourceAccessGrant):
                    found = await session.execute(
                        select(model.id)
                        .where(
                            model.data_source_id == data_source_id,
                            model.is_active == True,  # noqa: E712
                            model.is_deleted == False,  # noqa: E712
                        )
                        .limit(1)
                    )
                    if found.scalar_one_or_none() is not None:
                        return True
            return False
        except Exception:
            # Unable to prove the source is unsecured, so treat it as secured.
            logger.exception(
                "Row-security probe failed for source %s; assuming secured",
                data_source_id,
            )
            return True

    async def _apply_sql_rls(self, query: str, **kwargs: Any) -> Tuple[str, bool]:
        """Thin seam over the EE enforcement service, opening its own session."""
        from ee.modules.data.services.data_source_rls_enforcement_service import (
            DataSourceRLSEnforcementService,
        )
        from src.db.session import async_session

        async with async_session() as session:
            return await DataSourceRLSEnforcementService.apply_sql_rls(
                query, session=session, **kwargs
            )

    async def _apply_sql_cls(self, query: str, **kwargs: Any) -> Tuple[str, List[str]]:
        """Thin seam over the EE enforcement service, opening its own session."""
        from ee.modules.data.services.data_source_cls_enforcement_service import (
            DataSourceCLSEnforcementService,
        )
        from src.db.session import async_session

        async with async_session() as session:
            return await DataSourceCLSEnforcementService.apply_sql_cls(
                query, session=session, **kwargs
            )

    async def _source_has_column_security(self, data_source_id: str) -> bool:
        """Whether this source has any active grant or column policy.

        Sources that never opted into column security keep working without an
        identity; sources that did are never readable without one.
        """
        if not data_source_id:
            return False
        try:
            from sqlalchemy import select

            from src.db.session import async_session
            from src.modules.data.models import (
                DataSourceAccessGrant,
                DataSourceCLSPolicy,
            )

            async with async_session() as session:
                for model in (DataSourceCLSPolicy, DataSourceAccessGrant):
                    found = await session.execute(
                        select(model.id)
                        .where(
                            model.data_source_id == data_source_id,
                            model.is_active == True,  # noqa: E712
                            model.is_deleted == False,  # noqa: E712
                        )
                        .limit(1)
                    )
                    if found.scalar_one_or_none() is not None:
                        return True
            return False
        except Exception:
            # Unable to prove the source is unsecured, so treat it as secured.
            logger.exception(
                "Column-security probe failed for source %s; assuming secured",
                data_source_id,
            )
            return True

    async def _enforce_column_security(
        self,
        query: str,
        data_source: Dict[str, Any],
        access: QueryAccess,
        dialect: Optional[str] = None,
    ) -> Tuple[str, List[str]]:
        """Return the query to run, with restricted columns masked or dropped.

        Raises RowSecurityIdentityRequired rather than returning ungoverned
        columns. CLS must run before RLS: it expands `SELECT *` against the
        base tables' schema, and RLS wraps those base tables in filtered
        subqueries that the qualifier can no longer see into.
        """
        if not is_ee_enabled() or not query:
            return query, []

        data_source_id = str(
            data_source.get("id") or data_source.get("data_source_id") or ""
        )

        if isinstance(access, SystemQuery):
            if await self._source_has_column_security(data_source_id):
                logger.warning(
                    "Unattributed read of column-secured source %s — reason: %s",
                    data_source_id,
                    access.reason,
                )
            return query, []

        if access is None:
            if await self._source_has_column_security(data_source_id):
                logger.error(
                    "Refusing to read column-secured source %s without an identity. "
                    "Pass QueryIdentity, or SystemQuery(reason=...) for a job.",
                    data_source_id,
                )
                raise RowSecurityIdentityRequired(
                    "This data source has column security configured, so the "
                    "query cannot run without knowing who is asking."
                )
            return query, []

        try:
            from ee.modules.data.services.rls_predicate_builder import resolve_dialect

            resolved = dialect or resolve_dialect(data_source)
        except Exception:
            resolved = dialect

        try:
            return await self._apply_sql_cls(
                query,
                user_id=access.user_id,
                data_source_id=data_source_id,
                organization_id=access.organization_id,
                project_id=access.project_id,
                dialect=resolved,
            )
        except RowSecurityIdentityRequired:
            raise
        except RowSecurityDenied:
            # A deliberate deny, not a failure to compute one. Reporting it as an
            # internal error would hide a correct decision behind a bug report.
            raise
        except Exception as exc:
            # A filter we could not compute must not degrade into "no filter".
            logger.exception(
                "Column-security enforcement failed for source %s", data_source_id
            )
            raise RowSecurityIdentityRequired(
                "Column security could not be applied to this query."
            ) from exc

    async def _enforce_row_security(
        self,
        query: str,
        data_source: Dict[str, Any],
        access: QueryAccess,
        dialect: Optional[str] = None,
    ) -> Tuple[str, bool]:
        """Return the query to run, filtered for whoever is asking.

        Raises RowSecurityIdentityRequired rather than returning unfiltered rows.
        """
        if not is_ee_enabled() or not query:
            return query, False

        data_source_id = str(
            data_source.get("id") or data_source.get("data_source_id") or ""
        )

        if isinstance(access, SystemQuery):
            if await self._source_has_row_security(data_source_id):
                logger.warning(
                    "Unattributed read of secured source %s — reason: %s",
                    data_source_id,
                    access.reason,
                )
            return query, False

        if access is None:
            if await self._source_has_row_security(data_source_id):
                logger.error(
                    "Refusing to read secured source %s without an identity. "
                    "Pass QueryIdentity, or SystemQuery(reason=...) for a job.",
                    data_source_id,
                )
                raise RowSecurityIdentityRequired(
                    "This data source has row security configured, so the query "
                    "cannot run without knowing who is asking."
                )
            return query, False

        try:
            from ee.modules.data.services.rls_predicate_builder import resolve_dialect

            resolved = dialect or resolve_dialect(data_source)
        except Exception:
            resolved = dialect

        try:
            return await self._apply_sql_rls(
                query,
                user_id=access.user_id,
                data_source_id=data_source_id,
                organization_id=access.organization_id,
                project_id=access.project_id,
                token_payload=dict(access.token_payload or {}),
                dialect=resolved,
            )
        except RowSecurityIdentityRequired:
            raise
        except RowSecurityDenied:
            # A deliberate deny, not a failure to compute one. Reporting it as an
            # internal error would hide a correct decision behind a bug report.
            raise
        except Exception as exc:
            # A filter we could not compute must not degrade into "no filter".
            logger.exception(
                "Row-security enforcement failed for source %s", data_source_id
            )
            raise RowSecurityIdentityRequired(
                "Row security could not be applied to this query."
            ) from exc

    async def execute_query(
        self,
        query: str,
        data_source: Dict[str, Any],
        engine: Optional[QueryEngine] = None,
        optimization: bool = True,
        allow_spark: bool = True,
        cache_context: Optional[Dict[str, Any]] = None,
        identity: QueryAccess = None,
    ) -> Dict[str, Any]:
        """Execute a query on behalf of ``identity``, with row security applied.

        This is the only entry point to the engines. The filter is applied here
        rather than by callers, so chat, dashboards, charts and the HTTP handlers
        cannot reach data by a route that skips it.
        """
        try:
            query, columns_omitted = await self._enforce_column_security(
                query, data_source, identity
            )
            query, rls_applied = await self._enforce_row_security(
                query, data_source, identity
            )
        except (RowSecurityIdentityRequired, RowSecurityDenied) as exc:
            return {
                "success": False,
                "error": str(exc),
                "data": [],
                "columns": [],
                "row_count": 0,
            }

        result = await self._execute_query_unfiltered(
            query,
            data_source,
            engine=engine,
            # A filtered query is user-specific; skip the optimizer's rewrites.
            optimization=False if rls_applied else optimization,
            allow_spark=allow_spark,
            cache_context=cache_context,
        )
        if rls_applied and isinstance(result, dict):
            result["rls_applied"] = True
        if columns_omitted and isinstance(result, dict):
            result["columns_omitted"] = columns_omitted
        return result

    async def _execute_query_unfiltered(
        self,
        query: str,
        data_source: Dict[str, Any],
        engine: Optional[QueryEngine] = None,
        optimization: bool = True,
        allow_spark: bool = True,
        cache_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Engine selection and execution. Never call this directly — it does no
        access checking; ``execute_query`` is the guarded entry point."""
        try:
            logger.info(f"🔍 Executing query with optimization: {optimization}")
            # Org/Project scoped cache (Redis-backed if available) in addition to in-memory TTL cache
            from src.core.cache import cache

            cache_key_scoped = None
            try:
                cache_context = cache_context or {}
                scope = {
                    "org": cache_context.get("organization_id")
                    or data_source.get("organization_id")
                    or "",
                    "proj": cache_context.get("project_id")
                    or data_source.get("project_id")
                    or "",
                }
                engine_tag = engine.value if engine else "auto"
                key_payload = json.dumps(
                    {
                        "scope": scope,
                        "cache_context": cache_context,
                        "source": data_source.get("id")
                        or data_source.get("data_source_id")
                        or "",
                        "engine": engine_tag,
                        "optimization": optimization,
                        "query": query,
                    },
                    sort_keys=True,
                )
                import hashlib as _hash

                cache_key_scoped = f"qe:{_hash.md5(key_payload.encode()).hexdigest()}"
                scoped_cached = cache.get(cache_key_scoped) if cache else None
                if optimization and scoped_cached is not None:
                    logger.info("✅ Returning Redis-scoped cached result")
                    return {**scoped_cached, "cached": True}
            except Exception:
                cache_key_scoped = None

            # Prometheus / PromQL: not SQL — route before analysis and file-rewrite logic
            if self._data_source_db_type(data_source) == "prometheus_source":
                return await self._execute_prometheus_query_path(
                    query, data_source, cache_key_scoped, optimization
                )

            # Analyze query and data source
            query_analysis = self._analyze_query(query, data_source)

            # CRITICAL: For file/sheet uploads (DuckDB single-table), validate and optionally rewrite table names
            # Support naming conventions:
            # 1. 'data' - backward compatible, single file
            # 2. 'file_XXXXX' - multi-file support, each file as separate table
            # 3. Sheet/table names from multi-sheet Excel/CSV (stored in schema.duckdb_tables)
            #    Keys = logical names (e.g. "dim_customer"), Values = actual DuckDB names (e.g. "sheet_1_dim_customer")
            # 4. Unrelated tables - rewrite to 'data' for backward compat (fallback)
            if is_file_upload_duckdb(data_source.get("type"), data_source.get("format")):
                import re
                rewritten_query, rewrite_error, rewritten_refs = rewrite_file_duckdb_table_refs(query, data_source)
                if rewrite_error:
                    return {"success": False, "error": rewrite_error}
                if rewritten_query != query:
                    logger.info(
                        "✅ Normalized DuckDB file table refs %s:\nOriginal: %s\nRewritten: %s",
                        rewritten_refs,
                        query,
                        rewritten_query,
                    )
                    query_analysis["original_query"] = query
                    query = rewritten_query
                # Build lookup: bare_logical_name (lower) → actual DuckDB table name
                _ds_schema = data_source.get("schema") or {}
                _duckdb_tables_map = _ds_schema.get("duckdb_tables") or {}
                # Keys are logical names users/queries reference; values are actual DuckDB table names
                _logical_to_duckdb: dict = {
                    str(k).lower(): str(v) for k, v in _duckdb_tables_map.items() if k and v
                }
                # Also include direct DuckDB table names as valid (already registered)
                _direct_duckdb_names: set = set(str(v).lower() for v in _duckdb_tables_map.values() if v)
                # Accept names listed in the tables[] array as logical names too
                for _t in (_ds_schema.get("tables") or []):
                    if isinstance(_t, dict) and _t.get("name"):
                        _k = str(_t["name"]).lower()
                        if _k not in _logical_to_duckdb:
                            # No duckdb_tables mapping — assume name is used directly
                            _logical_to_duckdb[_k] = _t["name"]

                # Older Excel uploads may have a multi-sheet schema but a compressed
                # single-table Parquet object in storage. In that case only the first
                # sheet/fact table is actually loadable as DuckDB's `data` table.
                _storage_format = ""
                if isinstance(_ds_schema, dict):
                    _storage_format = str(((_ds_schema.get("storage") or {}).get("format") or "")).lower()
                if _storage_format == "parquet" and _duckdb_tables_map:
                    _primary_physical = str(_ds_schema.get("table_name") or "")
                    _logical_to_duckdb = {
                        str(logical).lower(): "data"
                        for logical, physical in _duckdb_tables_map.items()
                        if str(physical) == _primary_physical
                    }
                    _direct_duckdb_names = {"data"}
                    _unavailable_logical_tables = {
                        str(logical).lower()
                        for logical, physical in _duckdb_tables_map.items()
                        if str(physical) != _primary_physical
                    }
                else:
                    _unavailable_logical_tables = set()

                # Pattern to match: FROM "table" or FROM table or FROM "schema"."table"
                table_pattern = r'(?i)(from|join)\s+(?:"([^"]+)"|`([^`]+)`|([a-zA-Z0-9_\.]+))'
                matches = list(re.finditer(table_pattern, query))
                table_names_found = []        # unknown → rewrite to 'data'
                schema_translate_needed = []  # (full_ref, target_name, keyword) to normalise
                unavailable_tables_found = []
                for match in matches:
                    table_name = match.group(2) or match.group(3) or match.group(4)
                    keyword = match.group(1).upper()
                    if not table_name:
                        continue
                    # Strip schema prefix for lookup (e.g. "public.dim_customer" → "dim_customer")
                    bare_name = table_name.split(".")[-1] if "." in table_name else table_name

                    if table_name.lower() in ("data", "_aiser_inline_df") or table_name.lower().startswith("file_"):
                        # Already a valid DuckDB name — leave as-is
                        continue
                    elif bare_name.lower() in _unavailable_logical_tables:
                        unavailable_tables_found.append(bare_name)
                    elif bare_name.lower() in _logical_to_duckdb:
                        # Logical name → translate to actual DuckDB table name
                        target = _logical_to_duckdb[bare_name.lower()]
                        schema_translate_needed.append((table_name, target, keyword, match.start(), match.end()))
                    elif bare_name.lower() in _direct_duckdb_names:
                        # Direct DuckDB name but schema-qualified — just strip prefix
                        if "." in table_name:
                            schema_translate_needed.append((table_name, bare_name, keyword, match.start(), match.end()))
                    else:
                        # Unknown table — rewrite to 'data' for backward compat
                        table_names_found.append((table_name, keyword, match.start(), match.end()))

                if unavailable_tables_found:
                    unavailable = sorted(set(unavailable_tables_found))
                    primary = next(iter(_logical_to_duckdb.keys()), "data")
                    return {
                        "success": False,
                        "error": (
                            "Related table(s) "
                            f"{', '.join(unavailable)} are present in the schema/model but not in the stored "
                            f"compressed Parquet payload. Only {primary} is available at query time. "
                            "Re-upload or refresh the original multi-sheet workbook so relationship joins can run."
                        ),
                    }

                # Translate/normalise known table references
                if schema_translate_needed:
                    try:
                        import re as _re
                        rewritten = query
                        for full_ref, target_name, keyword, start, end in reversed(schema_translate_needed):
                            segment = query[start:end]
                            if '"' in segment:
                                pattern = rf'(?i)({keyword})\s+"{_re.escape(full_ref)}"'
                            else:
                                pattern = rf'(?i)({keyword})\s+{_re.escape(full_ref)}\b'
                            replacement = f'{keyword} "{target_name}"'
                            rewritten = _re.sub(pattern, replacement, rewritten)
                        if rewritten != query:
                            logger.info(f"✅ Translated table refs for DuckDB:\nOriginal: {query}\nRewritten: {rewritten}")
                            query_analysis['original_query'] = query
                            query = rewritten
                    except Exception as _e:
                        logger.error(f"❌ Failed to translate table refs: {_e}", exc_info=True)

                if table_names_found:
                    # Rewrite query to use 'data' table
                    logger.warning(f"🔄 File data source detected - rewriting table name(s) {[t[0] for t in table_names_found]} to 'data'")
                    try:
                        import re as _re
                        rewritten = query
                        # Replace in reverse order to preserve positions
                        for table_name, keyword, start, end in reversed(table_names_found):
                            # Match the entire FROM/JOIN clause with the table name
                            # Handle all quote styles: "table", `table`, or unquoted table
                            # More robust pattern that handles all cases
                            if '"' in query[start:end]:
                                # Double-quoted identifier
                                pattern = rf'(?i)({keyword})\s+"{_re.escape(table_name)}"'
                                replacement = f'{keyword} "data"'
                            elif '`' in query[start:end]:
                                # Backtick-quoted identifier
                                pattern = rf'(?i)({keyword})\s+`{_re.escape(table_name)}`'
                                replacement = f'{keyword} "data"'
                            else:
                                # Unquoted identifier - use word boundary
                                pattern = rf'(?i)({keyword})\s+{_re.escape(table_name)}\b'
                                replacement = f'{keyword} "data"'

                            rewritten = _re.sub(pattern, replacement, rewritten)

                        if rewritten != query:
                            logger.info(f"✅ Rewritten query for file data source:\nOriginal: {query}\nRewritten: {rewritten}")
                            query_analysis['original_query'] = query
                            query = rewritten
                            query_analysis['note'] = f"Query table name(s) {[t[0] for t in table_names_found]} rewritten to 'data' for file data source"
                        else:
                            logger.warning(f"⚠️ Query rewriting didn't change query - pattern might not match")
                    except Exception as _e:
                        logger.error(f"❌ Failed to rewrite query table name: {_e}", exc_info=True)
                        # Don't fail the query, but log the error for debugging

            # Select engine if not specified
            if not engine:
                engine = QueryOptimizer.select_optimal_engine(
                    query, query_analysis["data_size"], query_analysis["complexity"]
                )
            
            _ds_type = (data_source.get("type") or "").lower()
            _ds_db_type = (data_source.get("db_type") or "").lower()
            _is_duckdb_source = uses_duckdb_for_execution(_ds_type, _ds_db_type)
            _is_api_source = is_single_table_source(_ds_type) and _ds_type not in ("file", "csv", "excel", "parquet")

            # Route file/DuckDB/sample_duckdb sources to DuckDB engine (not Direct SQL)
            if _is_duckdb_source:
                if engine == QueryEngine.DIRECT_SQL:
                    logger.info("DuckDB-backed source (%s) detected; switching from Direct SQL to DuckDB engine", _ds_type)
                    engine = QueryEngine.DUCKDB
                elif engine == QueryEngine.CUBE:
                    logger.info("DuckDB-backed source (%s) detected; switching from Cube.js to DuckDB engine", _ds_type)
                    engine = QueryEngine.DUCKDB

            # Route API sources to Pandas: API data is fetched via HTTP, not in a DuckDB catalog
            elif _is_api_source:
                if engine in (QueryEngine.DIRECT_SQL, QueryEngine.CUBE, QueryEngine.DUCKDB):
                    logger.info("API data source detected; using Pandas engine (fetch from API then run SQL)")
                    engine = QueryEngine.PANDAS

            # Remote database/warehouse: prefer Direct SQL over DuckDB
            elif engine == QueryEngine.DUCKDB and not _is_duckdb_source:
                logger.info("DuckDB selected but data source is a remote database; switching to Direct SQL engine for safety")
                engine = QueryEngine.DIRECT_SQL

            # Plan gate: auto (or explicit) Spark must not run when the org is not entitled
            if engine == QueryEngine.SPARK and not allow_spark:
                logger.info(
                    "Spark engine was selected but is not allowed for this caller; downgrading to a non-Spark engine"
                )
                if _is_duckdb_source:
                    engine = QueryEngine.DUCKDB
                elif _is_api_source:
                    engine = QueryEngine.PANDAS
                else:
                    engine = QueryEngine.DIRECT_SQL

            # remember selected engine value for error handling (set early so except block can use it)
            selected_engine_value = engine.value if engine else "unknown"
            logger.info(f"🎯 Selected engine: {selected_engine_value}")

            # Check cache first
            cache_key = self._generate_cache_key(
                query,
                data_source,
                engine,
                cache_context=cache_context,
            )
            if optimization and cache_key in self.query_cache:
                cached_result = self.query_cache[cache_key]
                try:
                    ts = cached_result.get("timestamp")
                    if ts is not None and isinstance(ts, (int, float)):
                        if datetime.now().timestamp() - ts < self.cache_ttl:
                            logger.info("✅ Returning cached result")
                            return {
                                "success": True,
                                "data": cached_result.get("data"),
                                "engine": engine.value,
                                "cached": True,
                                "execution_time": 0.001,
                            }
                except Exception:
                    # Ignore cache errors and continue
                    logger.warning("Cache entry invalid or expired; ignoring cached result")

            # Ensure Spark engine is instantiated lazily to avoid import/startup costs
            if engine == QueryEngine.SPARK:
                # Check availability before instantiating
                if not self._is_spark_available():
                    msg = (
                        "Spark engine requested but Spark (pyspark/Java) is not available in this environment. "
                        "Configure Spark cluster or set JAVA_HOME and install pyspark."
                    )
                    logger.error(msg)
                    return {"success": False, "error": msg, "engine": "spark"}
                if QueryEngine.SPARK not in self.engines:
                    self.engines[QueryEngine.SPARK] = SparkEngine()

            # Execute query
            start_time = datetime.now()
            result = await self.engines[engine].execute(query, data_source, query_analysis)
            execution_time = (datetime.now() - start_time).total_seconds()

            # Cache result if optimization is enabled
            if optimization and result["success"]:
                self.query_cache[cache_key] = {
                    "data": result["data"],
                    "timestamp": datetime.now().timestamp(),
                }
                # Persist to Redis-scoped cache with TTL
                try:
                    if cache_key_scoped and cache:
                        cache.set(cache_key_scoped, result, ttl=self.cache_ttl)
                except Exception:
                    pass

            result.update(
                {
                    "engine": engine.value,
                    "execution_time": execution_time,
                    "query_analysis": query_analysis,
                }
            )

            logger.info(
                f"✅ Query executed successfully in {execution_time:.2f}s using {engine.value}"
            )
            return result

        except Exception as e:
            logger.error(f"❌ Multi-engine query execution failed: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "engine": selected_engine_value if 'selected_engine_value' in locals() else (engine.value if engine else "unknown"),
            }

    async def execute_parallel_queries(
        self,
        queries: List[Dict[str, Any]],
        data_source: Dict[str, Any],
        identity: QueryAccess = None,
    ) -> List[Dict[str, Any]]:
        """Execute multiple queries in parallel across different engines"""
        try:
            logger.info(f"🚀 Executing {len(queries)} queries in parallel")

            # Create tasks for parallel execution
            tasks = []
            for query_info in queries:
                query = query_info["query"]
                engine = QueryEngine(query_info.get("engine", "auto"))

                task = self.execute_query(query, data_source, engine, identity=identity)
                tasks.append(task)

            # Execute all queries in parallel
            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Process results
            processed_results = []
            for i, result in enumerate(results):
                if isinstance(result, Exception):
                    processed_results.append(
                        {"success": False, "error": str(result), "query_index": i}
                    )
                else:
                    result["query_index"] = i
                    processed_results.append(result)

            logger.info(
                f"✅ Parallel query execution completed: {len(processed_results)} results"
            )
            return processed_results

        except Exception as e:
            logger.error(f"❌ Parallel query execution failed: {str(e)}")
            return [{"success": False, "error": str(e)} for _ in queries]

    async def execute_batch(
        self,
        sqls: List[str],
        data_source: Dict[str, Any],
        engine: Optional[QueryEngine] = None,
        optimization: bool = True,
        identity: QueryAccess = None,
    ) -> List[Dict[str, Any]]:
        """
        Execute multiple SQL statements sequentially.
        Used by multi_query_execution_node and mode_query_planner flows.
        Returns list of result dicts (same shape as execute_query).
        """
        results: List[Dict[str, Any]] = []
        for i, sql in enumerate(sqls):
            if not sql or not str(sql).strip():
                results.append({"success": False, "error": "empty_sql", "query_index": i})
                continue
            try:
                r = await self.execute_query(
                    query=str(sql),
                    data_source=data_source,
                    engine=engine,
                    optimization=optimization,
                    identity=identity,
                )
                r["query_index"] = i
                results.append(r)
            except Exception as e:
                logger.warning(f"execute_batch query {i} failed: {e}")
                results.append({"success": False, "error": str(e), "query_index": i})
        return results

    async def execute_cube_query(
        self,
        cube_query: Dict[str, Any],
        data_source: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a Cube.js JSON query payload through the Cube engine."""
        engine = self.engines.get(QueryEngine.CUBE)
        if not engine:
            return {"success": False, "error": "Cube.js engine not initialized"}
        if not hasattr(engine, "execute_cube_query"):
            return {"success": False, "error": "Cube.js engine does not support JSON queries"}
        return await engine.execute_cube_query(cube_query, data_source)

    def _analyze_query(self, query: str, data_source: Dict[str, Any]) -> Dict[str, Any]:
        """Analyze query characteristics for optimization"""
        query_lower = query.lower()

        analysis = {
            "data_size": data_source.get("row_count", 0),
            "complexity": "simple",
            "has_joins": "join" in query_lower,
            "has_aggregations": any(
                op in query_lower
                for op in ["sum", "count", "avg", "max", "min", "group by"]
            ),
            "has_subqueries": "select" in query_lower
            and query_lower.count("select") > 1,
            "has_window_functions": any(
                func in query_lower
                for func in ["row_number", "rank", "dense_rank", "over"]
            ),
            "estimated_complexity": "simple",
        }

        # Calculate complexity score
        complexity_score = 0
        if analysis["has_joins"]:
            complexity_score += 2
        if analysis["has_aggregations"]:
            complexity_score += 1
        if analysis["has_subqueries"]:
            complexity_score += 3
        if analysis["has_window_functions"]:
            complexity_score += 2

        if complexity_score >= 5:
            analysis["complexity"] = "complex"
            analysis["estimated_complexity"] = "complex"
        elif complexity_score >= 2:
            analysis["complexity"] = "medium"
            analysis["estimated_complexity"] = "medium"

        return analysis

    @staticmethod
    def _data_source_db_type(data_source: Dict[str, Any]) -> str:
        cc = data_source.get("connection_config") or data_source.get("config") or {}
        if isinstance(cc, str):
            try:
                cc = json.loads(cc)
            except Exception:
                cc = {}
        if not isinstance(cc, dict):
            cc = {}
        return (
            data_source.get("db_type")
            or data_source.get("format")
            or cc.get("type")
            or ""
        ).lower()

    async def _execute_prometheus_query_path(
        self,
        query: str,
        data_source: Dict[str, Any],
        cache_key_scoped: Optional[str],
        optimization: bool,
    ) -> Dict[str, Any]:
        """Run PromQL via Prometheus HTTP API; tabular result for charts/SQL consumers."""
        from src.core.cache import cache
        from ee.modules.data.services.enterprise_connectors_service import (
            ConnectionConfig,
            ConnectorType,
            EnterpriseConnectorsService,
        )

        q = (query or "").strip()
        if not q:
            return {"success": False, "error": "Empty PromQL query", "engine": "prometheus"}

        cc = data_source.get("connection_config") or data_source.get("config") or {}
        if isinstance(cc, str):
            try:
                cc = json.loads(cc)
            except Exception:
                cc = {}
        meta = dict(cc) if isinstance(cc, dict) else {}
        url = (meta.get("prometheus_url") or meta.get("prometheusUrl") or "").strip()
        if not url:
            return {
                "success": False,
                "error": "Prometheus data source is missing prometheus_url in connection config",
                "engine": "prometheus",
            }
        merged = {**meta, "prometheus_url": url.rstrip("/")}
        config = ConnectionConfig(
            connector_type=ConnectorType.PROMETHEUS_SOURCE,
            name=data_source.get("name") or "prometheus",
            host=str(meta.get("host") or ""),
            port=meta.get("port"),
            metadata=merged,
        )
        svc = EnterpriseConnectorsService()
        start_time = datetime.now()
        pr = await svc._execute_prometheus_query(config, q)
        execution_time = (datetime.now() - start_time).total_seconds()
        if not pr.get("success"):
            return {
                "success": False,
                "error": pr.get("error") or "Prometheus query failed",
                "engine": "prometheus",
                "execution_time": execution_time,
            }
        result = {
            "success": True,
            "data": pr.get("data") or [],
            "columns": pr.get("columns") or [],
            "row_count": pr.get("row_count", len(pr.get("data") or [])),
            "engine": "prometheus",
            "execution_time": execution_time,
            "query_analysis": {"complexity": "promql", "data_size": len(pr.get("data") or [])},
        }
        if optimization and cache_key_scoped and cache:
            try:
                cache.set(cache_key_scoped, result, ttl=self.cache_ttl)
            except Exception:
                pass
        return result

    def _generate_cache_key(
        self,
        query: str,
        data_source: Dict[str, Any],
        engine: QueryEngine,
        cache_context: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Generate cache key for query result"""
        import hashlib

        key_payload = json.dumps(
            {
                "query": query,
                "source": data_source.get("id", ""),
                "engine": engine.value,
                "cache_context": cache_context or {},
            },
            sort_keys=True,
            default=str,
        )
        return hashlib.md5(key_payload.encode()).hexdigest()


class BaseQueryEngine:
    """Base class for query engines"""

    async def execute(
        self, query: str, data_source: Dict[str, Any], analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute query - to be implemented by subclasses"""
        raise NotImplementedError


class DuckDBEngine(BaseQueryEngine):
    """DuckDB engine for fast analytical queries"""

    def __init__(self):
        self.connection = None

    async def execute(
        self, query: str, data_source: Dict[str, Any], analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute query using DuckDB"""
        import re  # bind at method entry so read-only check and DATE_TRUNC/sub use it
        google_sheets_temp_path: Optional[str] = None
        try:
            logger.info("🦆 Executing query with DuckDB")
            logger.info(f"🦆 Query: {query[:300]}...")

            # Create DuckDB connection (in-memory for file/sample_duckdb path, or attach sample DB)
            conn = None
            if data_source.get("type") == "sample_duckdb":
                from src.shared.sample_data.generate_duckdb import resolve_sample_duckdb_path
                sample_path = resolve_sample_duckdb_path()
                if sample_path:
                    conn = duckdb.connect(sample_path, read_only=True)
                    logger.info("🦆 Connected to sample DuckDB at %s", sample_path)
                    # Set search_path to domain schema so unqualified table names resolve (e.g. workspaces -> saas.workspaces)
                    config = data_source.get("connection_config") or data_source.get("config") or {}
                    if isinstance(config, str):
                        try:
                            import json
                            config = json.loads(config)
                        except Exception:
                            config = {}
                    domain = (config.get("domain") or "banking").strip().lower()
                    if domain and domain.replace("_", "").isalnum():
                        try:
                            conn.execute(f'SET search_path TO "{domain}"')
                            logger.info("🦆 Set DuckDB search_path to %s", domain)
                        except Exception as sp_err:
                            logger.debug("Set search_path skipped: %s", sp_err)
                else:
                    conn = duckdb.connect()
                    logger.warning("⚠️ SAMPLE_DATA_DUCKDB_PATH not set or file missing; sample_duckdb will have no data")
            else:
                conn = duckdb.connect()

            # CRITICAL: Enforce read-only mode for safety
            logger.debug("🔒 DuckDB connection created (read-only enforced via query validation)")

            # Load data into DuckDB
            google_sheets_temp_path = None
            if data_source.get("type") == "google_sheets":
                # Google Sheets: fetch CSV via public export URL and load into DuckDB. No blob storage needed.
                try:
                    config = data_source.get("connection_config") or {}
                    if isinstance(config, str):
                        try:
                            config = json.loads(config)
                        except json.JSONDecodeError:
                            config = {}
                    sheet_url = (config.get("sheet_url") or "").strip()
                    if not sheet_url:
                        raise ValueError("google_sheets requires connection_config.sheet_url")
                    id_match = re.search(r"/d/([a-zA-Z0-9_-]+)", sheet_url)
                    if not id_match:
                        raise ValueError("Invalid Google Sheet URL: could not extract spreadsheet ID")
                    sheet_id = id_match.group(1)
                    cfg_gid = config.get("gid")
                    if cfg_gid is not None and str(cfg_gid).strip() != "":
                        gid = str(cfg_gid).strip()
                    else:
                        gid_match = re.search(r"[?#&]gid=(\d+)", sheet_url, re.IGNORECASE)
                        gid = gid_match.group(1) if gid_match else "0"
                    export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv&gid={gid}"
                    async with aiohttp.ClientSession() as session:
                        async with session.get(export_url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                            if resp.status != 200:
                                raise ValueError(f"Google Sheets export returned {resp.status}")
                            body = await resp.text()
                    if not body or not body.strip():
                        raise ValueError("Google Sheet export returned empty content")
                    import tempfile
                    with tempfile.NamedTemporaryFile(mode="w", delete=False, suffix=".csv", encoding="utf-8") as tmp:
                        tmp.write(body)
                        google_sheets_temp_path = tmp.name
                    # Load directly into DuckDB (do not use _load_file_data — that expects blob/sample_data)
                    safe_path = google_sheets_temp_path.replace("'", "''")
                    conn.execute(f"CREATE TABLE data AS SELECT * FROM read_csv_auto('{safe_path}')")
                    logger.info("✅ Loaded Google Sheet into DuckDB from CSV export")
                except Exception as e:
                    logger.warning("Failed to load Google Sheet: %s", e)
                    if google_sheets_temp_path and os.path.exists(google_sheets_temp_path):
                        try:
                            os.unlink(google_sheets_temp_path)
                        except Exception:
                            pass
                        google_sheets_temp_path = None
                    raise
            elif is_file_upload_duckdb(data_source.get("type"), data_source.get("format")):
                # MULTI-FILE SUPPORT: Detect if query references multiple files and load them all
                detected_file_ids = self._detect_file_references(query)
                logger.info(f"🔍 Detected file references in query: {detected_file_ids}")
                
                # Prepare list of files to load:
                # 1. Current data_source (always included)
                # 2. Any additional files detected in query
                primary_file_id = data_source.get('id', 'data')
                files_to_load = {primary_file_id: data_source}
                
                # If query references additional files, we'd load them here.
                # Today only the primary upload is loaded; extra file_* ids are not fetched from storage yet.
                # Load the current (primary) file
                await self._load_file_data(conn, data_source)
                
                # IMPORTANT: Create an alias for multi-file support
                # Allow queries to reference table by file_id (e.g., file_1765031881)
                if primary_file_id and primary_file_id != 'data':
                    try:
                        # Create a view with the file_id as table name (for multi-file queries)
                        conn.execute(f'CREATE OR REPLACE VIEW "{primary_file_id}" AS SELECT * FROM "data"')
                        logger.info(f"✅ Created table alias '{primary_file_id}' pointing to 'data' table")
                    except Exception as e:
                        logger.warning(f"⚠️ Could not create file_id alias: {e}")
                
                # Verify table exists and has data
                try:
                    test_result = conn.execute("SELECT COUNT(*) as count FROM data LIMIT 1").fetchone()
                    row_count = test_result[0] if test_result else 0
                    logger.info(f"✅ Verified 'data' table exists with {row_count} rows")
                    if row_count == 0:
                        logger.warning("⚠️ 'data' table is empty - query may return no results")
                except Exception as verify_error:
                    logger.error(f"❌ Failed to verify 'data' table: {verify_error}")
                    raise Exception(f"Data table not loaded properly: {verify_error}")
            elif data_source.get("type") == "sample_duckdb":
                # Data already in attached DB; no load step. Schema is e.g. banking, education from config.domain
                pass
            elif data_source["type"] == "database":
                await self._load_database_data(conn, data_source)

            # CRITICAL: Validate query for read-only safety (prevent DDL/DML operations)
            # Only block when keyword is in command position (preceded by ^ or non-identifier), not inside identifiers like last_updated, created_at
            query_upper = query.upper().strip()
            dangerous_keywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE']
            # Command position: keyword must be preceded by start/whitespace/comma/semicolon/open-paren (not letter/digit/underscore)
            cmd_pos_pattern = r'(?:^|[\s,;(])(' + '|'.join(re.escape(k) for k in dangerous_keywords) + r')(?:\s|[;(),]|$)'
            if re.search(cmd_pos_pattern, query_upper):
                logger.error(f"❌ Blocked dangerous query operation: {query[:200]}")
                return {
                    "success": False,
                    "error": "Read-only mode: DDL/DML operations are not allowed. Only SELECT queries are permitted."
                }
            
            # CRITICAL: Fix truncated date_trunc before execution (e.g. date_trunc('MONTH) missing quote + second arg)
            try:
                from src.modules.ai.utils.sql_cleaner import repair_truncated_date_trunc
                schema = (analysis.get("schema") if isinstance(analysis, dict) else None) or data_source.get("schema")
                query = repair_truncated_date_trunc(query, schema=schema)
            except Exception as _e:
                logger.debug("repair_truncated_date_trunc skipped: %s", _e)

            # CRITICAL: DuckDB uses date_trunc (lowercase) but PostgreSQL uses DATE_TRUNC
            # Convert DATE_TRUNC to date_trunc for DuckDB compatibility
            duckdb_query = query
            if 'DATE_TRUNC' in query.upper():
                # Replace DATE_TRUNC with date_trunc (DuckDB function name) - use module-level re
                duckdb_query = re.sub(r'DATE_TRUNC\s*\(', 'date_trunc(', query, flags=re.IGNORECASE)
                if duckdb_query != query:
                    logger.info(f"🔄 Converted DATE_TRUNC to date_trunc for DuckDB compatibility")

            # CRITICAL: file-backed sources store date columns as VARCHAR, so
            # date_trunc(grain, col) errors with date_trunc(VARCHAR, VARCHAR).
            # Cast the date argument so time-series widgets render instead of
            # being dropped to the heuristic fallback.
            _casted = cast_date_trunc_args_for_duckdb(duckdb_query)
            if _casted != duckdb_query:
                logger.info("🔄 Wrapped date_trunc date arg in TRY_CAST(... AS TIMESTAMP) for DuckDB")
                duckdb_query = _casted
            
            # CRITICAL: Convert ClickHouse SUBSTRING syntax to DuckDB syntax
            # ClickHouse: SUBSTRING("Email" FROM "@" + 1)
            # DuckDB: SUBSTRING("Email", POSITION('@' IN "Email") + 1)
            if 'SUBSTRING' in duckdb_query and ' FROM ' in duckdb_query:
                # Handle: SUBSTRING(col FROM pattern + offset)
                # Convert to: SUBSTRING(col, POSITION(pattern IN col) + offset)
                import re as regex
                # Pattern: SUBSTRING("col" FROM "pattern" + offset)
                substring_pattern = r'SUBSTRING\s*\(([^,]+?)\s+FROM\s+(".*?"\(.*?\))\s*\)'
                duckdb_query = regex.sub(substring_pattern, r'SUBSTRING(\1, POSITION(\2)', duckdb_query, flags=regex.IGNORECASE)
                
                # Also handle simpler cases: SUBSTRING(col FROM num)
                simple_pattern = r'SUBSTRING\s*\(([^,]+?)\s+FROM\s+(\d+)\s*\)'
                duckdb_query = regex.sub(simple_pattern, r'SUBSTRING(\1, \2)', duckdb_query, flags=regex.IGNORECASE)
                
                if duckdb_query != query:
                    logger.info(f"🔄 Converted ClickHouse SUBSTRING to DuckDB SUBSTRING syntax")
            
            # CRITICAL: DuckDB/Postgres use double quotes for identifiers and single quotes for literals.
            # AI often uses double quotes for strings like WHERE col = "value".
            # We fix this by replacing "value" with 'value' in simple WHERE clauses if it doesn't match a column name.
            try:
                # 1. Get available columns to avoid replacing actual column references
                available_cols = []
                try:
                    desc_res = conn.execute("DESCRIBE data").fetchall()
                    available_cols = [r[0].lower() for r in desc_res]
                except Exception:
                    pass

                # 2. Match double-quoted strings in common filter patterns: =, !=, <, >, <=, >=, LIKE, ILIKE.
                # Do not rewrite quoted table qualifiers in expressions like "table"."column".
                filter_pattern = r'(?i)(=|!=|<>|<|>|<=|>=|LIKE|ILIKE)\s*"([^"]+)"(?!\s*\.)'
                
                def fix_quoted_literal(match):
                    op = match.group(1)
                    val = match.group(2)
                    # If the value inside quotes is NOT a known column, it's likely a string literal
                    if val.lower() not in available_cols:
                        safe_val = val.replace("'", "''")
                        return f"{op} '{safe_val}'"
                    return match.group(0) # Keep as is (likely a column reference)

                duckdb_query = re.sub(filter_pattern, fix_quoted_literal, duckdb_query)
            except Exception as e:
                logger.debug(f"Failed to auto-fix double-quoted literals: {e}")
            
            # Execute query
            try:
                result = conn.execute(duckdb_query).fetchall()
                # Get column names from the result description
                columns = []
                if conn.description:
                    columns = [desc[0] for desc in conn.description]
                elif result and len(result) > 0:
                    # Fallback: infer columns from first row if description not available
                    first_row = result[0]
                    if isinstance(first_row, dict):
                        columns = list(first_row.keys())
                    elif isinstance(first_row, (list, tuple)):
                        # Try to get column names from query if possible (use module-level re)
                        select_match = re.search(r'select\s+(.+?)\s+from', duckdb_query, re.IGNORECASE)
                        if select_match:
                            select_clause = select_match.group(1)
                            # Parse column names from SELECT clause
                            cols = [c.strip().split(' AS ')[-1].strip().strip('"').strip("'") 
                                   for c in select_clause.split(',')]
                            columns = cols[:len(first_row)] if cols else [f'column_{i}' for i in range(len(first_row))]
                        else:
                            columns = [f'column_{i}' for i in range(len(first_row))]
            except Exception as query_error:
                logger.error(f"❌ DuckDB query execution error: {str(query_error)}")
                logger.error(f"❌ Query: {duckdb_query}")
                logger.error(f"❌ Original query: {query}")
                raise

            # Convert to list of dictionaries
            data = [dict(zip(columns, row)) for row in result]

            conn.close()
            # Clean up Google Sheets temp file if used
            if google_sheets_temp_path and os.path.exists(google_sheets_temp_path):
                try:
                    os.unlink(google_sheets_temp_path)
                except Exception as cleanup_err:
                    logger.debug("Failed to remove Google Sheets temp file: %s", cleanup_err)

            out = {
                "success": True,
                "data": data,
                "columns": columns,
                "row_count": len(data),
            }
            if data_source.get("analysis_based_on_sample_only"):
                out["analysis_based_on_sample_only"] = True
                out["analysis_based_on_sample_only_message"] = data_source.get(
                    "analysis_based_on_sample_only_message",
                    "Full file could not be loaded; analysis is based on a sample.",
                )
            return out

        except Exception as e:
            # Clean up Google Sheets temp file on error
            if google_sheets_temp_path and os.path.exists(google_sheets_temp_path):
                try:
                    os.unlink(google_sheets_temp_path)
                except Exception:
                    pass
            logger.error(f"❌ DuckDB query execution failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def _load_excel_all_sheets_into_duckdb(
        self, conn: duckdb.DuckDBPyConnection, tmp_path: str, schema: Dict[str, Any]
    ) -> None:
        """
        Load all Excel sheets into the execution DuckDB. Creates one table per sheet
        (sheet_0_Sheet1, etc.) and a view 'data' on the first sheet for backward compatibility.
        """
        import re
        import pandas as pd
        duckdb_tables = schema.get("duckdb_tables") if isinstance(schema, dict) else {}
        try:
            xl = pd.ExcelFile(tmp_path, engine="openpyxl")
            sheet_names = xl.sheet_names
        except Exception as e:
            logger.warning(f"Could not read Excel sheet names: {e}, using first sheet only")
            df = pd.read_excel(tmp_path, engine="openpyxl", sheet_name=0)
            df = df.replace({pd.NA: None, pd.NaT: None})
            conn.register("_excel_df", df)
            conn.execute("CREATE TABLE data AS SELECT * FROM _excel_df")
            return
        first_sheet_table = None
        for idx, sheet in enumerate(sheet_names):
            try:
                df = pd.read_excel(tmp_path, engine="openpyxl", sheet_name=sheet)
                df = df.replace({pd.NA: None, pd.NaT: None})
                df = df.where(pd.notnull(df), None)
                # Use name from schema if available, else same pattern as upload
                if isinstance(duckdb_tables, dict) and sheet in duckdb_tables:
                    table_name = duckdb_tables[sheet]
                else:
                    safe = re.sub(r"[^a-zA-Z0-9_]", "_", sheet.replace(" ", "_")[:50])
                    table_name = f"sheet_{idx}_{safe}"
                conn.register(f"_excel_{idx}", df)
                conn.execute(f'CREATE TABLE "{table_name}" AS SELECT * FROM _excel_{idx}')
                if first_sheet_table is None:
                    first_sheet_table = table_name
                logger.debug(f"Loaded Excel sheet '{sheet}' as table '{table_name}'")
            except Exception as e:
                logger.warning(f"Failed to load Excel sheet '{sheet}': {e}")
        if first_sheet_table:
            conn.execute(f'CREATE OR REPLACE VIEW data AS SELECT * FROM "{first_sheet_table}"')
            logger.info(f"Created view 'data' from first sheet table '{first_sheet_table}' ({len(sheet_names)} sheets)")
        else:
            raise Exception("No Excel sheets could be loaded")

    def _detect_file_references(self, query: str) -> list:
        """
        Detect all file_* table references in a SQL query.
        Returns list of detected file IDs (e.g., ['file_1765031881', 'file_1765033843'])
        """
        import re
        # Pattern to match file_* table references (quoted or unquoted)
        # Matches: file_1234567890, "file_1234567890", `file_1234567890`
        pattern = r'(?:["\'`]?)?(file_\d+)(?:["\'`]?)'
        matches = re.findall(pattern, query, re.IGNORECASE)
        # Return unique file IDs
        return list(set(m.lower() for m in matches))
    
    async def _load_file_data(
        self, conn: duckdb.DuckDBPyConnection, data_source: Dict[str, Any]
    ):
        """
        Load file data into DuckDB with multi-sheet Excel support.
        For Excel files, creates virtual tables for each sheet.
        Handles: (1) local file path (e.g. temp CSV from Google Sheets), (2) Azure Blob object_key + user_id, (3) sample_data fallback.
        """
        file_path = data_source.get("file_path")
        file_format = data_source.get("format", "csv")
        schema = data_source.get("schema", {})
        storage_format = (
            ((schema or {}).get("storage", {}) or {}).get("format")
            if isinstance(schema, dict)
            else None
        )
        blob_file_format = (storage_format or file_format or "csv").lower()

        # Local file path (e.g. temp file from Google Sheet CSV): load directly. No blob or user_id needed.
        if file_path and isinstance(file_path, str) and os.path.isfile(file_path):
            try:
                safe_path = file_path.replace("'", "''")
                if file_format == "csv":
                    conn.execute(f"CREATE TABLE data AS SELECT * FROM read_csv_auto('{safe_path}')")
                elif file_format == "parquet":
                    conn.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{safe_path}')")
                elif file_format == "json":
                    conn.execute(f"CREATE TABLE data AS SELECT * FROM read_json_auto('{safe_path}')")
                elif file_format in ("xlsx", "xls"):
                    await self._load_excel_all_sheets_into_duckdb(conn, file_path, schema)
                else:
                    conn.execute(f"CREATE TABLE data AS SELECT * FROM read_csv_auto('{safe_path}')")
                logger.info(f"✅ Loaded local file into DuckDB: {file_path[:80]}...")
                data_source["analysis_based_on_sample_only"] = False
                return
            except Exception as e:
                logger.warning(f"Failed to load local file {file_path}: {e}")

        # Excel multi-sheet: at execution we use a NEW DuckDB connection, so we must (re)load the file.
        # Schema.duckdb_tables from upload is only for table names; tables do not exist in this conn.
        # Prefer full file from object storage so SQL runs against entire dataset, not just sample
        object_key = data_source.get("file_path")
        project_id = data_source.get("project_id") or data_source.get("user_id")
        if object_key and not project_id:
            logger.warning(
                "⚠️ file_path present but project_id missing — cannot load from datasource storage. "
                "Ensure data_source has project_id. Falling back to sample_data."
            )
        if object_key and project_id:
            try:
                from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

                storage_service = UploadDatasourceStorageService()
                file_content = await storage_service.get_file(object_key, project_id)
                import tempfile
                with tempfile.NamedTemporaryFile(delete=False, suffix=f".{blob_file_format}") as tmp:
                    tmp.write(file_content)
                    tmp_path = tmp.name
                try:
                    safe_path = tmp_path.replace("'", "''")
                    if blob_file_format == "csv":
                        conn.execute(f"CREATE TABLE data AS SELECT * FROM read_csv_auto('{safe_path}')")
                    elif blob_file_format == "parquet":
                        conn.execute(f"CREATE TABLE data AS SELECT * FROM read_parquet('{safe_path}')")
                    elif blob_file_format == "json":
                        conn.execute(f"CREATE TABLE data AS SELECT * FROM read_json_auto('{safe_path}')")
                    elif blob_file_format in ("xlsx", "xls"):
                        await self._load_excel_all_sheets_into_duckdb(conn, tmp_path, schema)
                    logger.info("✅ Loaded full file from datasource storage into DuckDB")
                    data_source["analysis_based_on_sample_only"] = False
                    return
                finally:
                    if os.path.exists(tmp_path):
                        os.unlink(tmp_path)
            except Exception as e:
                logger.error(f"❌ Failed to load full file from datasource storage, falling back to sample: {e}")

        # Fallback: use inline/sample data only when full file is unavailable
        data_source["analysis_based_on_sample_only"] = True
        data_source["analysis_based_on_sample_only_message"] = "Full file could not be loaded; analysis is based on a sample."
        inline_data = data_source.get("data") or data_source.get("sample_data")
        if not inline_data:
            try:
                def fetch_sample_from_db(source_id: str):
                    from src.db.session import get_sync_engine
                    import sqlalchemy as _sa
                    eng = get_sync_engine()
                    with eng.connect() as conn:
                        r = conn.execute(_sa.text("SELECT sample_data FROM data_sources WHERE id = :id LIMIT 1"), {"id": source_id})
                        row = r.fetchone()
                        if row:
                            return row[0]
                    return None

                sample = await asyncio.to_thread(fetch_sample_from_db, data_source.get('id'))
                if sample:
                    inline_data = sample
                    try:
                        data_source['sample_data'] = sample
                        data_source['data'] = sample
                    except Exception:
                        pass
            except Exception as e:
                logger.debug(f"Failed to fetch persisted sample_data for {data_source.get('id')}: {e}")
        if inline_data and isinstance(inline_data, (list, tuple)) and len(inline_data) > 0:
            try:
                import pandas as pd
                df = pd.DataFrame(inline_data)
                conn.register("_aiser_inline_df", df)
                conn.execute("CREATE TABLE data AS SELECT * FROM _aiser_inline_df")
                logger.info(f"✅ Loaded sample data into DuckDB (full file unavailable)")
                return
            except Exception as e:
                logger.warning(f"Failed to load sample data into DuckDB: {e}")

        raise Exception("No data available for file data source")

    async def _load_database_data(
        self, conn: duckdb.DuckDBPyConnection, data_source: Dict[str, Any]
    ):
        """Load database data into DuckDB"""
        # This would connect to the source database and load data
        # For now, we'll simulate loading data
        pass


class CubeEngine(BaseQueryEngine):
    """Cube.js engine for OLAP queries"""

    def __init__(self):
        # Cube.js configuration - use environment variable or default
        import os
        cube_host = os.getenv('CUBE_API_URL', 'http://localhost:4000')
        # Remove /cubejs-api/v1 if present in env var, we'll add it
        if '/cubejs-api' in cube_host:
            self.cube_api_url = cube_host
        else:
            self.cube_api_url = f"{cube_host}/cubejs-api/v1"
        self.cube_api_secret = os.getenv('CUBE_API_SECRET', 'dev-cube-secret-key')

    async def execute(
        self, query: str, data_source: Dict[str, Any], analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute query using Cube.js"""
        try:
            # CRITICAL: Only use Cube.js for database/warehouse sources, not DuckDB-backed uploads
            if uses_duckdb_for_execution(data_source.get("type"), data_source.get("format")):
                logger.warning(
                    "⚠️ Cube.js engine selected for DuckDB-backed data source — use DuckDB engine instead."
                )
                return {
                    "success": False,
                    "error": "Cube.js is not suitable for this data source. Use DuckDB engine instead.",
                }

            logger.info("📊 Executing query with Cube.js")
            
            # Check if Cube.js is available (only for database/warehouse sources)
            try:
                cube_base_url = self.cube_api_url.replace('/cubejs-api/v1', '')
                async with aiohttp.ClientSession() as test_session:
                    async with test_session.get(f"{cube_base_url}/ready", timeout=aiohttp.ClientTimeout(total=2)) as test_resp:
                        if test_resp.status != 200:
                            return {"success": False, "error": "Cube.js server is not available"}
            except Exception as cube_check_error:
                # Don't log as error if Cube.js is simply not configured - this is expected for many deployments
                logger.debug(f"Cube.js server not available (this is OK if not using Cube.js): {cube_check_error}")
                return {"success": False, "error": f"Cube.js server is not available: {str(cube_check_error)}"}

            # Convert SQL query to Cube.js query format
            cube_query = self._convert_sql_to_cube_query(query, analysis)
            return await self._execute_cube_query_payload(cube_query)

        except Exception as e:
            logger.error(f"❌ Cube.js query execution failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def execute_cube_query(
        self, cube_query: Dict[str, Any], data_source: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute a pre-built Cube.js query JSON payload."""
        try:
            if uses_duckdb_for_execution(data_source.get("type"), data_source.get("format")):
                logger.warning(
                    "⚠️ Cube.js engine selected for DuckDB-backed data source — use DuckDB engine instead."
                )
                return {
                    "success": False,
                    "error": "Cube.js is not suitable for this data source. Use DuckDB engine instead.",
                }

            # Check if Cube.js is available (only for database/warehouse sources)
            try:
                cube_base_url = self.cube_api_url.replace('/cubejs-api/v1', '')
                async with aiohttp.ClientSession() as test_session:
                    async with test_session.get(f"{cube_base_url}/ready", timeout=aiohttp.ClientTimeout(total=2)) as test_resp:
                        if test_resp.status != 200:
                            return {"success": False, "error": "Cube.js server is not available"}
            except Exception as cube_check_error:
                logger.debug(f"Cube.js server not available (this is OK if not using Cube.js): {cube_check_error}")
                return {"success": False, "error": f"Cube.js server is not available: {str(cube_check_error)}"}

            return await self._execute_cube_query_payload(cube_query)
        except Exception as e:
            logger.error(f"❌ Cube.js query execution failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def _execute_cube_query_payload(self, cube_query: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a Cube.js query payload via API."""
        async with aiohttp.ClientSession() as session:
            headers = {
                "Authorization": f"Bearer {self.cube_api_secret}",
                "Content-Type": "application/json",
            }

            async with session.post(
                f"{self.cube_api_url}/load", headers=headers, json=cube_query
            ) as response:
                if response.status == 200:
                    result = await response.json()

                    return {
                        "success": True,
                        "data": result.get("data", []),
                        "columns": list(result.get("annotation", {}).keys())
                        if result.get("annotation")
                        else [],
                        "row_count": len(result.get("data", [])),
                        "cube_metadata": result.get("annotation", {}),
                    }
                else:
                    error_text = await response.text()
                    return {
                        "success": False,
                        "error": f"Cube.js query failed: HTTP {response.status} - {error_text}",
                    }

    def _convert_sql_to_cube_query(
        self, sql_query: str, analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Convert SQL query to Cube.js query format"""
        # This is a simplified conversion - in production, you'd use a proper SQL parser

        cube_query = {
            "measures": [],
            "dimensions": [],
            "timeDimensions": [],
            "filters": [],
            "order": [],
            "limit": None,
        }

        # Extract measures (aggregations)
        if analysis["has_aggregations"]:
            if "sum(" in sql_query.lower():
                cube_query["measures"].append("*")
            if "count(" in sql_query.lower():
                cube_query["measures"].append("count")

        # Extract dimensions
        if "group by" in sql_query.lower():
            # Simple extraction - in production, use proper SQL parsing
            cube_query["dimensions"] = ["*"]

        return cube_query


class SparkEngine(BaseQueryEngine):
    """Apache Spark engine for big data processing.

    Connection priority (EE):
    1. Databricks Connect (DBR 16.4+) — DATABRICKS_HOST + DATABRICKS_TOKEN + DATABRICKS_CLUSTER_ID
    2. Spark Connect (Spark 3.4+)    — SPARK_CONNECT_URL  e.g. sc://spark-cluster:15002
    3. Local PySpark dev fallback     — no config required, spawns local JVM

    For real-time streaming, use RealTimeTrigger (AvailableNow) via Structured Streaming.
    """

    def __init__(self):
        self.spark = None
        self._connect_url: str | None = os.getenv("SPARK_CONNECT_URL")
        self._databricks_host: str | None = os.getenv("DATABRICKS_HOST")
        self._databricks_token: str | None = os.getenv("DATABRICKS_TOKEN")
        self._databricks_cluster_id: str | None = os.getenv("DATABRICKS_CLUSTER_ID")

    def _init_spark(self) -> None:
        """Initialise Spark session via Spark Connect, Databricks Connect, or local fallback."""
        if self.spark is not None:
            return
        try:
            if self._databricks_host and self._databricks_token:
                # Databricks Connect (enterprise EE path)
                try:
                    from databricks.connect import DatabricksSession  # type: ignore[import]
                    builder = DatabricksSession.builder.remote(
                        host=self._databricks_host,
                        token=self._databricks_token,
                        cluster_id=self._databricks_cluster_id or "",
                    )
                    self.spark = builder.getOrCreate()
                    logger.info("⚡ SparkEngine: connected via Databricks Connect")
                    return
                except ImportError:
                    logger.warning("databricks-connect not installed; falling back to Spark Connect")

            if self._connect_url:
                # Open-source Spark Connect (Spark 3.4+)
                from pyspark.sql import SparkSession  # type: ignore[import]
                self.spark = SparkSession.builder.remote(self._connect_url).getOrCreate()
                logger.info(f"⚡ SparkEngine: connected via Spark Connect — {self._connect_url}")
                return

            # Dev fallback: local PySpark (requires Java + pyspark installed)
            from pyspark.sql import SparkSession  # type: ignore[import]
            self.spark = (
                SparkSession.builder.appName("AiserQueryEngine")
                .config("spark.sql.adaptive.enabled", "true")
                .config("spark.sql.adaptive.coalescePartitions.enabled", "true")
                .getOrCreate()
            )
            logger.info("⚡ SparkEngine: using local PySpark session (dev mode)")

        except Exception as e:
            raise RuntimeError(
                "Spark initialization failed. For enterprise, set SPARK_CONNECT_URL or "
                "DATABRICKS_HOST/TOKEN/CLUSTER_ID environment variables. "
                f"Error: {e}"
            ) from e

    async def execute(
        self, query: str, data_source: Dict[str, Any], analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute query using Apache Spark"""
        try:
            logger.info("⚡ Executing query with Apache Spark")
            self._init_spark()

            # Load data into Spark
            df = await self._load_data_to_spark(data_source)

            # Register as temporary view
            df.createOrReplaceTempView("data")

            # Execute query; use RealTimeTrigger for streaming sources
            streaming_mode = (data_source.get("connection_config") or {}).get("streaming_mode")
            if streaming_mode == "realtime" and df.isStreaming:
                result_df = self.spark.sql(query)
                # AvailableNow processes all available data then stops (Spark 3.3+)
                query_handle = (
                    result_df.writeStream
                    .format("memory")
                    .queryName("aiser_realtime")
                    .trigger(availableNow=True)
                    .start()
                )
                query_handle.awaitTermination(timeout=30)
                result_df = self.spark.sql("SELECT * FROM aiser_realtime")
            else:
                result_df = self.spark.sql(query)

            data = [row.asDict() for row in result_df.collect()]
            columns = list(result_df.columns)

            return {
                "success": True,
                "data": data,
                "columns": columns,
                "row_count": len(data),
            }

        except Exception as e:
            logger.error(f"❌ Spark query execution failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def _load_data_to_spark(self, data_source: Dict[str, Any]):
        """Load data into Spark DataFrame"""
        if is_file_upload_duckdb(data_source.get("type"), data_source.get("format")):
            file_path = data_source.get("file_path")
            file_format = data_source.get("format", "csv")

            if file_format == "csv":
                return self.spark.read.option("header", "true").csv(file_path)
            elif file_format == "parquet":
                return self.spark.read.parquet(file_path)
            elif file_format == "json":
                return self.spark.read.json(file_path)

        # Streaming source: read from Kafka using Structured Streaming
        conn_cfg = data_source.get("connection_config") or {}
        if data_source.get("type") in ("kafka_stream", "streaming") and conn_cfg.get("kafka_brokers"):
            return (
                self.spark.readStream.format("kafka")
                .option("kafka.bootstrap.servers", conn_cfg["kafka_brokers"])
                .option("subscribe", conn_cfg.get("kafka_topic", ""))
                .load()
            )

        # For database sources, use JDBC
        return self.spark.read.format("jdbc").load()


class DirectSQLEngine(BaseQueryEngine):
    """Direct SQL engine for database queries"""

    async def execute(
        self, query: str, data_source: Dict[str, Any], analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute query using direct SQL connection"""
        import re  # bind at method entry so all uses (read-only check, ClickHouse, etc.) see it
        try:
            logger.info("🗄️ Executing query with Direct SQL engine")

            # Extract connection info from data_source - check multiple possible locations
            conn_info = (
                data_source.get('connection_info') or 
                data_source.get('connection_config') or 
                data_source.get('metadata') or 
                data_source.get('config') or
                {}
            )
            
            # Also check if connection_config is a string (JSON)
            if isinstance(conn_info, str):
                try:
                    import json
                    conn_info = json.loads(conn_info)
                except:
                    conn_info = {}
            
            # CRITICAL: Decrypt credentials if encrypted
            if isinstance(conn_info, dict):
                try:
                    from src.modules.data.utils.credentials import decrypt_credentials
                    conn_info = decrypt_credentials(conn_info)
                except Exception as decrypt_error:
                    logger.debug(f"Could not decrypt credentials (may not be encrypted): {decrypt_error}")
            
            # If conn_info is still empty, try to parse from schema (where some connection details might be stored)
            if not conn_info or (isinstance(conn_info, dict) and not conn_info.get('host')):
                schema = data_source.get('schema')
                if isinstance(schema, str):
                    try:
                        import json
                        schema_dict = json.loads(schema)
                        # Schema might contain connection details
                        if schema_dict.get('host'):
                            conn_info = {**conn_info, **schema_dict} if isinstance(conn_info, dict) else schema_dict
                    except:
                        pass

            # CRITICAL: Validate query for read-only safety (command-position only: not inside identifiers like last_updated, created_at)
            query_upper = query.upper().strip()
            dangerous_keywords = ['DROP', 'DELETE', 'UPDATE', 'INSERT', 'ALTER', 'CREATE', 'TRUNCATE', 'GRANT', 'REVOKE']
            cmd_pos_pattern = r'(?:^|[\s,;(])(' + '|'.join(re.escape(k) for k in dangerous_keywords) + r')(?:\s|[;(),]|$)'
            if re.search(cmd_pos_pattern, query_upper):
                logger.error(f"❌ Blocked dangerous query operation: {query[:200]}")
                return {
                    "success": False,
                    "error": "Read-only mode: DDL/DML operations are not allowed. Only SELECT queries are permitted."
                }
            
            # Prefer a full connection URI if provided
            conn_uri = conn_info.get('uri') or conn_info.get('connection_string') or conn_info.get('connection_string_uri')

            # Check if this is ClickHouse - use HTTP API instead of SQLAlchemy
            db_type = (conn_info.get('db_type') or conn_info.get('type') or data_source.get('db_type') or 'postgresql').lower()
            
            if db_type == 'clickhouse':
                # Use HTTP API for ClickHouse queries
                try:
                    import aiohttp
                    import os
                    # re is module-level (used above for read-only check)
                    # Extract from connection string/URI if present
                    if conn_uri:
                        # Parse clickhouse://user:pass@host:port/database format
                        match = re.match(r'clickhouse(?:[+]http)?://(?:([^:]+):([^@]+)@)?([^:/]+)(?::(\d+))?(?:/(.+))?', conn_uri)
                        if match:
                            uri_user, uri_pass, uri_host, uri_port, uri_db = match.groups()
                            username = uri_user or conn_info.get('username') or conn_info.get('user') or 'default'
                            password = uri_pass or conn_info.get('password') or conn_info.get('pass') or ''
                            host = uri_host or conn_info.get('host') or conn_info.get('hostname')
                            port = int(uri_port) if uri_port else (conn_info.get('port') or 8123)
                            database = (uri_db or conn_info.get('database') or conn_info.get('db') or conn_info.get('catalog') or '').strip()
                            if not database and isinstance(conn_info.get('custom_fields'), dict):
                                cf = conn_info['custom_fields']
                                database = (cf.get('database') or cf.get('db') or cf.get('catalog') or '').strip()
                            database = database or 'default'
                        else:
                            # Fallback to extracting from conn_info
                            host = conn_info.get('host') or conn_info.get('hostname')
                            port = conn_info.get('port') or 8123
                            database = (conn_info.get('database') or conn_info.get('db') or conn_info.get('catalog') or '').strip()
                            if not database and isinstance(conn_info.get('custom_fields'), dict):
                                cf = conn_info['custom_fields']
                                database = (cf.get('database') or cf.get('db') or cf.get('catalog') or '').strip()
                            database = database or 'default'
                            username = conn_info.get('username') or conn_info.get('user') or 'default'
                            password = conn_info.get('password') or conn_info.get('pass') or ''
                    else:
                        # Extract directly from conn_info (same semantics as data_connectivity: top-level then custom_fields)
                        host = conn_info.get('host') or conn_info.get('hostname')
                        port = conn_info.get('port') or 8123
                        database = (conn_info.get('database') or conn_info.get('db') or conn_info.get('catalog') or '').strip()
                        if not database and isinstance(conn_info.get('custom_fields'), dict):
                            cf = conn_info['custom_fields']
                            database = (cf.get('database') or cf.get('db') or cf.get('catalog') or '').strip()
                        database = database or 'default'
                        username = conn_info.get('username') or conn_info.get('user') or 'default'
                        password = conn_info.get('password') or conn_info.get('pass') or ''
                    
                    # When database is still "default", try parsing URI/connection_string (path = database) so we can rewrite default. in SQL
                    if not database or database.strip().lower() == 'default':
                        uri_raw = conn_info.get('uri') or conn_info.get('connection_string')
                        if uri_raw and isinstance(uri_raw, str) and uri_raw.strip():
                            try:
                                from urllib.parse import urlparse
                                parsed = urlparse(uri_raw.strip())
                                if parsed.path and parsed.path.strip('/'):
                                    database = parsed.path.strip('/')
                                    logger.info("DirectSQL ClickHouse: resolved database from URI: %s", database)
                            except Exception as e:
                                logger.debug("Could not parse URI for database: %s", e)
                        database = database or 'default'
                    
                    # Use Docker service name as default if in Docker environment
                    if not host:
                        # Check if we're in Docker (common indicators)
                        if os.path.exists('/.dockerenv') or os.getenv('DOCKER_CONTAINER'):
                            host = 'clickhouse'  # Docker service name
                        else:
                            host = 'localhost'
                    
                    # SECURITY: Do not log host, port, database, username, or password (enterprise/regulated).
                    logger.debug("ClickHouse connection attempt (details redacted)")
                    
                    # Use connection database in SQL: if SQL references default. but connection uses another database, rewrite
                    if database and database.strip().lower() != 'default' and re.search(r'\bdefault\s*\.\s*\w', query, re.IGNORECASE):
                        query = re.sub(r'\bdefault\s*\.\s*', f'{database}.', query, flags=re.IGNORECASE)
                        logger.info("DirectSQL ClickHouse: rewrote default. to connection database in query")
                    
                    # Verify we have credentials (do not log config or key names)
                    if not password:
                        logger.error("ClickHouse credentials missing or decryption failed; check ENCRYPTION_KEY and stored credentials")
                        # Try to get password from environment as fallback for ClickHouse
                        import os
                        if not password and db_type == 'clickhouse':
                            password = os.getenv('CLICKHOUSE_PASSWORD', '')
                            logger.debug("Using CLICKHOUSE_PASSWORD from environment: %s", bool(password))
                    
                    http_url = f"http://{host}:{port}"
                    # Ensure query ends with FORMAT JSON for ClickHouse
                    formatted_query = query.rstrip(';').strip()
                    
                    # ClickHouse doesn't support lag() window function - convert to neighbor() or arrayElement()
                    # Replace lag(column) OVER (ORDER BY ...) with neighbor(column, -1) OVER (ORDER BY ...)
                    # Pattern to match lag(column) OVER (ORDER BY ...)
                    lag_pattern = r'\blag\s*\(\s*([^)]+)\s*\)\s+OVER\s*\([^)]*ORDER\s+BY\s+([^)]+)\)'
                    if re.search(lag_pattern, formatted_query, re.IGNORECASE):
                        logger.warning("⚠️ Query contains lag() window function - ClickHouse doesn't support lag(). Converting to neighbor()...")
                        # Replace lag(column) OVER (ORDER BY ...) with neighbor(column, -1) OVER (ORDER BY ...)
                        formatted_query = re.sub(
                            r'\blag\s*\(\s*([^)]+)\s*\)\s+OVER\s*\(([^)]*ORDER\s+BY\s+[^)]+)\)',
                            r'neighbor(\1, -1) OVER (\2)',
                            formatted_query,
                            flags=re.IGNORECASE
                        )
                        logger.info(f"✅ Converted lag() to neighbor(): {formatted_query[:200]}...")
                    
                    if not formatted_query.upper().endswith('FORMAT JSON'):
                        formatted_query = f"{formatted_query} FORMAT JSON"
                    
                    async with aiohttp.ClientSession() as session:
                        auth = aiohttp.BasicAuth(username, password) if password else None
                        async with session.post(f"{http_url}/", data=formatted_query, auth=auth) as resp:
                            if resp.status == 200:
                                data = await resp.json()
                                # ClickHouse JSON format: {"meta": [...], "data": [...], "rows": N}
                                meta = data.get('meta', [])
                                columns = [col.get('name', '') for col in meta] if meta else []
                                rows_data = data.get('data', [])
                                rows = []
                                
                                # Parse rows - ClickHouse returns list of dicts or list of lists
                                for row_data in rows_data:
                                    if isinstance(row_data, dict):
                                        rows.append(row_data)
                                    elif isinstance(row_data, list) and columns:
                                        rows.append(dict(zip(columns, row_data)))
                                    else:
                                        rows.append({'value': row_data})
                                
                                return {
                                    "success": True,
                                    "data": rows,
                                    "columns": columns,
                                    "row_count": len(rows),
                                }
                            else:
                                error_text = await resp.text()
                                return {"success": False, "error": f"ClickHouse HTTP error {resp.status}: {error_text}"}
                except ImportError:
                    return {"success": False, "error": "aiohttp package required for ClickHouse queries"}
                except Exception as clickhouse_error:
                    logger.error(f"❌ ClickHouse query execution failed: {str(clickhouse_error)}")
                    return {"success": False, "error": f"ClickHouse query failed: {str(clickhouse_error)}"}

            if not conn_uri:
                # Try to build a SQLAlchemy URL from common fields
                user = conn_info.get('username') or conn_info.get('user')
                password = conn_info.get('password') or conn_info.get('pass')
                host = conn_info.get('host') or conn_info.get('hostname')
                port = conn_info.get('port')
                database = conn_info.get('database') or conn_info.get('db') or conn_info.get('database_name') or conn_info.get('initial_database')
                
                # Use Docker service names as defaults when in Docker environment
                if not host:
                    import os
                    if os.path.exists('/.dockerenv') or os.getenv('DOCKER_CONTAINER'):
                        # Use environment variables or Docker service names
                        if db_type == 'postgresql':
                            host = os.getenv('POSTGRES_SERVER', 'postgres')
                        elif db_type == 'mysql':
                            host = os.getenv('MYSQL_SERVER', 'mysql')
                        elif db_type == 'clickhouse':
                            host = os.getenv('CLICKHOUSE_HOST', 'clickhouse')
                        else:
                            host = 'localhost'
                    else:
                        host = 'localhost'

                if not database:
                    # Last resort: try to extract from stored schema
                    stored_schema = data_source.get('schema')
                    if isinstance(stored_schema, str):
                        try:
                            import json
                            schema_dict = json.loads(stored_schema)
                            database = schema_dict.get('database') or schema_dict.get('db')
                        except:
                            pass
                    
                    if not database:
                        raise Exception("Direct SQL requires a database name in connection_info. Please provide one of: 'database', 'db', or a full 'uri/connection_string' in the data source connection_info")

                driver = 'psycopg2' if db_type.startswith('postgres') else ''
                if driver:
                    scheme = f"postgresql+{driver}"
                elif db_type == 'mysql':
                    scheme = "mysql+pymysql"
                elif db_type == 'sqlserver':
                    scheme = "mssql+pyodbc"
                else:
                    scheme = db_type

                from urllib.parse import quote_plus
                auth = ''
                if user:
                    user_enc = quote_plus(user)
                    password_enc = quote_plus(password) if password else ''
                    auth = f"{user_enc}:{password_enc}@"
                else:
                    auth = ''

                hostpart = host
                if port:
                    hostpart = f"{host}:{port}"

                conn_uri = f"{scheme}://{auth}{hostpart}/{database}"

                # Add SQL Server specific query parameters
                if db_type in ['sqlserver', 'mssql']:
                    # Get ODBC driver from connection_info or use default (never None)
                    odbc_driver = conn_info.get('driver') or 'ODBC Driver 18 for SQL Server'
                    odbc_driver_encoded = odbc_driver.replace(' ', '+')
                    
                    query_params = [f"driver={odbc_driver_encoded}"]
                    
                    # Add TrustServerCertificate if not explicitly disabled
                    trust_cert = conn_info.get('trust_server_certificate', True)
                    if trust_cert:
                        query_params.append("TrustServerCertificate=yes")
                    
                    conn_uri = f"{conn_uri}?{'&'.join(query_params)}"


            # SQL Server / T-SQL: TOP N must come after DISTINCT; LIMIT is not supported (use TOP only)
            if db_type in ("sqlserver", "mssql", "tsql"):
                _orig = query
                query = re.sub(r"\bSELECT\s+TOP\s+(\d+)\s+DISTINCT\b", r"SELECT DISTINCT TOP \1", query, flags=re.IGNORECASE)
                query = re.sub(r"\bSELECT\s+TOP\s+(\(\d+\))\s+DISTINCT\b", r"SELECT DISTINCT TOP \1", query, flags=re.IGNORECASE)
                # Remove trailing LIMIT N (SQL Server uses TOP N in SELECT, not LIMIT)
                query = re.sub(r"\s+LIMIT\s+\d+\s*;?\s*$", "", query, flags=re.IGNORECASE)
                query = re.sub(r"\s+LIMIT\s+\(\s*\d+\s*\)\s*;?\s*$", "", query, flags=re.IGNORECASE)
                if query != _orig:
                    logger.debug("SQL Server: applied T-SQL rewrites (TOP/DISTINCT and LIMIT removal)")

            if db_type.startswith("postgres"):
                postgres_schema_aliases = []
                database_alias = (
                    conn_info.get('database')
                    or conn_info.get('db')
                    or conn_info.get('database_name')
                    or conn_info.get('initial_database')
                )
                if database_alias:
                    postgres_schema_aliases.append(str(database_alias))
                normalized_query = quote_known_table_refs_for_sql(
                    query,
                    data_source.get("schema") or {},
                    schema_aliases=postgres_schema_aliases,
                )
                if normalized_query != query:
                    logger.info("DirectSQL PostgreSQL: quoted known mixed-case table references in query")
                    query = normalized_query

            # CRITICAL: Enforce read-only mode for database connections
            # User-scoped queries only (no tenant isolation needed)
            
            # Run blocking DB calls in a thread to avoid blocking the event loop
            from src.modules.data.services.direct_sql_pool import get_sync_engine

            def run_sync_query(source: Dict[str, Any], uri: str, sql: str) -> Dict[str, Any]:
                try:
                    eng = get_sync_engine(source, uri)
                    with eng.connect() as conn:
                        res = conn.execute(sa.text(sql))
                        try:
                            cols = list(res.keys())
                        except Exception:
                            cols = []
                        rows = []
                        try:
                            fetched = res.fetchall()
                            for row in fetched:
                                if hasattr(row, '_mapping'):
                                    rows.append(dict(row._mapping))
                                else:
                                    rows.append(dict(zip(cols, row)))
                        except Exception:
                            rows = []
                    return {"success": True, "data": rows, "columns": cols, "row_count": len(rows)}
                except Exception as e:
                    return {"success": False, "error": str(e)}

            result = await asyncio.to_thread(run_sync_query, data_source, conn_uri, query)

            if result.get('success'):
                return {
                    "success": True,
                    "data": result.get('data', []),
                    "columns": result.get('columns', []),
                    "row_count": result.get('row_count', 0),
                }
            else:
                return {"success": False, "error": result.get('error')}

        except Exception as e:
            logger.error(f"❌ Direct SQL query execution failed: {str(e)}")
            return {"success": False, "error": str(e)}


class PandasEngine(BaseQueryEngine):
    """Pandas engine for small dataset operations"""

    async def execute(
        self, query: str, data_source: Dict[str, Any], analysis: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Execute query using Pandas"""
        try:
            logger.info("🐼 Executing query with Pandas")

            # Load data into Pandas DataFrame (returns (df, error_msg); error_msg only for API failures)
            df, load_error = await self._load_data_to_pandas(data_source)
            if load_error:
                return {"success": False, "error": load_error}
            if df is None or (hasattr(df, "empty") and df.empty):
                return {"success": False, "error": "No data available to run the query (empty DataFrame)"}

            # If SQL is provided, run it against the DataFrame via DuckDB (API/file single-table use "data")
            q_lower = (query or "").lower()
            if "select" in q_lower:
                conn = duckdb.connect()
                try:
                    conn.register("data", df)
                    sql = query
                    if "default.data" in sql or "default .data" in sql:
                        import re as _re
                        sql = _re.sub(r"\bdefault\.data\b", "data", sql, flags=_re.IGNORECASE)
                        sql = _re.sub(r'"default"\.data\b', "data", sql, flags=_re.IGNORECASE)
                    try:
                        result_df = conn.execute(sql).df()
                    except Exception:
                        import re as _re
                        m = _re.search(r"from\s+([a-zA-Z0-9_\.\"']+)", sql, _re.IGNORECASE)
                        if m:
                            tbl = m.group(1).strip('"\'')
                            rewritten = _re.sub(rf"\b{_re.escape(tbl)}\b", "data", sql, flags=_re.IGNORECASE)
                            rewritten = _re.sub(rf'"default"\.data\b', "data", rewritten, flags=_re.IGNORECASE)
                            result_df = conn.execute(rewritten).df()
                        else:
                            raise
                finally:
                    conn.close()
            else:
                # No SQL - return the loaded dataframe as-is (unified limit)
                result_df = df.head(PANDAS_FALLBACK_MAX_ROWS)

            # Convert to list of dictionaries
            data = result_df.to_dict("records")
            columns = result_df.columns.tolist()

            return {
                "success": True,
                "data": data,
                "columns": columns,
                "row_count": len(data),
            }

        except Exception as e:
            logger.error(f"❌ Pandas query execution failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def _load_data_to_pandas(
        self, data_source: Dict[str, Any]
    ) -> Tuple[Optional[pd.DataFrame], Optional[str]]:
        """Load data into Pandas DataFrame. Returns (df, error_msg); error_msg is set only for API failures."""
        _pd_ds_type = (data_source.get("type") or "").lower()
        _pd_is_api = is_single_table_source(_pd_ds_type) and _pd_ds_type not in (
            "file",
            "csv",
            "excel",
            "parquet",
        )
        # API-based sources: optional cache, then fetch with clear errors and max_rows
        if _pd_is_api:
            source_id = (data_source.get("id") or "").strip()
            _cfg = data_source.get("connection_config") or data_source.get("config") or {}
            if isinstance(_cfg, dict):
                max_rows = int(_cfg.get("max_rows") or API_MAX_ROWS_DEFAULT)
            else:
                max_rows = API_MAX_ROWS_DEFAULT
            # Check cache
            if source_id:
                async with _api_cache_lock:
                    if source_id in API_RESPONSE_CACHE:
                        expiry_ts, cached_df = API_RESPONSE_CACHE[source_id]
                        if time.monotonic() < expiry_ts and cached_df is not None:
                            logger.debug("API response cache hit for %s", source_id)
                            return (cached_df, None)
                        else:
                            del API_RESPONSE_CACHE[source_id]
            try:
                import aiohttp

                config = data_source.get("connection_config") or data_source.get("config") or {}
                base = (
                    config.get("url")
                    or config.get("base_url")
                    or config.get("endpoint")
                    or data_source.get("api_url")
                    or ""
                ).strip().rstrip("/")
                path = (config.get("path") or "").strip().lstrip("/")
                api_url = f"{base}/{path}" if path else base
                if not api_url:
                    return (None, "API data source missing URL/endpoint. Set Base URL in connection settings.")

                try:
                    from src.modules.data.utils.credentials import decrypt_credentials

                    config = decrypt_credentials(config)
                except Exception:
                    pass

                headers = config.get("headers", {})
                if isinstance(headers, str):
                    try:
                        import json as _json

                        headers = _json.loads(headers)
                    except Exception:
                        headers = {}
                method = (config.get("method") or "GET").upper()
                params = config.get("params", {})
                auth = None

                # Apply auth by auth_type so switching type is respected
                auth_type = (config.get("auth_type") or "").strip().lower() or "api_key"
                if auth_type == "basic" and config.get("username") is not None and config.get("password") is not None:
                    auth = aiohttp.BasicAuth(str(config["username"]), str(config["password"]))
                elif auth_type == "bearer" and config.get("bearer_token"):
                    headers["Authorization"] = f"Bearer {config['bearer_token']}"
                elif auth_type == "api_key" and config.get("api_key"):
                    api_key_header = config.get("api_key_header", "X-API-Key")
                    headers[api_key_header] = config["api_key"]
                elif auth_type != "none":
                    # Fallback: legacy or missing auth_type
                    if config.get("api_key"):
                        headers[config.get("api_key_header", "X-API-Key")] = config["api_key"]
                    elif config.get("bearer_token"):
                        headers["Authorization"] = f"Bearer {config['bearer_token']}"
                    elif config.get("username") and config.get("password"):
                        auth = aiohttp.BasicAuth(config["username"], config["password"])

                timeout_sec = config.get("timeout", 60)
                timeout = aiohttp.ClientTimeout(
                    total=min(max(int(timeout_sec), 5), 300)
                )
                async with aiohttp.ClientSession() as session:
                    async with session.request(
                        method, api_url, headers=headers, params=params, auth=auth, timeout=timeout
                    ) as response:
                        if response.status != 200:
                            try:
                                body = (await response.text())[:500]
                            except Exception:
                                body = ""
                            msg = f"API request failed: {response.status} {response.reason or ''}".strip()
                            if body and "json" in (response.headers.get("Content-Type") or "").lower():
                                try:
                                    err = json.loads(body)
                                    if isinstance(err, dict) and err.get("error"):
                                        msg = f"{msg} — {err.get('error')}"
                                    elif isinstance(err, dict) and err.get("message"):
                                        msg = f"{msg} — {err.get('message')}"
                                except Exception:
                                    pass
                            return (None, msg)

                        content_type = (response.headers.get("Content-Type") or "").lower()
                        text = await response.text()

                        if "json" in content_type:
                            try:
                                data = json.loads(text)
                            except json.JSONDecodeError as e:
                                return (None, f"API returned invalid JSON: {e}")
                            if isinstance(data, list):
                                data = data[:max_rows]
                                df = pd.DataFrame(data)
                            elif isinstance(data, dict):
                                if "data" in data:
                                    lst = data["data"][:max_rows] if isinstance(data["data"], list) else data["data"]
                                    df = pd.DataFrame(lst)
                                elif "results" in data:
                                    lst = data["results"][:max_rows] if isinstance(data["results"], list) else data["results"]
                                    df = pd.DataFrame(lst)
                                elif "items" in data:
                                    lst = data["items"][:max_rows] if isinstance(data["items"], list) else data["items"]
                                    df = pd.DataFrame(lst)
                                else:
                                    df = pd.DataFrame([data])
                            else:
                                return (None, "API response format not supported (expected JSON array or object).")
                        elif "csv" in content_type:
                            import io

                            df = pd.read_csv(io.StringIO(text), nrows=max_rows)
                        else:
                            try:
                                data = json.loads(text)
                                if isinstance(data, list):
                                    df = pd.DataFrame(data[:max_rows])
                                elif isinstance(data, dict):
                                    df = pd.DataFrame([data])
                                else:
                                    return (None, "API response format not supported.")
                            except json.JSONDecodeError:
                                try:
                                    import io

                                    df = pd.read_csv(io.StringIO(text), nrows=max_rows)
                                except Exception as e:
                                    return (None, f"Could not parse API response as JSON or CSV: {e}")

                        if df is not None and not df.empty and source_id:
                            async with _api_cache_lock:
                                API_RESPONSE_CACHE[source_id] = (
                                    time.monotonic() + API_RESPONSE_CACHE_TTL_SEC,
                                    df,
                                )
                        return (df, None)
            except asyncio.TimeoutError:
                return (None, "API request timed out. Increase timeout in connection settings or check the endpoint.")
            except Exception as e:
                logger.exception("Failed to load API data source")
                return (None, f"API data source error: {str(e)}")
        
        # File-based sources: prefer full file from object storage, then fall back to sample data
        _pd_is_file = uses_duckdb_for_execution(_pd_ds_type, (data_source.get("db_type") or ""))
        if _pd_is_file:
            object_key = data_source.get("file_path")
            file_format = data_source.get("format", "csv")
            schema_obj = data_source.get("schema", {})
            storage_format = (
                ((schema_obj or {}).get("storage", {}) or {}).get("format")
                if isinstance(schema_obj, dict)
                else None
            )
            blob_file_format = (storage_format or file_format or "csv").lower()
            project_id = data_source.get("project_id") or data_source.get("user_id")

            if object_key and project_id:
                try:
                    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

                    storage_service = UploadDatasourceStorageService()
                    file_content = await storage_service.get_file(object_key, project_id)
                    import tempfile
                    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{blob_file_format}") as tmp:
                        tmp.write(file_content)
                        tmp_path = tmp.name
                    try:
                        if blob_file_format == "csv":
                            return (pd.read_csv(tmp_path), None)
                        elif blob_file_format == "parquet":
                            return (pd.read_parquet(tmp_path), None)
                        elif blob_file_format == "json":
                            return (pd.read_json(tmp_path), None)
                        elif blob_file_format in ("xlsx", "xls"):
                            return (pd.read_excel(tmp_path), None)
                        elif blob_file_format == "txt":
                            return (pd.read_csv(tmp_path, names=["text"]), None)
                    finally:
                        if os.path.exists(tmp_path):
                            os.unlink(tmp_path)
                except Exception as e:
                    logger.warning(f"Failed to load full file from datasource storage, falling back to sample: {e}")

            # Fallback: inline/sample data only when full file unavailable
            inline_data = data_source.get("data") or data_source.get("sample_data")
            if inline_data is not None:
                try:
                    if isinstance(inline_data, (list, tuple)):
                        return (pd.DataFrame(inline_data), None)
                    if isinstance(inline_data, dict):
                        return (pd.DataFrame([inline_data]), None)
                    if isinstance(inline_data, str):
                        import io, json as _json
                        try:
                            return (pd.read_csv(io.StringIO(inline_data)), None)
                        except Exception:
                            try:
                                parsed = _json.loads(inline_data)
                                if isinstance(parsed, (list, dict)):
                                    return (pd.DataFrame(parsed), None)
                            except Exception:
                                logger.warning("Inline string data could not be parsed as CSV or JSON")
                except Exception as e:
                    logger.warning(f"Failed to convert inline sample data to DataFrame: {e}")

            try:
                def fetch_sample_from_db(source_id: str):
                    from src.db.session import get_sync_engine
                    import sqlalchemy as _sa
                    eng = get_sync_engine()
                    with eng.connect() as conn:
                        r = conn.execute(_sa.text("SELECT sample_data FROM data_sources WHERE id = :id LIMIT 1"), {"id": source_id})
                        row = r.fetchone()
                        if row:
                            return row[0]
                    return None

                sample = await asyncio.to_thread(fetch_sample_from_db, data_source.get("id"))
                if sample is not None:
                    try:
                        if isinstance(sample, (list, tuple)):
                            return (pd.DataFrame(sample), None)
                        if isinstance(sample, dict):
                            return (pd.DataFrame([sample]), None)
                        if isinstance(sample, str):
                            import io, json as _json
                            try:
                                return (pd.read_csv(io.StringIO(sample)), None)
                            except Exception:
                                try:
                                    parsed = _json.loads(sample)
                                    return (pd.DataFrame(parsed), None)
                                except Exception:
                                    logger.warning("Persisted sample_data string could not be parsed")
                    except Exception as e:
                        logger.warning(f"Failed to convert persisted sample_data to DataFrame: {e}")
            except Exception:
                logger.debug("Failed to fetch persisted sample_data")

            return (None, "No data available for file data source")

        # Database sources: try to use SQLAlchemy connection and load a table or run provided query
        elif data_source.get("type") == "database" or data_source.get("type") == "enterprise_connector":
            conn_info = data_source.get('connection_info') or data_source.get('metadata') or {}

            # Prefer a full connection URI
            conn_uri = conn_info.get('uri') or conn_info.get('connection_string') or conn_info.get('connection_string_uri')
            if not conn_uri:
                db_type = (conn_info.get('db_type') or conn_info.get('type') or data_source.get('db_type') or 'postgresql').lower()
                user = conn_info.get('username') or conn_info.get('user')
                password = conn_info.get('password') or conn_info.get('pass')
                host = conn_info.get('host') or conn_info.get('hostname') or 'localhost'
                port = conn_info.get('port')
                database = conn_info.get('database') or conn_info.get('db')

                if not database:
                    return (None, "Database data source requires a 'database' in connection_info or a full connection URI")

                driver = 'psycopg2' if db_type.startswith('postgres') else ''
                scheme = f"postgresql+{driver}" if driver else db_type

                auth = ''
                if user:
                    auth = user
                    if password:
                        auth += f":{password}"
                    auth += '@'

                hostpart = host
                if port:
                    hostpart = f"{host}:{port}"

                conn_uri = f"{scheme}://{auth}{hostpart}/{database}"

            # If a default table is provided, load it, otherwise attempt to run a lightweight SELECT (expecting user to pick table)
            table = data_source.get("table") or conn_info.get("table")
            try:
                eng = sa.create_engine(conn_uri)
                if table:
                    df = pd.read_sql_table(table, eng)
                else:
                    df = pd.read_sql_query("SELECT * FROM information_schema.tables LIMIT 0", eng)
                try:
                    eng.dispose()
                except Exception:
                    pass
                return (df, None)
            except Exception as e:
                return (None, f"Failed to load data from database source: {str(e)}")

        else:
            return (None, f"Unsupported data source type for Pandas engine: {data_source.get('type')}")


class QueryPerformanceMonitor:
    """Monitor query performance across engines"""

    def __init__(self):
        self.performance_metrics = {}

    def record_query_performance(
        self,
        engine: QueryEngine,
        execution_time: float,
        data_size: int,
        query_complexity: str,
    ):
        """Record query performance metrics"""
        if engine.value not in self.performance_metrics:
            self.performance_metrics[engine.value] = {
                "total_queries": 0,
                "total_time": 0,
                "avg_time": 0,
                "min_time": float("inf"),
                "max_time": 0,
            }

        metrics = self.performance_metrics[engine.value]
        metrics["total_queries"] += 1
        metrics["total_time"] += execution_time
        metrics["avg_time"] = metrics["total_time"] / metrics["total_queries"]
        metrics["min_time"] = min(metrics["min_time"], execution_time)
        metrics["max_time"] = max(metrics["max_time"], execution_time)

    def get_performance_report(self) -> Dict[str, Any]:
        """Get performance report for all engines"""
        return {
            "engines": self.performance_metrics,
            "generated_at": datetime.now().isoformat(),
        }
