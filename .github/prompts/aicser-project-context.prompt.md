---
name: "Aicser Project Context"
description: "Use when working on any feature, bug fix, module, or architectural question in the Aicser codebase. Provides full CE/EE project knowledge."
argument-hint: "Describe the task or question (e.g., 'add a new analytics module', 'fix NL2SQL for BigQuery')"
agent: "agent"
tools: ["search", "read_file", "file_search", "grep_search"]
---

# Aicser Project — Full Context

You are working on **Aicser** (AI Data Scientist), an open-source AI-powered data analytics and
visualization platform. It lets users ask questions in natural language, converts them to SQL,
and renders interactive charts and dashboards.

## Tech Stack

### Backend (`server/`)

- **Python 3.11+**, **FastAPI** (async with Uvicorn)
- **SQLAlchemy 2.0 async** ORM, **PostgreSQL** (primary DB), **Alembic** (migrations)
- **asyncpg** (PostgreSQL), **aiomysql** (MySQL), **aioodbc** (SQL Server), plus Snowflake, BigQuery, ClickHouse, Redshift connectors
- **LiteLLM** + **LangChain** + **LangGraph** (optional) for AI/LLM orchestration
- **Redis** for caching and job queue (in-memory fallback if Redis unavailable)
- **Pandas**, **DuckDB**, **NumPy**, **Scikit-learn**, **Prophet** for data processing
- **pytest** + **pytest-asyncio** for testing
- **Pydantic BaseSettings** for configuration

### Frontend (`client/`)

- **Next.js 14** (React 18), **TypeScript**
- **Ant Design 5.x** with custom theming
- **Zustand** (state) + **TanStack React Query** (server state)
- **ECharts** / **Recharts** for visualization
- **DuckDB WASM** for in-browser data processing
- **Socket.IO** client for real-time collaboration
- **Tailwind CSS**, **next-intl** for i18n, **Ace/Monaco** editors

---

## CE vs EE Architecture

The repo is a monorepo with two editions:

| Path          | Edition         | License           |
| ------------- | --------------- | ----------------- |
| `server/src/` | Community (CE)  | AGPL-3.0          |
| `server/ee/`  | Enterprise (EE) | Private submodule |
| `client/src/` | Community (CE)  | AGPL-3.0          |
| `client/ee/`  | Enterprise (EE) | Private submodule |

### Edition Detection (runtime)

```python
# server/src/core/edition.py
def is_ee_enabled() -> bool:
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    if edition in ("enterprise", "ee"):
        return True
    if os.getenv("AISER_EDITION_LICENSE_KEY", "").strip():
        return True
    return False
```

### Module Shadowing (EE overrides CE)

EE modules shadow CE counterparts via `__path__` redirect:

```python
# server/src/modules/<module>/__init__.py
_ee_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "<module>"))
if os.path.isdir(_ee_path):
    __path__ = [_ee_path]
```

### CE Modules (`server/src/modules/`)

`authentication`, `charts`, `dashboards`, `data`, `queries`, `knowledge`, `notifications`,
`onboarding`, `pricing`, `translations`, `user`, `feed`, `ai` (minimal), `chats`, `debug`

### EE-Only Modules

`organizations` (multi-tenancy), `authentication` (Keycloak SSO, RBAC override),
`billing` (Stripe), `alerts`, `bi_sync`, `catalog`, `lakehouse`, `platform` (audit logs),
`schedule_email`, `telegram`, `collaboration` (Socket.IO)

---

## Module Conventions

Every module follows this structure:

```
server/src/modules/<module_name>/
├── __init__.py          # optional EE path shim
├── models.py            # SQLAlchemy ORM models
├── schemas.py           # Pydantic request/response schemas
├── router.py            # FastAPI APIRouter (endpoints)
├── service.py           # Business logic (async methods)
├── repository.py        # Data access (optional, for complex queries)
└── services/ or utils/  # Sub-services and helpers for large modules
```

**Router registration**: Add to `server/src/core/router.py`

```python
from src.modules.<name>.<router_file> import <name>_router
api_router.include_router(<name>_router, prefix="/api/<name>", tags=["<name>"])
```

**EE conditional routers** are loaded with:

```python
if is_ee_enabled():
    from src.modules.<ee_module>.router import <ee_module>_router
    api_router.include_router(...)
```

---

## Key Domain Models

