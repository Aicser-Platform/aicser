"""CE NL2SQL business logic — generate, explain, optimize."""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any, Dict, Optional

from src.modules.data.capabilities import is_duckdb_or_file_dialect
from src.modules.data.services.data_connectivity_service import DataConnectivityService
from src.modules.nl2sql.dialect import (
    get_db_type_from_data_source,
    get_dialect_rules,
    get_dialect_system_prompt_line,
)
from src.modules.nl2sql.few_shot import format_few_shot_for_prompt
from src.modules.nl2sql.litellm_client import CELiteLLMClient
from src.modules.nl2sql.error_sanitize import sanitize_client_error
from src.modules.nl2sql.pattern_store import QueryPatternStore
from src.modules.nl2sql import prompts
from src.modules.nl2sql.schema_context import (
    format_schema_for_llm,
    get_relevant_schema_subset,
    get_schema_for_tables,
    has_usable_schema,
)
from src.modules.nl2sql.schema_resolver import resolve_usable_schema
from src.modules.nl2sql.sql_output import (
    extract_sql_from_llm_output,
    parse_json_llm_response,
    sql_looks_truncated,
    validate_sql_basic,
)

logger = logging.getLogger(__name__)

_MODEL_SECRET_KEYS = frozenset({"api_key"})


def _client_error(message: Optional[str], *, fallback: str = "Request failed") -> str:
    return sanitize_client_error(message or fallback)


def _public_model_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in entry.items() if k not in _MODEL_SECRET_KEYS}


def _model_meta_from_result(llm: CELiteLLMClient, result: Dict[str, Any]) -> Dict[str, Any]:
    mid = result.get("model_id")
    if not mid:
        return {}
    cfg = llm.get_model_config(str(mid)) or {}
    return {"model_id": mid, "model_name": cfg.get("name") or str(mid)}


