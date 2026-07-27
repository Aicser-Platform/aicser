# Aicser Semantic Layer - Work So Far

Last updated: 2026-07-27

This document captures the current semantic layer work, the fixes already
validated, and the remaining product/engineering gaps.

## Goal

Aicser is moving from "LLM writes SQL directly against the data source" to a
semantic-model-first workflow.

The semantic layer should be the governed source of truth for:

- business metrics and dimensions
- joins and modeled relationships
- curated workbook views
- chart and dashboard generation
- LLM/LangGraph query planning
- lineage and data modeling visibility

The intended flow is:

```text
Data source schema
  -> generated/editable semantic YAML
  -> validate
  -> sync into semantic tables
  -> workbook, charts, dashboards, and AI agent query the semantic model
  -> compiler generates safe SQL
```

## Current Architecture

Semantic YAML is stored per data source. In Docker, the runtime root is:

```text
/app/semantic/<source-slug>/
```

Local development uses the repo semantic directory:

```text
semantic/<source-slug>/
```

The current model structure is:

```text
semantic/<source-slug>/
  _source.yml
  joins.yml
  model/
    tables/
      subject.yml
      quiz.yml
      ...
    views/
      subject_view.yml
      quiz_view.yml
      ...
```

`_source.yml` binds the YAML directory to an Aicser data source.

`model/tables/*.yml` defines table-level semantic models:

- physical table name
- primary key
- dimensions
- measures
- metrics
- joins local to that model

`model/views/*_view.yml` defines business-friendly workbook and AI surfaces:

- curated field list
- joined fields exposed through modeled paths
- default drill fields
- AI context metadata

`joins.yml` is still supported for compatibility, but model-local joins are now
accepted and should be preferred for Cube-like modeling.

After sync, YAML is materialized into database semantic metadata:

- `semantic_entities`
- `semantic_dimensions`
- `semantic_measures`
- `semantic_metrics`
- `data_model_relationships`

The workbook query path is:

```text
Workbook UI
  -> POST /api/semantic/query
  -> semantic service validates selected view and members
  -> compiler generates SQL
  -> source database executes SQL
  -> results, chart data, pivot data, and SQL are returned
```

## What Was Fixed

### Workbook Query Behavior

The workbook now tracks the active semantic view and sends `view_name` with
queries.

When the user changes view, the workbook clears stale selected fields,
dimensions, time settings, result data, and previous errors. This prevents old
fields from a previous view from being sent accidentally.

Selected metrics and dimensions are pruned to the active view before query
execution.

### Backend View Guard

The semantic query service now validates that requested members belong to the
selected view.

Example rejected request:

```json
{
  "view_name": "quiz_view",
  "metrics": ["account_count"]
}
```

Response:

```text
member_not_in_view:quiz_view; metrics=account_count
```

This is important for enterprise use because workbook users and AI agents
should query approved view fields, not arbitrary raw table columns.

### Duplicate Metric Names

Metric IDs now include the table name when syncing YAML metrics.

This allows multiple tables to define a metric like `count` without overwriting
each other during sync.

### View-Scoped Catalog

The compiler catalog is scoped to the active view. This makes duplicate member
names resolve through the selected view instead of the whole data source.

### Model-Local Joins

Table YAML files now support local joins, for example:

```yaml
table:
  name: subject
  source: public."Subject"
  primary_key: id

joins:
  - name: universities
    sql: "{CUBE}.\"universityId\" = {universities}.id"
    relationship: many_to_one

  - name: faculties
    sql: "{CUBE}.\"facultyId\" = {faculties}.id"
    relationship: many_to_one
```

The loader collects both model-local joins and legacy `joins.yml` joins.

### Docker Semantic Root

The server now resolves the semantic root as `/app/semantic` inside Docker.

Previously some code could write to `/semantic`, which caused the IDE,
workbook, sync, and query service to read different semantic files.

### BYOK Gemini First

AI discovery was changed to prefer the user's configured BYOK Gemini provider.

The previous Azure OpenAI 401 error was from one discovery call using an invalid
Azure key/endpoint. That affected AI suggestions, not the core semantic
workbook query path.

## Current Confirmed Behavior

Validated semantic query behavior for `QuizMedix`:

- valid `quiz_view` query succeeds
- invalid members from another view are rejected
- generated SQL uses the modeled table and selected members
- Docker logs show the semantic query returning HTTP 200 after sync

Example successful SQL for `quiz_view`:

```sql
SELECT
  quiz.title AS title,
  SUM(quiz."questionCount") AS total_question_count,
  SUM(quiz."durationMinutes") AS total_duration_minutes,
  COUNT(*) AS quiz_count
FROM public."Quiz" AS quiz
GROUP BY quiz.title
ORDER BY quiz.title DESC
LIMIT 5
```

Recent sync counts:

```text
QuizMedix:
  20 entities
  52 measures
  52 metrics
  140 dimensions
  14 joins
  45 time spines

AccountingDataset:
  11 entities
  80 measures
  80 metrics
  30 dimensions
  0 joins
  1 time spine
```

Current local services:

```text
aiser-server-ee    healthy on port 8001
aiser-client-ee    running on port 3001
aiser-postgres-ee  healthy on port 5433
aiser-redis-ee     running
aiser-keycloak-ee  running
```

## Validation Completed

Backend semantic tests:

```bash
cd server
PYTHONPATH=. python -m pytest \
  tests/modules/semantic/test_loader.py \
  tests/modules/semantic/test_service.py \
  tests/modules/semantic/test_sync.py \
  -q
```

Result:

```text
36 passed
```

Frontend lint for touched files:

```bash
cd client
npx eslint \
  ee/src/ee/components/semantic/workspace/WorkbookView.tsx \
  ee/src/ee/components/semantic/workspace/workbook/MemberSidebar.tsx \
  src/types/semanticWorkbench.ts
```

