# Semantic Layer Audit Report

> Phase 1 deliverable for `SEMANTIC_LAYER_TASK.md`. Not committed.
> Date: 2026-07-23 · Branch: `data-pipeline-accuracy`

## Headline finding — the task doc's premise is partially stale

The task assumes Aicser has **no** semantic layer and that the LLM free-forms SQL everywhere.
In reality this branch already contains a **database-backed semantic layer with a working
metric→SQL compiler**, wired into charts and (optionally) chat:

| Component | Where | Status |
|---|---|---|
| Metric/dimension store | Postgres tables `semantic_metrics`, `semantic_dimensions`, `semantic_time_spines`, `semantic_entities`, `semantic_measures` (`server/alembic/versions/2026_05_25_semantic_layer_tables.py`, `2026_05_26_semantic_compiler_tables.py`) | live, CE migrations |
| Join model | `data_model_relationships` table (`server/src/modules/data/models.py:68`) | live |
| Compiler | `server/ee/modules/semantic/compiler.py` (`SemanticQueryCompiler`) | working; join pruning (BFS), RLS, order-by allowlist, limit clamp |
| Context provider | `server/src/modules/data/services/semantic_context_service.py:281` (`get_unified_semantic_context`) | live; builds `prompt_hint` for NL2SQL |
| CRUD / governance API | `server/ee/modules/ai/semantic_router.py` (metrics, dimensions, certify, dbt sync, Cube import/export, preview, time spines) | live |
| dbt import | `server/ee/modules/semantic/dbt_importer.py` | live |
| LLM governed path | `nl2sql_node.py:1983-1988` (spec offered), `:2610-2616` (spec compiled) | **optional**, raw SQL remains the default |

Per the task doc's own rule ("stop and report contradictions"), this was reported and the
agreed direction is: **YAML files become the governed, git-reviewable definition format and
sync into the existing DB tables** (same pattern as `dbt_importer`). All existing consumers
keep working; the task doc's loader/catalog/compiler-hardening/LangGraph goals are applied
to the existing engine rather than a parallel one.

---

## 1.1 Repository map

- **Backend**: FastAPI (Python 3.11, Poetry), async SQLAlchemy 2.0 + asyncpg, Alembic.
  Modules under `server/src/modules/*`; EE overrides under `server/ee/modules/*` via
  `__path__` shims. Central router: `server/src/core/router.py`.
- **Frontend**: Next.js 14 App Router (TypeScript), React Query + Zustand.
- **LangGraph**: everything lives in `server/ee/modules/ai/`:
  - Graph build: `orchestrator/graph_builder.py`; routing: `services/langgraph_orchestrator.py`,
    `nodes/supervisor_node.py`.
  - State: `schemas/graph_state.py` (`AiserWorkflowState` TypedDict).
  - LLM access/tiering: `services/litellm_service.py`, `services/model_tiering.py`
    (fast vs strong tier per node).
  - HTTP/SSE entry: `ee/modules/ai/api_streaming.py`, `router.py`.
- **Database access today**: three styles coexist —
  1. ORM (async SQLAlchemy) for app entities (`src/modules/*/models.py`);
  2. raw `sa_text(...)` for the semantic tables (`semantic_context_service.py:62-97, 311-328`);
  3. **LLM-generated SQL strings** executed through
     `src/modules/data/services/multi_engine_query_service.py` (Postgres/MySQL/DuckDB/
     ClickHouse/APIs) and the v2 chart path
     (`src/modules/charts/services/v2/chart_service.py`, `_execute_with_sample_sql`).
- A fuller narrative of the AI engine (routing table, correction loops, model tiering,
  live-log findings) already exists in `docs/ai-ee-architecture.md` — this audit does not
  duplicate it.

## 1.2 Current LLM data-query path

Normal chat-to-analysis request:

```
POST /ai/analyze (SSE)                          api_streaming.py / router.py
  → initial AiserWorkflowState                  orchestrator/initial_state.py
  → supervisor (route decision)                 nodes/supervisor_node.py
  → federated_planner → nl2sql                  nodes/nl2sql_node.py  [LLM, strong tier]
  → validate_sql (sqlglot + schema check)       nodes/validation_node.py
  → execute_query                               nodes/query_execution_node.py
      → multi_engine_query_service.py           raw SQL against the source
  → post_query_brain (rule-based sanity)        nodes/post_query_brain.py
  → analytics_node (stats, no LLM)              nodes/analytics_node.py
  → chart_builder ∥ insight_synthesizer         parallel render
  → response_finalizer → SSE events
```

**Yes, the LLM still generates raw SQL by default.** Every place a raw SQL string is
LLM-produced and executed:

| # | Path | Evidence |
|---|---|---|
| R1 | Main chat NL2SQL | `ee/modules/ai/nodes/nl2sql_node.py` (`sql_query` from LLM JSON, `:2618`); `agents/nl2sql_agent.py` |
| R2 | Multi-step descriptive | `ee/modules/ai/nodes/multi_step_sql_node.py`, `multi_query_execution_node.py` |
| R3 | Executive report sub-queries | `ee/modules/ai/nodes/executive_report_execution_node.py` |
| R4 | Error-correction rewrites | `ee/modules/ai/nodes/error_correction_node.py` (LLM rewrites failing SQL) |
| R5 | Dashboard widget SQL | `ee/modules/ai/services/dashboard_generation_service.py`, `dashboard_llm_planner.py` (widget `sample_sql`), executed by `charts/services/v2/chart_service.py::_execute_with_sample_sql` |
| R6 | Mode sub-query planner | `ee/modules/ai/nodes/mode_query_planner_node.py` → `multi_query_execution_node.py` |

**The governed alternative exists but is opt-in**: when the data source has ≥1 semantic
metric, the NL2SQL prompt appends *"you MAY respond with a JSON block named
semantic_query_spec instead of raw SQL"* (`nl2sql_node.py:1983-1988`). If the LLM chooses
it, the spec is compiled via `ee/modules/ai/utils/semantic_spec_execution.py` →
`ee/modules/semantic/compiler.py` (`nl2sql_node.py:2610-2616`). "MAY" means the mini/fast
models usually don't.

**Schema context given to the LLM** (three stacked sources):
1. `data_source_schema` from `DataSource.schema` JSON (captured at connect/upload time —
   can go stale; wide schemas subset via `get_relevant_schema_subset(max_tables=16)` or
   optional Schema-RAG, `USE_SCHEMA_RAG` off by default).
2. `prompt_hint` from `get_unified_semantic_context` (`semantic_context_service.py:344-396`):
   certified metric SQL snippets, uncertified metrics, dimensions, time spines, modeled joins.
3. Fallback: `auto_generate_semantic_layer` invents metrics from the schema on the fly
   (`nl2sql_node.py:1964-1980` → `ee/modules/ai/services/semantic_layer.py:417`), including
   a **hardcoded catalog of "common metrics"** (`semantic_layer.py:87-176`).

## 1.3 Risks and problems

### High

- **H1 — Raw LLM SQL is still the default execution path** (R1–R6 above). Mitigations
  exist (sqlglot validation, dangerous-keyword blocklist
  `multi_engine_query_service.py:1105,1762`, row caps in `src/shared/query_limits.py`) but
  the semantic layer is advisory, so metric consistency and the reduced attack surface the
  task doc wants are not enforced anywhere.
- **H2 — No statement timeout on LLM-triggered queries.** No `statement_timeout` /
  `asyncio.wait_for` around SQL execution in `multi_engine_query_service.py` (HTTP-API
  connectors have timeouts, SQL engines do not). A pathological LLM SELECT (cartesian
  join, no pushed-down LIMIT on the engine side) can hold a connection indefinitely.
  The keyword blocklist stops DDL/DML but not expensive SELECTs.
- **H3 — Compiler interpolates filter values by string-escaping, not parameterization.**
  `compiler.py:78-86` (`_literal`: `str(val).replace("'", "''")`) and metric filters at
  `:305-314`. The task doc mandates bind parameters. Single-quote doubling covers the
  common case but is dialect-fragile (backslash-escape modes, exotic encodings) and the
  compiled string then flows through generic execution. RLS filters take the same path —
  a tenant-isolation control built on string escaping.

### Medium

- **M1 — Four competing metric-definition sources** can compute the same business number
  differently: `semantic_metrics` table, domain templates
  (`semantic_context_service.py:210-238`), org KPI memory (`:239-261`), and the hardcoded
  common-metric catalog (`ee/modules/ai/services/semantic_layer.py:87-176`). Only the DB
  table is governed/certifiable. Exactly the inconsistency the task doc targets.
- **M2 — Weak LLM context on definitions**: `description` is nullable in both semantic
  tables; auto-generated entries get placeholder text; `semantic_dimensions.values_sample`
  exists (migration `2026_05_25`, line 46) but nothing refreshes it and
  `get_unified_semantic_context` doesn't select it — so the LLM guesses filter values
  (e.g. `"KH"` vs `"Cambodia"`), a direct accuracy loss. No `clean.map` value-mapping
  concept exists.
- **M3 — No referential validation against the live DB schema.** `validator.py` checks
  metric/dimension names and join-graph acyclicity only. A metric whose `expression`
  references a renamed/dropped column compiles into SQL that fails at runtime (or worse,
  silently hits the wrong column). The task doc's loader requires column-existence checks.