class NL2SQLService:
    def __init__(self) -> None:
        self.llm = CELiteLLMClient()
        self.data_service = DataConnectivityService()
        self.patterns = QueryPatternStore()

    async def _fetch_schema(self, data_source_id: str) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
        return await resolve_usable_schema(self.data_service, data_source_id)

    def _deterministic_sql(
        self,
        query: str,
        schema: Dict[str, Any],
        db_type: str,
        ds_type: Optional[str],
    ) -> Optional[str]:
        q_lower = query.lower().strip()
        summary_patterns = ["summarize data", "data summary", "preview data", "what is in this"]
        is_summary = any(p in q_lower for p in summary_patterns)
        is_count = ("how many" in q_lower and "total" in q_lower) or "count total" in q_lower
        is_specific = " by " in f" {q_lower} " or len(q_lower.split()) > 8
        if not (is_summary or is_count) or is_specific:
            return None

        tables = schema.get("tables") or []
        if not tables:
            return None
        table = tables[0]
        t_name = table.get("name") or "data"
        needs_quote = is_duckdb_or_file_dialect(db_type)
        if needs_quote and ds_type != "sample_duckdb":
            t_name = f'"{t_name}"'
        elif table.get("schema") and ds_type == "sample_duckdb":
            t_name = f'{table.get("schema")}.{table.get("name")}'

        if is_count:
            return f"SELECT COUNT(*) AS total_records FROM {t_name}"
        return f"SELECT * FROM {t_name} LIMIT 15"

    async def _two_pass_tables(
        self,
        query: str,
        schema: Dict[str, Any],
        user_id: Optional[str],
        model_id: Optional[str],
    ) -> Optional[list]:
        if os.environ.get("AISER_CE_TWO_PASS_NL2SQL", "true").strip().lower() in ("0", "false", "no"):
            return None
        tables = schema.get("tables") or []
        threshold = int(os.environ.get("AISER_CE_TWO_PASS_TABLE_THRESHOLD", "20"))
        if len(tables) < threshold:
            return None

        table_list = "\n".join(
            f"- {(t.get('qualified_name') or t.get('name') or '?')}" for t in tables[:80]
        )
        result = await self.llm.generate_completion(
            system_context=prompts.TWO_PASS_SYSTEM,
            prompt=prompts.TWO_PASS_USER.format(query=query, table_list=table_list),
            user_id=user_id,
            model_id=model_id,
            max_tokens=400,
            temperature=0.0,
        )
        if not result.get("success"):
            return None
        data = parse_json_llm_response(result.get("content") or "")
        names = data.get("tables") or []
        if isinstance(names, list) and names:
            return [str(n) for n in names[:8]]
        return None

    async def generate_sql(
        self,
        *,
        query: str,
        data_source_id: str,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
        current_sql: Optional[str] = None,
    ) -> Dict[str, Any]:
        ds, schema = await self._fetch_schema(data_source_id)
        if not ds:
            return {"success": False, "error": f"Data source {data_source_id} not found"}
        if not has_usable_schema(schema):
            return {
                "success": False,
                "error": "No usable schema for this data source. Refresh schema or connect a data source with tables.",
            }

        ds_type = (ds.get("type") or "").strip().lower()
        db_type = get_db_type_from_data_source(ds)
        fmt = ds.get("format")

        deterministic = self._deterministic_sql(query, schema or {}, db_type, ds_type)
        if deterministic:
            valid, err = validate_sql_basic(deterministic)
            if valid:
                asyncio.create_task(
                    self.patterns.store_pattern(query, deterministic, schema or {}, data_source_id=data_source_id, user_id=user_id)
                )
                return {
                    "success": True,
                    "code": deterministic,
                    "language": "sql",
                    "explanation": "Deterministic preview query",
                    "model_id": "deterministic",
                    "model_name": "Built-in",
                }

        working_schema = get_relevant_schema_subset(schema, query, data_source_type=ds_type) or schema
        table_names = await self._two_pass_tables(query, working_schema or {}, user_id, model)
        if table_names:
            narrowed = get_schema_for_tables(working_schema, table_names)
            if narrowed and has_usable_schema(narrowed):
                working_schema = narrowed

        few_shot_examples = await self.patterns.retrieve_similar(query, working_schema or {}, top_k=3)
        few_shot_block = format_few_shot_for_prompt(few_shot_examples)
        schema_block = format_schema_for_llm(working_schema, query=query)
        dialect_line = get_dialect_system_prompt_line(db_type, ds_type)
        dialect_rules = get_dialect_rules(db_type, ds_type)
        current_sql_block = f"\nCurrent SQL in editor (may refine):\n{current_sql}\n" if current_sql else ""

        last_error: Optional[str] = None
        max_attempts = 2
        validation_warning: Optional[str] = None

        for attempt in range(max_attempts):
            error_block = f"\nPrevious attempt failed validation: {last_error}\nFix the SQL.\n" if last_error else ""
            system = prompts.GENERATE_SYSTEM.format(dialect_line=dialect_line) + "\n\n" + dialect_rules
            user_prompt = prompts.GENERATE_USER.format(
                query=query,
                schema_block=schema_block,
                few_shot_block=few_shot_block,
                current_sql_block=current_sql_block,
                error_block=error_block,
            )
            result = await self.llm.generate_completion(
                system_context=system,
                prompt=user_prompt,
                user_id=user_id,
                model_id=model,
                max_tokens=4000,
                temperature=0.1,
            )
            if not result.get("success"):
                return {"success": False, "error": _client_error(result.get("error"), fallback="SQL generation failed")}

            content = result.get("content") or ""
            parsed = parse_json_llm_response(content)
            raw_sql = parsed.get("sql_query") or parsed.get("sql") or extract_sql_from_llm_output(content)
            explanation = parsed.get("explanation")

            if not raw_sql:
                last_error = "Model did not return SQL"
                continue

            sql = extract_sql_from_llm_output(raw_sql if isinstance(raw_sql, str) else str(raw_sql))
            is_valid, err = validate_sql_basic(sql)
            if not is_valid:
                if "dangerous" in (err or "").lower():
                    return {"success": False, "error": "Generated SQL was rejected for safety."}
                if sql and sql_looks_truncated(sql):
                    validation_warning = err
                    last_error = err
                    continue
                last_error = err
                continue
            if sql_looks_truncated(sql):
                validation_warning = "SQL may be truncated; review before executing."
                last_error = validation_warning
                if attempt < max_attempts - 1:
                    continue

            asyncio.create_task(
                self.patterns.store_pattern(query, sql, working_schema or {}, data_source_id=data_source_id, user_id=user_id)
            )
            return {
                "success": True,
                "code": sql,
                "language": "sql",
                "explanation": explanation,
                "validation_warning": validation_warning,
                **_model_meta_from_result(self.llm, result),
            }

        return {
            "success": False,
            "error": _client_error(last_error, fallback="SQL generation failed after retries"),
            "validation_warning": validation_warning,
        }

    async def explain_sql(
        self,
        *,
        sql: str,
        schema_context: Optional[str] = None,
        data_source_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not schema_context and data_source_id:
            _, schema = await self._fetch_schema(data_source_id)
            if schema and has_usable_schema(schema):
                schema_context = format_schema_for_llm(schema)
        schema_section = f"\n\nAvailable schema:\n{schema_context}" if schema_context else ""
        result = await self.llm.generate_completion(
            system_context=prompts.EXPLAIN_SYSTEM,
            prompt=prompts.EXPLAIN_USER.format(sql=sql, schema_section=schema_section),
            user_id=user_id,
            model_id=model,
            max_tokens=1200,
            temperature=0.3,
        )
        if not result.get("success"):
            return {"success": False, "error": _client_error(result.get("error"), fallback="Explanation failed")}
        explanation = result.get("content") or ""
        if not explanation:
            return {"success": False, "error": "Empty explanation returned from AI"}
        return {"success": True, "explanation": explanation}

    async def optimize_sql(
        self,
        *,
        sql: str,
        schema_context: Optional[str] = None,
        data_source_id: Optional[str] = None,
        user_id: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not schema_context and data_source_id:
            _, schema = await self._fetch_schema(data_source_id)
            if schema and has_usable_schema(schema):
                schema_context = format_schema_for_llm(schema)
        schema_section = f"\n\nAvailable schema:\n{schema_context}" if schema_context else ""
        result = await self.llm.generate_completion(
            system_context=prompts.OPTIMIZE_SYSTEM,
            prompt=prompts.OPTIMIZE_USER.format(sql=sql, schema_section=schema_section),
            user_id=user_id,
            model_id=model,
            max_tokens=2000,
            temperature=0.2,
        )
        if not result.get("success"):
            return {"success": False, "error": _client_error(result.get("error"), fallback="Optimization failed")}
        data = parse_json_llm_response(result.get("content") or "")
        optimized = data.get("optimized_sql") or extract_sql_from_llm_output(result.get("content") or "")
        improvements = data.get("improvements") or ""
        if not optimized:
            return {"success": False, "error": "Model did not return optimized SQL"}
        return {"success": True, "optimized_sql": optimized.strip(), "improvements": improvements}

    async def list_models(self, user_id: Optional[str]) -> Dict[str, Any]:
        await self.llm.hydrate_user(user_id)
        await self.llm.refresh_operator_availability()
        models = self.llm.list_models()
        default = self.llm.default_model
        if user_id:
            from src.modules.user.user_setting_repository import UserSettingRepository

            pref = await UserSettingRepository().get_setting(str(user_id), "preferred_ai_model")
            if pref and pref.value and self.llm._is_usable(pref.value):
                default = pref.value
        if not default or not self.llm._is_usable(default):
            for m in models:
                mid = m.get("id", "")
                if mid and self.llm._is_usable(mid):
                    default = mid
                    break
            else:
                default = ""
        return {"success": True, "models": [_public_model_entry(m) for m in models], "default_model": default or ""}

    async def model_status(self, user_id: Optional[str], model_id: Optional[str]) -> Dict[str, Any]:
        if not model_id or model_id == "auto":
            await self.llm.hydrate_user(user_id)
            await self.llm.refresh_operator_availability()
            has_working = any(self.llm._is_usable(mid) for mid in self.llm.available_models)
            return {"success": True, "model_id": model_id or "auto", "available": has_working}
        await self.llm.hydrate_user(user_id)
        cfg = self.llm.get_model_config(model_id)
        if not cfg:
            return {"success": False, "model_id": model_id, "available": False, "error": "Model not found"}
        if cfg.get("is_operator"):
            result = await self.llm.verify_model(model_id)
            return {
                "success": result.get("success", False),
                "model_id": model_id,
                "available": result.get("available", False),
                "error": _client_error(result.get("error")),
            }
        available = model_id in self.llm.available_models
        return {"success": available, "model_id": model_id, "available": available}

    async def store_pattern_from_execution(
        self,
        *,
        nl_query: str,
        sql: str,
        data_source_id: str,
        user_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        _, schema = await self._fetch_schema(data_source_id)
        if not schema:
            return {"success": False, "error": "Schema unavailable"}
        ok = await self.patterns.store_pattern(
            nl_query, sql, schema, data_source_id=data_source_id, user_id=user_id, origin="ce_query_editor_exec"
        )
        return {"success": ok}