Result: passed.

Production client image build: passed.

Full client typecheck:

```bash
cd client
npx tsc --noEmit
```

Result: still fails because of existing unrelated TypeScript errors across
chat, dashboard, feed, and other areas. The semantic workbook files changed in
this work were not the source of those repo-wide errors.

## How To Use It Now

1. Open the semantic layer workspace:

```text
http://localhost:3001/semantic-layer?view=workbook&source=<data_source_id>
```

2. Select a curated view, for example `Quiz View` or `Subject View`.

3. Select fields from that view only.

4. Run the query.

5. Use the SQL tab to inspect the generated SQL.

6. Use the IDE to edit YAML.

7. Click Save, Validate, then Sync after model changes.

The sync endpoint is:

```text
POST /api/semantic/yaml/sync
```

## Recommended Modeling Standard

For Aicser, the product language should be Aicser-specific even if the internal
schema is inspired by Cube and Omni.

Recommended naming:

- use "model" or "semantic model" in the UI
- use "view" for curated workbook/AI-facing views
- avoid exposing the word "cube" to end users

Recommended directory shape:

```text
/
  agents/
    rules/
      default-timeframe.md
    certified-queries/
      amount-by-status.md
  model/
    tables/
      subject.yml
      quiz.yml
    views/
      subject_view.yml
      quiz_view.yml
  _source.yml
```

Recommended table model:

```yaml
model:
  name: subjects
  sql_table: public."Subject"
  primary_key: id
  public: false

  joins:
    - name: universities
      sql: "{MODEL}.\"universityId\" = {universities}.id"
      relationship: many_to_one

  dimensions:
    - name: name
      sql: "{MODEL}.name"
      type: string

  measures:
    - name: count
      type: count

    - name: total_questions
      sql: "{MODEL}.\"questionCount\""
      type: sum
```

Recommended view:

```yaml
view:
  name: subjects_view
  label: Subjects View
  description: Academic subjects with university, faculty, year, semester, and question counts.

  models:
    - join_path: subjects
      includes:
        - name
        - faculty
        - semester
        - count
        - total_questions

    - join_path: subjects.universities
      prefix: true
      includes:
        - name
        - short_name
        - city

  default_drill_fields:
    - name
    - faculty
    - semester
```

Backward compatibility can keep reading existing `table:` and `views:` YAML,
but new generated files should move toward Aicser naming.

## Remaining Gaps

### Joins In Workbook

The current workbook view scoping is fixed, but joined view queries still need
stronger end-to-end validation.

Example issue seen:

```text
unjoined_table:quiz,subject; add a modeled relationship from account
```

This means the selected view/query path still included a stale or unrelated
model root. The query planner should always anchor the query on the selected
view root and only include joined models reachable from that root.

### View Generation Quality

Generated views need to include useful related models. For example:

- `subject_view` should expose fields from `subjects`, `universities`, and
  `faculties`
- `quiz_view` may need fields from `quiz`, `subject`, and other related models
- sensitive fields like tokens and passwords should not be included by default

### IDE Experience

The IDE should behave more like a professional model editor:

- root directory visible
- folders open and close like VS Code
- create file and create folder in the selected directory
- separate files for each view, not one large `views.yml`
- clearer Save, Validate, and Sync states
- validation errors shown with file and line context
- `agents/rules` and `agents/certified-queries` supported as first-class files

### Workbook Experience

The workbook should expose curated views by default, not every raw table and
raw column.

Needed improvements:

- one clear "New" action menu instead of multiple plus buttons
- chart type selector with Auto, Bar, Line, Area, Pie, Scatter, and KPI
- SQL tab styled as a code editor
- pivot builder that works with one or two dimensions
- drill fields based on each view's `default_drill_fields`

### Lineage

Lineage should show database tables and modeled relationships, similar to data
catalog lineage tools.

Current issue: lineage can show too many metric/member nodes and becomes noisy.

Target behavior:

- show source tables as primary nodes
- draw relationship edges from modeled joins
- clicking a table opens a side panel with columns, measures, metrics, joins,
  and downstream views
- allow layer toggles for raw tables, semantic models, views, metrics, and
  dashboards

### AI Agent

LangGraph and chat-to-chart/chat-to-dashboard should use this order:

1. pick the best semantic view
2. generate a semantic query spec
3. validate against the view and model joins
4. compile to SQL
5. execute and return chart/dashboard config
6. fall back to raw SQL only if the semantic layer cannot answer the question

The AI context should include:

- active views
- field descriptions
- certified metrics
- join paths
- default timeframe rules
- certified queries
- security context
- fields that are hidden or sensitive

## Key Files

Backend:

```text
server/ee/modules/semantic/loader.py
server/ee/modules/semantic/sync.py
server/ee/modules/semantic/service.py
server/ee/modules/semantic/query_spec.py
server/ee/modules/semantic/yaml_schema.py
server/ee/modules/ai/semantic_router.py
server/ee/modules/ai/question_discovery.py
server/ee/modules/ai/litellm_service.py
```

Frontend:

```text
client/ee/src/ee/components/semantic/workspace/WorkbookView.tsx
client/ee/src/ee/components/semantic/workspace/workbook/MemberSidebar.tsx
client/src/types/semanticWorkbench.ts
```

Tests:

```text
server/tests/modules/semantic/test_loader.py
server/tests/modules/semantic/test_service.py
server/tests/modules/semantic/test_sync.py
```

## Product Direction

The semantic layer should become the contract between raw data and all
AI/product experiences.

For enterprise users, the important product rule is:

```text
Users and AI should explore governed views first.
Raw database tables should be available for modeling and admin workflows,
not be the default surface for workbook, dashboards, or chat.
```
