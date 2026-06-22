# Enterprise Knowledge Library design spec — internal reference (2026-05-23)

## North star

- **`/chat`** is the single LangGraph AI surface for employees.
- **`/knowledge`** is admin-only library curation (documents, reindex, retrieval test).
- **Embed assistants** are deployment profiles (libraries, capabilities, auth mode).

## Library scopes and ACL

| Scope | Read (`knowledge:search`) | Manage (`knowledge:manage_libraries` or `knowledge:edit`) |
|-------|---------------------------|-------------------------------------------------------------|
| `organization` | All org members with search permission | Org admins / curators |
| `project` | Project members | Project admins with knowledge edit |

Each library owns a backing `knowledge_base` `data_source_id` for unchanged RAG ingestion.

## Multi-library RAG

1. Resolve `kb_library_ids` → backing `data_source_ids` (ACL filtered).
2. `retrieve_multi`: top-k per library, dedupe by `chunk_id`, global score sort.
3. Optional rerank (`USE_RAG_RERANK`); merged context feeds existing RAG synthesis node.

## Embed assistant profiles

| Field | Purpose |
|-------|---------|
| `capabilities` | `rag_only` \| `full_engine` |
| `library_ids` | Allowed KB libraries |
| `allowed_modes` | e.g. `ai_search`, `standard` |
| `auth_mode` | v1: `session`; later `embed_jwt`, `anonymous` |

## Audit event catalog (v1)

| Category | Action | Metadata |
|----------|--------|----------|
| `ai` | `kb_query` | `library_ids`, `data_source_ids`, optional `query` if `AUDIT_LOG_QUERY_TEXT=true` |
| `api` | `POST /knowledge/libraries` | path, method |
| `api` | `POST /api/embed/tokens` | path, method |

## Legacy migration

Run `POST /knowledge/libraries/backfill-legacy?organization_id=` to wrap existing `knowledge_base` data sources as libraries (project-linked → `scope=project`, else `organization`).
