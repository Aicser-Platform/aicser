# Data Source Architecture

## Overview

The data source management system uses direct SQLAlchemy connections to databases, with no middleware or query optimization layer. This architecture was simplified by removing the non-functional Cube.js integration.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  (React/Next.js - DataSourceManager, UniversalDataSourceModal)  │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer                                │
│              (FastAPI - app/modules/data/api.py)                │
└────────────────────────────┬────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌──────────────────────────┐    ┌───────────────────────────────┐
│ DataConnectivityService  │    │  DatabaseConnectorService     │
│  - File uploads          │    │  - Connection testing         │
│  - Connection mgmt       │    │  - Schema introspection       │
│  - Orchestration         │    │  - Query execution            │
└────────┬─────────────────┘    │  - Connection pooling         │
         │                      └────────────┬──────────────────┘
         │                                   │
         ▼                                   ▼
┌─────────────────────┐         ┌──────────────────────────────┐
│   PostgreSQL DB     │         │    External Databases        │
│ - data_sources      │         │  - PostgreSQL (asyncpg)      │
│ - data_queries      │         │  - MySQL (aiomysql)          │
│ - Encrypted creds   │         │  - ClickHouse (HTTP API)     │
└─────────────────────┘         │  - SQL Server (aioodbc)      │
                                │  - Snowflake (native)        │
                                │  - BigQuery (SDK)            │
                                │  - Redshift (asyncpg)        │
                                └──────────────────────────────┘
```

## Core Services

### 1. DatabaseConnectorService

**Location:** `app/modules/data/services/database_connector_service.py`  
**Purpose:** Unified service for all database operations  
**Lines:** ~750

**Key Features:**
- Direct SQLAlchemy connections for all database types
- Connection pooling (5-10 connections per pool)
- Schema introspection using SQLAlchemy Inspector
- ClickHouse HTTP API support (no SQLAlchemy driver needed)
- Async/await pattern for all operations

**Supported Databases:**

| Database | Driver | Port | Connection Type |
|----------|--------|------|----------------|
| PostgreSQL | asyncpg | 5432 | SQLAlchemy async |
| MySQL | aiomysql | 3306 | SQLAlchemy async |
| ClickHouse | HTTP API | 8123 | Direct HTTP (aiohttp) |
| SQL Server | aioodbc | 1433 | SQLAlchemy async |
| Snowflake | snowflake-connector | 443 | Direct driver |
| BigQuery | google-cloud SDK | - | Cloud SDK |
| Redshift | asyncpg | 5439 | SQLAlchemy async |

**Methods:**
- `test_connection(config)` - Test database connectivity
- `create_connection(config)` - Create and cache connection engine
- `get_schema(config)` - Retrieve database schema
- `execute_query(connection_id, query)` - Execute SQL query
- `close_connection(connection_id)` - Close and cleanup connection

### 2. DataConnectivityService

**Location:** `app/modules/data/services/data_connectivity_service.py`  
**Purpose:** Orchestrator for file uploads and database connections  
**Lines:** ~2700 (reduced from ~2850)

**Key Features:**
- File upload handling (CSV, Excel, JSON, Parquet)
- Database connection orchestration
- Schema management
- Data source CRUD operations
- Integration with DatabaseConnectorService

**Methods:**
- `test_database_connection(config)` - Test before storing
- `store_database_connection(config)` - Store with encryption
- `get_database_schema(source_id)` - Retrieve schema
- `upload_file(file)` - Handle file uploads
- `get_supported_databases()` - List supported database types

### 3. CredentialManager

**Location:** `app/modules/data/utils/credentials.py`  
**Purpose:** Centralized credential encryption/decryption  
**Lines:** ~80

**Key Features:**
- Fernet encryption using `ENCRYPTION_KEY` env var
- Automatic encryption of sensitive fields (password, api_key, token, etc.)
- Marker fields (`__enc_*`) to track encrypted data
- Graceful fallback when encryption key not available

**Functions:**
- `encrypt_credentials(config)` - Encrypt sensitive fields
- `decrypt_credentials(config)` - Decrypt sensitive fields

## Data Models

### DataSource Model

**Table:** `data_sources`  
**Purpose:** Unified model for both file and database sources

**Key Fields:**
- `id` (String, PK) - Unique identifier
- `name` (String) - Display name
- `type` (String) - 'file' or 'database'
- `format` (String) - For files: 'csv', 'xlsx', etc.
- `db_type` (String) - For databases: 'postgresql', 'mysql', etc.
- `schema` (JSON) - Schema information (tables, columns)
- `connection_config` (JSON) - Encrypted connection details
- `file_path` (String) - For file sources
- `user_id` (String) - Owner
- `tenant_id` (String) - Multi-tenancy support
- `is_active` (Boolean) - Soft delete flag

### DataQuery Model

**Table:** `data_queries`  
**Purpose:** Query history and analytics

**Key Fields:**
- `data_source_id` (String) - Related data source
- `natural_language_query` (Text) - User's question
- `query_config` (JSON) - Filters, sorting, etc.
- `result_count` (Integer) - Rows returned
- `execution_time_ms` (Integer) - Performance metric

## Connection Flow

### 1. Test Connection

```
User → Client → API → DataConnectivityService → DatabaseConnectorService
                                                         │
                                                         ▼
                                              Direct driver test
                                              (psycopg2, pymysql, etc.)
                                                         │
                                                         ▼
                                              Return success/failure
