# Aicser — Agent Context

This file is the canonical project brain for AI coding agents (Cursor, Claude Code, GitHub Copilot, etc.). Read it before making non-trivial changes.

**Related docs:** [CONTRIBUTING.md](CONTRIBUTING.md) · [README.md](README.md) · [client/DEVELOPMENT.md](client/DEVELOPMENT.md) · [server/ARCHITECTURE.md](server/ARCHITECTURE.md)

---

## What is Aicser?

**Aicser** (AI Data Scientist) is an open-source AI-powered data analytics and visualization platform. Users connect data sources, ask questions in natural language, get SQL, and build interactive charts and dashboards.

---

## Repository layout

| Path | Edition | License |
| --- | --- | --- |
| `server/src/` | Community (CE) | AGPL-3.0 |
| `server/ee/` | Enterprise (EE) | Private submodule |
| `client/src/` | Community (CE) | AGPL-3.0 |
| `client/ee/` | Enterprise (EE) | Private submodule |
| `deploy/` | Docker Compose stacks | — |
| `packages/` | Shared packages (e.g. embed) | — |

The public monorepo ships CE. EE lives in private git submodules and loads at runtime when licensed.

---

## Tech stack

### Backend (`server/`)

- **Python 3.11+**, **FastAPI** (async Uvicorn)
- **SQLAlchemy 2.0 async**, **PostgreSQL**, **Alembic**
- DB connectors: asyncpg, aiomysql, aioodbc, Snowflake, BigQuery, ClickHouse, Redshift
- **LiteLLM**, **LangChain**, optional **LangGraph** for AI orchestration
- **Redis** (cache/queue; in-memory fallback)
- **Pandas**, **DuckDB**, **NumPy**, **Scikit-learn**, **Prophet**
- **pytest** + **pytest-asyncio**, **Pydantic BaseSettings**

### Frontend (`client/`)

- **Next.js 14** (App Router), **React 18**, **TypeScript**
- **Ant Design 5**, **Zustand**, **TanStack React Query**
- **ECharts** / **Recharts**, **DuckDB WASM**, **Socket.IO** (EE collaboration)
- **Tailwind CSS**, **next-intl**, **Ace/Monaco** editors
- Path alias: `@/*` → `./src/*`

---

## CE vs EE

### Edition detection

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

Frontend: `NEXT_PUBLIC_EDITION=enterprise` (see README).

### Module shadowing (EE overrides CE)

EE modules shadow CE via `__path__` redirect in CE stubs:

```python
# server/src/modules/<module>/__init__.py
_ee_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "<module>"))
if os.path.isdir(_ee_path):
    __path__ = [_ee_path]
```

Application code always imports `src.modules.*` — shims redirect to `ee/modules/*` when present.

### CE server modules (`server/src/modules/`)

`authentication`, `charts`, `dashboards`, `data`, `queries`, `knowledge`, `notifications`, `onboarding`, `pricing`, `translations`, `user`, `feed`, `debug`, `embed`

**CE shims (EE-only at runtime):** `ai` and `chats` are `__path__` redirect stubs only. When EE is enabled, imports resolve to `server/ee/modules/ai/` and `server/ee/modules/chats/`; routers register conditionally in `server/src/core/router.py`.

### EE-only modules

`organizations`, `authentication` (Supabase SSO/RBAC override), `billing`, `alerts`, `bi_sync`, `catalog`, `lakehouse`, `platform`, `schedule_email`, `telegram`, `teams`, `knowledge_connectors`, `collaboration`, `ai`, `chats`, `project`, `invitations`

**AI orchestration (EE):** LangGraph via `POST /ai/analyze` is the canonical chat path. Legacy `chats/core/ai_flows` is deprecated.

### Hard rules

1. **CE must never import EE directly** — no `from ee...` or `from client/ee` in CE code.
2. **EE extends CE** via shims, conditional routers, and frontend dynamic imports from `@/ee`.
3. **Gate EE routes** with `is_ee_enabled()` on the backend; use `PermissionGuard` on EE frontend features.

---

## Backend module conventions

```
server/src/modules/<module_name>/
├── __init__.py          # optional EE path shim
├── models.py            # SQLAlchemy ORM
├── schemas.py           # Pydantic request/response
├── router.py            # FastAPI APIRouter
├── service.py           # async business logic
├── repository.py        # optional data access
└── services/ or utils/  # helpers for large modules
```

Register routers in `server/src/core/router.py` (most modules) or `server/src/main.py` for optional EE routers (`bi_sync`, `catalog`, `lakehouse`, `semantic_router`):