- **M4 — Metric expressions are trusted raw SQL fragments.** `_compile_metric_expression`
  (`compiler.py:35-50`) splices `expression` / `numerator` / `denominator` strings straight
  into SELECT. Rows come not only from curated entries but from auto-generation and KPI
  memory (`sql_expression`, `semantic_context_service.py:257`). The certified gate applies
  only on the chart path (`resolve_semantic_chart_query:122`), not the chat spec path.
- **M5 — Single-metric spec.** `SemanticQuerySpec` takes one `metric` (`query_spec.py:23`);
  the task doc's tool schema takes `metrics: []`. Multi-metric questions ("revenue and
  refund rate by month") can't use the governed path and fall back to raw SQL.
- **M6 — No file-based, reviewable definition format.** Definitions are editable only via
  API/DB; no git review, no diffing, no environment promotion. (This is the gap the agreed
  YAML→DB sync closes; `dbt_importer.py` and the Cube import prove the sync pattern works.)

### Low

- **L1 — Compiler errors don't teach the LLM.** An out-of-allowlist `order_by` silently
  falls back to a default (`compiler.py:328-331`) instead of returning a correctable error;
  `runtime.py:62-64` swallows all compile errors to `None` (debug log), so the graph
  retries blind instead of reading "unknown metric X, available: […]".
- **L2 — Context truncation is silent**: 50-metric SQL fetch cap, top-10/8/12 items in
  `prompt_hint` (`semantic_context_service.py:314,354-375`) — fine today, but no signal
  when things get dropped.
- **L3 — `DataSource.schema` staleness**: schema JSON is captured at connect time; no
  refresh job — dimension/column drift lands on M3.
- **L4 — Cumulative metrics compile to a degenerate window**
  (`SUM(x) OVER (ORDER BY 1 …)`, `compiler.py:44-46`) — ordering by the constant `1`
  makes the running sum arbitrary. Flag as not-yet-correct rather than expand v1 scope.

## 1.4 Integration points and recommendation

**Where the semantic layer should live: in-process, extending what exists.** Lowest
friction by far:

- New shared package `server/src/modules/semantic/` (CE shim per repo convention, real
  code able to live in `ee/modules/semantic/` alongside the compiler): `schema.py`
  (pydantic YAML models), `loader.py` (ruamel round-trip parse + structural/referential
  validation), `sync.py` (YAML → `semantic_entities`/`semantic_measures`/
  `semantic_metrics`/`semantic_dimensions`/`data_model_relationships` upsert, mirroring
  `dbt_importer.import_semantic_manifest_to_db`), `catalog.py` (compact JSON +
  `render_for_prompt()` replacing the ad-hoc `prompt_hint` assembly, plus bounded
  `sample_values` refresh into the existing `values_sample` column).
- YAML files: `semantic/<datasource-slug>/<table>.yml` + `joins.yml` at repo root, in the
  task doc's exact native schema, generated by introspecting connected sources (read-only,
  reusing existing connection plumbing).
- **LangGraph wiring** (replace/wrap, in order of value):
  1. `nl2sql_node.py` — promote the spec from "MAY" to the required first attempt whenever
     the catalog covers the question; raw SQL becomes the flagged fallback
     (env flag, e.g. `SEMANTIC_RAW_SQL_FALLBACK=1`, so the old path stays available).
  2. Surface compiler errors as structured tool errors (fix L1) so the graph's existing
     `error_correction` loop can retry with a corrected spec.
  3. `resolve_semantic_chart_query` / dashboard planner — feed widgets from compiled
     semantic queries (the `compiled_semantic_sql` contract already exists).
- **Compiler hardening in place** (`ee/modules/semantic/`): parameterized values
  (compile to SQL + params, H3), statement timeout + enforced LIMIT at execution (H2),
  multi-metric specs (M5), `clean.map` CASE mapping and live-schema referential checks in
  the loader (M2/M3), expression allowlisting for uncertified sources (M4).

**Not recommended**: a separate service (network hop, new deploy unit, no benefit at this
scale) or a parallel YAML-only engine (two compilers drifting apart — the failure mode M1
already demonstrates).

---

### Phase 2 order of work (proposed)

1. Loader + YAML schema + validation errors (pydantic + ruamel) — pure additive.
2. Introspection generator → initial `semantic/**.yml` for real connected sources.
3. Sync into existing tables + `validate()`/`get_catalog()`/`run_query()` API surface.
4. Catalog + `render_for_prompt()` + `sample_values` refresh; swap into NL2SQL context.
5. Compiler hardening (parameters, timeout, multi-metric, clean.map, error surfacing).
6. LangGraph: spec-first NL2SQL behind flag; compiler errors as retryable tool errors.
7. Tests per task doc §2.4; `SEMANTIC_LAYER.md` team doc.