```

### 2. Store Connection

```
User → Client → API → DataConnectivityService
                              │
                              ├─→ Test connection (DatabaseConnectorService)
                              │
                              ├─→ Encrypt credentials (CredentialManager)
                              │
                              ├─→ Store in PostgreSQL (data_sources table)
                              │
                              └─→ Create engine (DatabaseConnectorService)
```

### 3. Get Schema

```
User → Client → API → DataConnectivityService
                              │
                              ├─→ Get data source from DB
                              │
                              ├─→ Decrypt credentials
                              │
                              └─→ DatabaseConnectorService.get_schema()
                                           │
                                           ├─→ ClickHouse: HTTP API
                                           │
                                           └─→ Others: SQLAlchemy Inspector
```

### 4. Execute Query

```
User → Client → API → DatabaseConnectorService
                              │
                              ├─→ Get cached engine
                              │
                              ├─→ Execute query (async)
                              │
                              └─→ Return results
```

## Schema Storage

**Single Source of Truth:** PostgreSQL `data_sources.schema` column (JSON)

**Schema Structure:**
```json
{
  "tables": [
    {
      "schema": "public",
      "name": "users",
      "columns": [
        {
          "name": "id",
          "type": "INTEGER",
          "nullable": false,
          "primary_key": true
        },
        {
          "name": "email",
          "type": "VARCHAR(255)",
          "nullable": false
        }
      ],
      "rowCount": 1000
    }
  ],
  "schemas": ["public"],
  "total_rows": 1000,
  "last_updated": "2025-01-17T12:00:00Z"
}
```

**Schema Retrieval:**
- **Live:** Use SQLAlchemy Inspector to fetch current schema
- **Cached:** Fall back to stored schema if live fetch fails
- **ClickHouse:** Use HTTP API with JSON format

## Security

### Credential Encryption

1. **Encryption Key:** Set `ENCRYPTION_KEY` environment variable (Fernet key)
2. **Sensitive Fields:** password, api_key, token, secret_access_key, connection_string, credentials
3. **Marker Fields:** `__enc_*` flags indicate encrypted fields
4. **Decryption:** Automatic when credentials needed for connections

**Example:**
```python
# Before encryption
{
  "type": "postgresql",
  "host": "localhost",
  "password": "secret123"
}