```python
from src.modules.<name>.router import <name>_router
api_router.include_router(<name>_router, prefix="/api/<name>", tags=["<name>"])
```

EE routers load conditionally:

```python
if is_ee_enabled():
    from src.modules.<ee_module>.router import <ee_module>_router
    api_router.include_router(...)
```

---

## Key domain models

| Entity | Table | Notes |
| --- | --- | --- |
| User | `users` | id, user_id, email, role, tenant_id, onboarding_progress |
| DataSource | `data_sources` | type, db_type, Fernet-encrypted `connection_config`, schema |
| Chart | `charts` | chart_type, chart_query (SQL), chart_options (JSONB) |
| Dashboard | `dashboards` | config (JSONB) |
| DashboardPage | `dashboard_pages` | layout_config, filters |
| DashboardChart | `dashboard_charts` | layout (JSONB) |
| Query | `data_queries` | natural_language_query, query_config |
| QueryPattern | `query_patterns` | nl_query, sql, embedding (pgvector) |
| KnowledgeDocument | `knowledge_documents` | chunk_count, status |
| DocumentChunk | `document_chunks` | content, embedding |
| Notification | `notifications` | type, message, is_read |

- Credentials: Fernet-encrypt before storing in JSONB; never log decrypted values.
- EE multi-tenancy: models carry `tenant_id`.

---

## Database patterns

```python
async with AsyncSession(engine) as session:
    result = await session.execute(select(Model).filter_by(id=record_id))
    record = result.scalar_one_or_none()
```

- Migrations: `server/alembic/versions/` via `alembic revision --autogenerate -m "..."`.
- Use CE head: `alembic -x edition=ce upgrade head` (EE head separately).
- UUID PKs via `gen_random_uuid()`; JSONB for flexible config.

---

## Frontend conventions

- Components: `client/src/components/<Category>/ComponentName.tsx`
- API: `client/src/services/apiService.ts` or hooks in `client/src/hooks/`
- State: Zustand in `client/src/stores/`; server state via React Query
- Routing: App Router — `(dashboard)/` protected, `(auth)/` public
- EE UI: `client/ee/src/ee/`; gate with `PermissionGuard.tsx`
- i18n: all user-facing strings via `next-intl`; messages in `client/src/messages/`

---

## Testing

**Backend** (`server/tests/`):

- `@pytest.mark.asyncio` with fixtures from `conftest.py` (`async_client`, `db_session`, `test_user`)
- Integration: `tests/integration/`; module tests: `tests/modules/`
- Mock LLM and external APIs in unit tests

**Frontend:** React Testing Library next to components.

---

## Deployment

Compose stacks in `deploy/`:

- `docker-compose.ce.yml` — CE (Postgres, Redis, FastAPI, Next.js)
- `docker-compose.ee.yml` — EE (billing, catalog, ClickHouse, AI/chat)
- `docker-compose.dev.yml` — local dev with hot reload

Setup: copy repo-root `.env.example` → `deploy/.env` (see CONTRIBUTING.md).

Required env: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET_KEY`, `AISER_EDITION`, `OPENAI_API_KEY` (or equivalent). EE also needs `AISER_EDITION_LICENSE_KEY`.

Production EE auth: **Supabase token exchange** (`SUPABASE_URL`, `JWT_SECRET`). Keycloak env vars are legacy hooks.

---

## Agent workflow rules

When implementing features, bug fixes, or refactors:

1. **Respect CE/EE boundaries** — use shims and conditional loading, not cross-edition imports.
2. **Async-first** — new service/repository methods must be `async def`.
3. **Security** — Fernet-encrypt credentials; validate at API boundary with Pydantic; never log secrets.
4. **Module structure** — follow models / schemas / router / service layout for new backend modules.
5. **Migrations** — any model change needs an Alembic migration.
6. **Tests** — add pytest coverage for new business logic; mock external calls.
7. **Minimal diffs** — match existing style; no unrelated refactors or new dependencies without reason.
8. **i18n** — new UI strings go in `client/src/messages/en.json` (and other locales when applicable).

---

## Common API routes (reference)

```
POST   /auth/login
POST   /auth/refresh
GET    /api/users/me
GET/POST /data/datasources
POST   /data/test-connection
GET    /data/{id}/schema
POST   /data/{id}/query
GET/POST /charts
GET/POST /api/dashboards
POST   /api/queries
POST   /knowledge/create
POST   /knowledge/upload
POST   /knowledge/search
GET    /health
GET    /docs
```

EE-only routes (when enabled): `/ai`, `/chats`, organizations, billing, etc. — see `server/src/core/router.py`.