| Entity            | Table                 | Key Fields                                                                                                 |
| ----------------- | --------------------- | ---------------------------------------------------------------------------------------------------------- |
| User              | `users`               | id, user_id, email, role, tenant_id, onboarding_progress                                                   |
| DataSource        | `data_sources`        | id, type (file/database), db_type, connection_config (JSONB, Fernet-encrypted), schema, user_id, tenant_id |
| Chart             | `charts`              | id, data_source_id, chart_type, chart_query (SQL), chart_options (JSONB)                                   |
| Dashboard         | `dashboards`          | id, name, config (JSONB)                                                                                   |
| DashboardPage     | `dashboard_pages`     | id, dashboard_id, page_order, layout_config, filters                                                       |
| DashboardChart    | `dashboard_charts`    | id, dashboard_id, chart_id, layout (JSONB)                                                                 |
| Query             | `data_queries`        | id, data_source_id, natural_language_query, query_config, result_count                                     |
| QueryPattern      | `query_patterns`      | id, user_id, data_source_id, nl_query, sql, embedding (pgvector)                                           |
| KnowledgeDocument | `knowledge_documents` | id, data_source_id, filename, file_type, chunk_count, status                                               |
| DocumentChunk     | `document_chunks`     | id, document_id, chunk_index, content, embedding                                                           |
| Notification      | `notifications`       | id, user_id, type, message, is_read                                                                        |

**Credential security**: Database passwords and API keys are Fernet-encrypted before storage in JSONB columns.
**Multi-tenancy**: All EE models carry `tenant_id` for org isolation.

---

## API Route Structure

```
POST   /auth/login                 # JWT login
POST   /auth/refresh               # Refresh token
GET    /api/users/me               # Current user
GET/POST /data/datasources         # List/create data sources
POST   /data/test-connection       # Test DB connection
GET    /data/{id}/schema           # Get database schema
POST   /data/{id}/query            # Execute SQL
GET/POST /charts                   # List/create charts
GET/POST /api/dashboards           # List/create dashboards
POST   /api/queries                # Execute natural language query
POST   /knowledge/upload            # Upload document (RAG)
POST   /knowledge/search            # Semantic search
GET    /api/rbac/me/permissions       # Current user permissions (EE)
GET    /health                     # Health check
GET    /docs                       # OpenAPI (auto-generated)
```

---

## Database Patterns

**Async session pattern**:

```python
async with AsyncSession(engine) as session:
    result = await session.execute(select(Model).filter_by(id=record_id))
    record = result.scalar_one_or_none()
```

**Migrations**: Add to `server/alembic/versions/` via `alembic revision --autogenerate -m "description"`.
Use CE head (`alembic -x edition=ce upgrade head`) or EE head separately.

**UUID primary keys**: All models use `gen_random_uuid()` PostgreSQL default.
**JSONB**: Used for chart options, schema caches, connection configs, embeddings.

---

## Frontend Conventions

**Component location**: `client/src/components/<Category>/ComponentName.tsx`
**API calls**: Via `client/src/services/apiService.ts` (Axios wrapper) or TanStack Query hooks in `client/src/queries/`
**State**: Zustand stores in `client/src/stores/`; server state via React Query
**Routing**: Next.js App Router; protected routes in `app/(dashboard)/`; auth routes in `app/(auth)/`
**EE components**: Live in `client/ee/src/ee/` (submodule). Feature-flag gating via `PermissionGuard.tsx`
**Internationalization**: All user-facing strings via `next-intl`; message files in `client/src/messages/`

---

## Testing Patterns

**Backend** (`server/tests/`):

- Use `pytest-asyncio` with `@pytest.mark.asyncio`
- Fixtures in `conftest.py` — provides `async_client`, `db_session`, `test_user`
- Integration tests in `tests/integration/`, module tests in `tests/modules/`
- Mock LLM calls to avoid external API costs in unit tests

**Frontend**: Tests next to components; use standard React Testing Library conventions.

---

## Deployment

Three Docker Compose stacks in `deploy/`:

- `docker-compose.ce.yml` — CE (Postgres + Redis + FastAPI + Next.js)
- `docker-compose.ee.yml` — EE (adds Keycloak auth, billing, catalog services)
- `docker-compose.dev.yml` — Local dev with hot reload

**Required env vars**: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY`, `AISER_EDITION` (community|enterprise),
`AISER_EDITION_LICENSE_KEY` (EE only), `OPENAI_API_KEY` or equivalent LLM key.

---

## Task Instructions

When completing the user's task, follow these project rules:

1. **Respect the CE/EE boundary**: CE code (`server/src/`, `client/src/`) must never import from `server/ee/` or `client/ee/` directly. EE features must use the module shadowing pattern.
2. **Async-first**: All new service and repository methods must be `async def`.
3. **Security**: Encrypt sensitive credentials with Fernet before storing. Validate all inputs at API boundary via Pydantic schemas. Never log decrypted credentials.
4. **Module structure**: New modules must follow the models / schemas / router / service pattern.
5. **Migrations**: Any model change requires an Alembic migration.
6. **Tests**: Add pytest tests for new services; mock external (LLM, DB) calls.
7. **Permissions**: Use `PermissionGuard` on EE-only frontend features; check `is_ee_enabled()` on EE-only backend routes.

Now proceed with the user's specific task or question.