# After encryption
{
  "type": "postgresql",
  "host": "localhost",
  "password": "gAAAAABg...",  # Encrypted
  "__enc_password": true       # Marker
}
```

### Connection Security

- **SSL Support:** All database types support SSL/TLS
- **Connection Pooling:** Limits concurrent connections
- **Credential Storage:** Never stored in plaintext
- **API Authentication:** JWT tokens required for all endpoints

## Performance Optimizations

### 1. Connection Pooling

```python
engine = create_async_engine(
    connection_string,
    poolclass=QueuePool,
    pool_size=5,           # Base pool size
    max_overflow=10,        # Additional connections
    pool_pre_ping=True,     # Test connections before use
    pool_recycle=3600       # Recycle after 1 hour
)
```

### 2. Schema Caching

- Schemas cached in PostgreSQL
- Live fetch only when explicitly requested
- Reduces load on external databases

### 3. Async/Await

- All database operations use async/await
- Non-blocking I/O for better concurrency
- Supports thousands of concurrent users

### 4. ClickHouse HTTP API

- No SQLAlchemy driver overhead
- Direct HTTP requests with JSON format
- Faster for ClickHouse-specific features

## Removed Components

The following Cube.js-related components were removed. An earlier version of
this document claimed this removal was already complete; it wasn't — a full
parallel Cube.js query-execution pipeline was still live end-to-end. That
pipeline (not just the services/directories below) has now actually been
deleted:

### Deleted Services (~3500 lines)
- `cube_connector_service.py` (662 lines)
- `real_cube_integration_service.py` (1069 lines)
- `cube_integration_service.py` (823 lines)
- `cube_data_modeling_service.py` (~500 lines)
- `yaml_schema_service.py` (~200 lines)

### Deleted Directories
- `cube_helpers/` - Placeholder Cube.js directory
- `cube_schemas/` - YAML schema files

### Deleted query-execution pipeline (this pass)
- `CubeEngine` class, the `QueryEngine.CUBE` enum member, and
  `MultiEngineQueryService.execute_cube_query()` in
  `src/modules/data/services/multi_engine_query_service.py` — this made live
  HTTP calls to `CUBE_API_URL`, a service with no entry in any Docker Compose
  file in this repo.
- The LangGraph `cube_query` → `execute_cube_query` node pair and the
  supervisor routing branch into it (`ee/modules/ai/nodes/cube_node.py`,
  `ee/modules/ai/nodes/cube_execution_node.py` — both deleted — plus the
  wiring in `ee/modules/ai/orchestrator/graph_builder.py`,
  `supervisor_routing.py`, `supervisor_node.py`, and
  `nodes/supervisor/plan_templates.py`).
- `AIOrchestrator._execute_cube_query()` and the Cube.js branch of
  `_execute_cube_analysis()` in `ee/modules/ai/services/ai_orchestrator.py`
  (this branch was already unreachable in practice — the strategy selector
  never actually returned the literal string it was gated on — and now fails
  fast instead of calling the removed HTTP client).
- The `/api/data/cube/*` execution endpoints in `src/modules/data/router.py`:
  `status`, `connect`, `metadata`, `query`, `suggestions`, `{cube_name}/preview`,
  `initialize`, `connections`, `connections/{id}/query`,
  `connections/{id}/schema` — all made live `CUBE_API_URL` HTTP calls with no
  backing service. `_require_external_cube()` and the `CubeQueryRequest`
  model (only used by these endpoints) were removed alongside them.

### Endpoints that still exist as routes but are non-functional
- `/api/data/cube-modeling/*` (`analyze`, `deploy`, `connect-warehouse`,
  `types`) depend on `cube_modeling_service`, a module that does not exist
  anywhere in this codebase — the import is wrapped in a try/except that
  falls back to `None`, so these return 503 "Cube.js modeling service is not
  available" rather than doing anything.
- `/api/data/cube-deploy` and `/api/data/cube-cubes` already explicitly
  return 501 in code ("Cube.js deployment/integration has been removed").

### Optional feature intentionally out of scope for this removal
- `ee/modules/ai/semantic_router.py`'s `/cube/export` and `/cube/import`
  endpoints let a user export this platform's semantic layer to Cube.js YAML
  format, or import metadata from their own externally-hosted Cube.js
  instance. This is gated behind `AICSER_EXTERNAL_CUBE_ENABLED`
  (`src/modules/data/cube_feature.py`) and is a distinct, opt-in
  interchange feature — not the query-execution pipeline described above —
  so it was left in place.

### Removed Models
- `DataConnection` - Duplicate of DataSource

## Migration Notes

### Before (With Cube.js)

```python
# Old approach - relied on non-existent Cube.js
test_result = await cube_connector.test_connection(config)
schema = await cube_connector.get_database_schema(config)
```

### After (Direct SQLAlchemy)

```python
# New approach - direct database connections
test_result = await database_connector.test_connection(config)
schema = await database_connector.get_schema(config)
```

## API Endpoints

### Working Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/data/database/test` | Test database connection |
| POST | `/api/data/database/connect` | Store database connection |
| GET | `/api/data/sources` | List all data sources |
| GET | `/api/data/sources/{id}` | Get specific data source |
| GET | `/api/data/sources/{id}/schema` | Get database schema |
| POST | `/api/data/upload` | Upload file |
| DELETE | `/api/data/sources/{id}` | Delete data source |

### Deprecated Endpoints

`/api/data/cube/*` no longer exists (see "Removed Components" above — those
routes were deleted, not stubbed). `/api/data/cube-modeling/*` still exists
as a route but returns 503, since the service it depends on isn't present in
this codebase. `/api/data/cube-deploy` and `/api/data/cube-cubes` remain as
routes that explicitly return 501.

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/db
ENCRYPTION_KEY=your-base64-encoded-fernet-key

# Optional
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=password
CLICKHOUSE_DB=default
```

## Error Handling

### Connection Errors

```python
{
  "success": false,
  "error": "Connection failed: Could not connect to server"
}
```

### Schema Retrieval Errors

```python
{
  "success": true,
  "schema": {...},  # Cached schema
  "warning": "Using cached schema - live fetch failed"
}
```

### Unsupported Database

```python
{
  "success": false,
  "error": "Unsupported database type: mongodb. Supported: [...]"
}
```

## Logging

All operations are logged with emoji indicators:

- 🔌 Connection operations
- 🧪 Connection tests
- ✅ Success operations
- ❌ Error operations
- ⚠️ Warning operations
- 🔍 Query/schema operations
- 💾 Storage operations

**Example:**
```
INFO: 🔌 Testing postgresql connection to localhost
INFO: ✅ postgresql connection test successful
INFO: 💾 Storing database connection: postgresql
INFO: ✅ Credentials encrypted for postgresql connection
```

## Future Enhancements

1. **Query Builder UI** - Visual query construction
2. **Connection Health Monitoring** - Periodic connection tests
3. **Query Caching** - Cache frequently run queries
4. **Schema Change Detection** - Notify when schema changes
5. **Additional Databases** - MongoDB, Cassandra, etc.
6. **SSH Tunneling** - Secure connections through SSH tunnels
7. **Query History** - Full query audit trail
8. **Performance Metrics** - Query execution analytics

## Troubleshooting

### Connection Fails

1. Check database is running: `docker ps`
2. Test connection manually: `psql -h localhost -U user -d db`
3. Check firewall rules
4. Verify credentials are correct
5. Check logs for detailed error

### Schema Not Loading

1. Check database permissions (need SELECT on information_schema)
2. Try with cached schema (stored in PostgreSQL)
3. Check for timeout issues (large databases)

### Credentials Not Decrypting

1. Verify `ENCRYPTION_KEY` is set correctly
2. Check key hasn't changed (would invalidate existing encrypted data)
3. Look for encryption warnings in logs

## Development

### Adding New Database Type

1. Add to `database_configs` in DatabaseConnectorService
2. Implement driver-specific connection test
3. Add to supported databases list
4. Update documentation
5. Add tests

**Example:**
```python
'mongodb': {
    'driver': 'motor',  # async MongoDB driver
    'default_port': 27017,
    'connection_string': 'mongodb://{username}:{password}@{host}:{port}/{database}',
}
```

## Metrics

### Code Reduction
- **Lines Removed:** ~3,500
- **Lines Added:** ~850
- **Net Reduction:** ~2,650 lines (60-70% complexity reduction)

### Performance
- **Connection Speed:** Faster (no middleware)
- **Memory Usage:** Lower (fewer services)
- **Maintainability:** Significantly improved

## References

- SQLAlchemy Docs: https://docs.sqlalchemy.org/
- ClickHouse HTTP API: https://clickhouse.com/docs/en/interfaces/http/
- Fernet Encryption: https://cryptography.io/en/latest/fernet/

---

## AI analytics execution path (chat / LangGraph)

How natural-language analysis reaches data, with the guards that matter for trust and cost.

### Source → engine (one NL2SQL façade, divergent engines)

```
User question
    → supervisor / NL2SQL (SQL-shaped plan)
    → validate_sql → execute_query
         ├─ file / csv / parquet / excel  → DuckDB (load file → table "data")
         ├─ API / single-table HTTP       → fetch → Pandas → DuckDB register("data") → SQL
         ├─ warehouse DB                  → DirectSQL (native dialect)
         └─ multi-source federation       → per-source extract (under identity)
                                            → DuckDB register(alias, df) → federation SQL
```

**Honest claim:** we unify on SQL as the *query language*, not on one physical engine. Files and APIs are normalized into DuckDB-shaped relations before SQL runs. Remote warehouses stay on DirectSQL for correctness and pushdown. Federation is extract-then-DuckDB, not durable `ATTACH` of every warehouse.

Capabilities live in `server/ee/modules/ai/data_source_capabilities.py` and routing in `MultiEngineQueryService._execute_query_unfiltered`.

### Numeric grounding (layered — do not double-rewrite)

```
insight_synthesizer
  → AUTHORITATIVE data_facts in prompt
  → ground_prose_pack (scale/format inject from result rows)
analytics_render (chart ∥ insights)
  → response_finalizer / narration_grounding
       verify claims vs facts (audit)
       soft-correct summary rounding only (≤5%)
       assign verification_tier: T1 | T2 | T0
```

Generation already grounds narration. Finalizer is the **auditor** (tiers + catch residual hallucinations), not a second inject pass.

### Multi-query fan-out budgets

`mode_query_planner` declares `budgets.max_queries` (default 6) and **trims** the plan via `_apply_query_budgets` (also shrinks N when little wall-clock remains).  
`multi_query_execution` re-trims and runs optional queries under `asyncio.Semaphore(max_concurrency)` (default 3).  
SQL correction loops remain separately capped in `DEFAULT_RETRY_LIMITS`.

### Row security (RLS) enforcement point

```
execute_query / federated extract
    → MultiEngineQueryService.execute_query(identity=QueryIdentity(...))
         → _enforce_column_security
         → _enforce_row_security → inject_predicates (app rewrite)
         → engine
```

Enforcement is **caller-scoped SQL rewrite** from Aicser RLS policies (`data_source_rls_*`), not `SET ROLE` / session Postgres RLS. That covers DuckDB and API paths where database RLS cannot apply. Native warehouse `SET ROLE` is optional and additive only when a customer warehouse already relies on DB roles.

### Lakehouse object storage

Pipeline **staging / bronze / quarantine** keys (`orgs/{org_id}/…`) use the same backend as **file uploads** (`get_object_store_async` ↔ Settings → Storage or `STORAGE_BACKEND` / `S3_*`). **`STORAGE_BACKEND=s3`**: uploads and medallion objects share one bucket (worker and API need no shared disk). **`postgresql`** (default Docker EE): uploads in Postgres; lake files on local disk at `LAKE_ROOT` — Compose must mount the same `lake_ee_data` volume on **server**, **worker**, and **warehouse-compute**. Onboarding copies upload bytes into staging via `UploadDatasourceStorageService`, not `open(file_path)` alone.

### Usage, billing, and deployment surfaces

Three **deployment products** share one usage API on Enterprise but expose different UI:

| Product | Detection | Billing UI | Usage UI |
| --- | --- | --- | --- |
| **Aicser Cloud (SaaS)** | `AISER_DEPLOYMENT_MODE=saas`, EE | Settings → **Billing** (Stripe/KHQR) | Settings → **Usage & analytics** + profile menu |
| **EE self-host** | `self_host` + EE license | Settings → **License** (no Stripe tab) | Same **Usage** tab (local `organization_usage` + `llm_request_summary`) |
| **CE self-host** | CE edition | None | Settings → **Usage** (footprint + BYOK copy); `GET /pricing/usage` |

`GET /organizations/workspace-config` returns `edition`, `billing_surface` (`hosted` \| `license` \| `none`), and `usage_analytics`. **All org members** with `org:view` can open Usage; cross-user spend breakdown is scoped to org owner/admin (same RBAC as billing usage breakdown).

**Semantic / KPI / catalog** are separate from usage: governed metrics live in the semantic layer; org KPI definitions are Ask-only memory (`organization_kpi_definitions`); catalog is read-only discovery.

### Pipeline landing (configure once, choose per pipeline)

| Configure once (admin) | API / UI | Used for |
| --- | --- | --- |
| **Workspace storage** | Settings → Integrations → Platform → **Workspace storage** (`admin/runtime-config/storage`) | Uploads, default Bronze, pipelines on “Workspace” |
| **Org lake buckets** | Data → connect S3 lake (`saved_s3_destinations`) | Pipelines on “Your bucket” — Silver & Gold always follow that bucket |
| **Warehouse export DB** | Data → Postgres/MySQL/ClickHouse/SQL Server | Gold tables pushed to customer SQL warehouse (not medallion files) |

Pipeline wizard **Destination** only selects among registered targets plus one optional switch: **Bronze in org bucket** (when Silver/Gold use that bucket). There is no separate per-layer destination picker in v1 — splitting Silver/Gold across different roots would be a distinct advanced SKU/workflow.

`GET /pipelines/storage` mirrors workspace + saved destinations (includes org layout + S3 health). `GET/PATCH /pipelines/lakehouse-settings` sets org `object_prefix_template`. Per-pipeline `movement_policy` is stored in `data_pipelines.options` and edited on pipeline detail → Movement policy.

### Lakehouse naming (storage · compute · movement)

**Canonical UI:** [`/lakehouse`](../../client/src/app/(dashboard)/lakehouse/page.tsx) (alias `/warehouse`). Product map: [server/docs/lakehouse-product.md](docs/lakehouse-product.md).

| Name in UI | Google analogy | What it is | What it is **not** |
| --- | --- | --- | --- |
| **Lakehouse → Storage** | Cloud Storage buckets | S3 roots, medallion object paths, Iceberg warehouse URI | SQL engines, ingest jobs |
| **Lakehouse → Compute** | BigQuery slots / reservations | `warehouse-compute`, embedded/pool/Trino profiles, query history | Bucket credentials, pipeline transforms |
| **Pipelines** | Dataflow / transfer | Bronze→Silver→Gold movement + schedule | A second storage admin UI |
| **Warehouse export** | Federated query to Cloud SQL | Gold **tables** in customer Postgres/MySQL/ClickHouse/SQL Server | Iceberg files |
| **Data** | Connection catalog | OLTP, files, APIs, export DBs, lake bucket registration | Compute scaling |
| **Semantic / Catalog / RLS** | Dataplex + policy tags (split) | Meaning, discovery, row/column access at **read** time | Movement retention (pipeline `movement_policy`; not access control) |

API paths remain `GET /api/warehouse/*` and `warehouse_*` env vars until a coordinated rename.

### Regulated enterprises (governance & reporting)

Banks and similar customers need **access**, **official definitions**, **lineage**, and **audit evidence** — not a fifth copy of policy UI on the lake.

| Need | Where in Aicser | Notes |
| --- | --- | --- |
| Entitlements / RLS | Data source row & column policies; `QueryIdentity` + `inject_predicates` | Applies to lake Gold and exported Gold DBs |
| Reporting SSOT | Semantic layer (certified metrics) | KPI definitions in Settings are Ask memory only |
| Lineage | Catalog; pipeline OpenLineage; transform column lineage | Not a full enterprise data catalog replacement |
| Movement / retention | Pipeline movement policy; org lake layout | Worker retention enforcement rolling out |
| Evidence | Settings audit log; AI audit log (Govern); Lakehouse query history | SIEM forwarder optional |
| Privacy | Column rules; PII policy on schema | Env-gated `AISER_PII_*` |

Customer-facing hub: **Lakehouse → Governance**. Playbook: [server/docs/regulated-enterprise-governance.md](docs/regulated-enterprise-governance.md).

### Pipeline lake vs warehouse export vs warehouse compute

Three **runtime** roles (see table above for UI consolidation):

| Surface | User entry | Runtime role |
| --- | --- | --- |
| **Pipeline lake storage** | Pipeline wizard destination **S3 lake (Iceberg)**; optional **saved S3** (`destination_asset_id`, `bronze_landing` platform vs lakehouse) | Medallion **Bronze / Silver / Gold** object paths on workspace or customer bucket (`load/destination.py`, `ingest/bronze_writer.py`) |
| **Warehouse export** | Pipeline wizard **Postgres / MySQL / ClickHouse / SQL Server** destination | **Load Gold tables** into customer’s existing SQL warehouse (JDBC/BI), not medallion file layout |
| **Warehouse compute** | EE `/lakehouse` (Compute tab) + `warehouse-compute` service | **Query** Gold (and federation) on the lake; scale replicas separately from ingest |

**Data → warehouse** object-storage connections (`iceberg`, `s3_parquet`, etc.) register buckets used as **pipeline lake roots** and optional Ask/federation targets. They are **not** the same as connecting Postgres/MySQL for NL→SQL, and they are **not** a substitute for **warehouse compute** when users need heavy SQL over Iceberg.

**Ask / charts execution** prefers lake Gold when the pipeline is ready (`QueryIdentity` + federation); export destinations are for systems that must read Gold inside the customer’s warehouse engine.

### Medallion object layout (S3 + Iceberg)

| Concern | Mechanism | Configurable? |
| --- | --- | --- |
| **Iceberg warehouse root** | `S3Target.root` from workspace storage or saved org bucket (`load/destination.py`) | Bucket + prefix per connection |
| **Iceberg namespace** | `catalog.namespace_for(org, layer)` → `org_<hex>_<layer>` | Catalog contract, not path strings |
| **Bronze Parquet keys** | `bronze_writer.bronze_key` under `orgs/{org_id}/bronze/…` (optional `bronze_landing` in customer bucket) | `bronze_landing` per pipeline |
| **Object prefix template** | `load/path_layout.py` — default `orgs/{org_id}/{layer}/` | Org `PATCH /pipelines/lakehouse-settings`, platform `lake_object_prefix_template`, env `AISER_LAKE_OBJECT_PREFIX_TEMPLATE` |

Common industry patterns (domain/`env` segment, `raw|curated|analytics`, Hive `db/table`) should map via the template — not hard-coded branches in writers. **Gaps (roadmap):** legal hold, bucket IAM audit UI, automated retention worker enforcement, regulatory report packs. **Done:** storage health, Governance hub tab, movement policy storage — see `server/docs/lakehouse-product.md`.

### Context plane (structured + unstructured intelligence)

Three stores, already wired in EE Ask:

| Store | Contents | Services |
| --- | --- | --- |
| **Structural** | Schema index, semantic metrics/dimensions, joins, NL→SQL patterns | `schema_retrieval_service`, `semantic_context_service`, `query_patterns` |
| **Documental** | KB chunks, citations | `RAGRetrievalService`, `document_chunks` (+ optional pgvector) |
| **Relational graph** | Pointer-only ontology + pipeline lineage | `ontology_*` tables, optional **Apache AGE** expand (`age_backend.py` — never required) |

**Memory tiers:** turn/session (`AiserWorkflowState`, `context_pack`), short-term (query/plan cache in orchestrator), long-term (`query_patterns`, KPI memory, `SmartContextEngineer`), team/org (`POST /ontology/backfill`, auto after pipeline deploy). Canonical map: `server/ee/modules/context_plane/`.

**Hybrid Ask:** RAG uses Schema RAG on the **structured** `data_source_id`, ontology expand boosts linked chunks, then `graph_retrieve` → NL2SQL. API sources support **`connection_config.streams[]`** and optional **`openapi_url`** for multi-endpoint catalogs (`api_stream_catalog.py`).

### Semantic layer (governed SSOT)

**Product name:** Semantic layer (not “Definitions” alone — that term is used in copy as *business definitions*: metrics, dimensions, joins). **Single SSOT:** `semantic_metrics` / `semantic_dimensions` plus `data_model_relationships` (table-level joins; optional `to_data_source_id` for cross-source). **Workbench:** project hub `/semantic-layer` → per source `/data/sources/{id}?tab=semantic` (Schema tab = physical tables; Semantic tab = business model). **Dashboards → Data modeling** is the same relationship API and graph components (`DataModelRelationships`, `ERDCanvas`) scoped to the dashboard’s selected source(s) — not a second model store; full metrics/certification stay in the semantic workbench. **Catalog** read-only via `GET /api/semantic/context`; **pipelines** publish draft measures (`semantic_publish.py`) and wizard joins (`relationship_publish.py`). Ask/SQL preview use `get_unified_semantic_context` (metrics, dimensions, `join_paths`, `prompt_hint`). **Direction:** project-wide ERD across all model-eligible sources in the project (cross-source joins already persistable); dashboard modeling becomes a thin embed of that view.

### Replication-log CDC (log_cdc)

Postgres WAL capture uses a Debezium-compatible inbox (`POST /api/pipelines/cdc/inbox`), scheduled ingest, and Silver **merge** that applies `_op = d` tombstones before upsert. Setup helpers and runbooks: [server/docs/log-cdc-postgres.md](docs/log-cdc-postgres.md).

### Batch vs near-real-time ingest (product contract)

| Mode | User-facing name | Mechanism | Typical use |
| --- | --- | --- | --- |
| `snapshot` / full refresh | Scheduled batch | Cron (or manual) reload of selected tables into Bronze → Silver/Gold | Small/medium tables, files, “must match source deletes” |
| `incremental` | Scheduled incremental | Watermark column (`updated_at`, etc.); each run pulls rows newer than last checkpoint | Large OLTP without hammering the source |
| `cdc` | Incremental + merge | Same watermark poll; Silver merge by primary key (soft deletes in source may remain in lake until full refresh) | Fact tables with stable keys |
| `log_cdc` | Near real-time | External Debezium (or compatible) → CDC inbox API → scheduled micro-batch ingest | Postgres WAL, hard deletes, lower latency than cron-only |

**Not** a managed streaming bus (Kafka/Flink) inside CE/EE: “real-time” is **inbox + frequent ingest jobs**. Scale-out is **worker/warehouse-compute** replicas, object storage (S3) for medallion files, and **incremental** modes to bound each run.

### Full load → incremental (coverage contract)

1. **First full refresh** lands the whole table in Bronze and supersedes prior Bronze snapshots for that table. Silver dedupe/merge uses **primary key** + **cursor** from the wizard.
2. **Watermark state** (`data_cdc_states`, connector `watermark`) advances on each incremental run and is **also baselined from the max cursor value after a full refresh** when a watermark column is configured — so switching to incremental after a full load does not reuse a stale high-water mark from an older era.
3. **Re-baseline**: `POST /api/pipelines/{id}/sync-position/reset` clears stored positions; the next incremental run reads from an empty checkpoint (full pull once, then watermark resumes). Use after a deliberate full reload or source backfill.
4. **Hard deletes** in the source are not removed by watermark-only incremental; schedule periodic full refresh or use `log_cdc`.
5. **Column selection** — SQL sources project at extract (`SELECT` subset + aliases on Bronze). **Files, sheets, S3 objects, REST/API, and NoSQL collections** project in Arrow after read (same `stream_selected_columns` / `stream_column_aliases` on `pipeline.options`). Silver compile still respects the same field map for transforms.
6. **Source kinds** — `pipeline_capabilities` + `source_profile` route discover/ingest/preview: **SQL** warehouses (Postgres, MySQL, SQL Server, ClickHouse HTTP, Snowflake, BigQuery, Redshift, Databricks, Oracle, Trino, Athena via `warehouse_urls` + `DirectSQLArrowExecutor`), **snapshot** (files, Google Sheets, S3/GCS/Azure prefixes, universal `api` sources, MongoDB collections), **query-only** (cube, knowledge_base). `GET /api/connectors/capabilities?data_source_id=` mirrors wizard gating.

### Scale (how we handle growth)

- **Extract**: Per-run row limits, incremental watermarks, OLTP guidance (replica, avoid full scan on prod). Bronze landing can be ingest-only (wizard) before heavy transforms.
- **Storage**: Medallion objects on `LAKE_ROOT` or S3; Iceberg loader for Gold; shared volume required on multi-container Docker when not on S3.
- **Compute**: ARQ worker runs pipeline jobs; `warehouse-compute` for heavy SQL; DuckDB/federation for Ask/charts on lake when ready (see execution path above).
- **Concurrency**: Pipeline runs are job-scoped; multi-query fan-out uses semaphores and budgets (separate from ingest).

### Data quality (DQ) in pipelines

- **Wizard / Silver YAML**: Type casts, filters, dedupe, validate steps; **quarantine** routes bad rows to a quarantine prefix without failing the whole sync (`quarantine_bad_rows`).
- **PII**: Optional masking step before Silver persist (hash/redact) in the transformation workbook.
- **Semantic layer**: Draft metrics from pipelines; **certification** in semantic workbench before treating numbers as official for Ask/dashboards.
- **Gaps vs full DQ vendors** (Great Expectations, Monte Carlo): No separate DQ SLA product yet — expectations are embedded in transform recipes and quarantine; observability is run history + table last_error on overview.

### Vendor checklist (honest positioning)

| Criterion | Aicser today | Direction |
| --- | --- | --- |
| Connectors | Universal sources + pipeline parity (SQL, files, S3, REST, Mongo snapshot) | Kafka/ES streaming ingest; deeper multi-stream API configs |
| Batch | Cron + manual | Same; clearer “schedule” copy in UI |
| Real-time | `log_cdc` + inbox | Documented runbook; not sub-second streaming |
| Scale | Workers + S3 lake + incremental | Autoscale workers; partition-aware extracts |
| DQ | Quarantine, validate steps, PII mask | Optional expectation library on Gold tables |
| Schema / field map | PK, cursor, include/rename/hash checklist, source preview, drift check | Bronze-only projection for files; DQ monitoring product |
| Lineage | OpenLineage export on pipeline detail | Catalog + column lineage surfaces |
| Security | Encrypted credentials, RLS on query path, tenant isolation | SCIM/RBAC (EE), audit on semantic certify |
| Cost control | Run stats, row limits, lake routing for Ask | Per-org compute quotas (EE hooks) |

