# CE NL2SQL (Query Editor AI)

Community Edition ships a self-contained NL→SQL stack under `server/src/modules/nl2sql/` with **no dependency on `server/ee/`** or LangGraph.

## Features

- **Generate SQL** from natural language in the Query Editor
- **Explain SQL** and **Optimize SQL** (direct LLM calls)
- **BYOK** via Settings → API Keys → AI Provider Keys
- **Operator env keys**: `OPENAI_API_KEY`, `AZURE_OPENAI_*`, `OLLAMA_BASE_URL` + `OLLAMA_MODEL`
- **Few-shot learning** via `query_patterns` + optional pgvector (`embedding_vector`)
- **Rate limits** (per user, Redis-backed with in-memory fallback)

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/nl2sql/generate` | NL → SQL |
| POST | `/api/nl2sql/explain` | Explain SQL |
| POST | `/api/nl2sql/optimize` | Optimize SQL |
| GET | `/api/nl2sql/models` | List available models |
| GET | `/api/nl2sql/model-status?model_id=` | Model availability |
| POST | `/api/nl2sql/patterns` | Store successful NL/SQL pair after execution |

## Environment variables

CE NL2SQL uses the **same operator env as the rest of the stack** (`deploy/.env` copied from repo-root `.env.example`). You do not need separate `export OPENAI_API_KEY=...` unless you run the server outside Docker without those vars.

**Primary (Azure OpenAI)** — matches EE `litellm_service`:

| Variable | Description |
|----------|-------------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key |
| `AZURE_OPENAI_ENDPOINT` | Azure resource endpoint |
| `AZURE_OPENAI_DEPLOYMENT_NAME` | Chat deployment name (default model) |
| `AZURE_OPENAI_API_VERSION` | API version (e.g. `2024-02-15-preview`) |

Optional secondary Azure deployment: `AZURE_OPENAI_GPT41_*` (same shape as EE).

### LLM fallbacks

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | OpenAI fallback (used only when Azure/local not configured, or as secondary model) |
| `OPENAI_MODEL_ID` | OpenAI model (default: `gpt-4o-mini`; also accepts legacy `OPENAI_MODEL`) |
| `OLLAMA_BASE_URL` | e.g. `http://localhost:11434` |
| `OLLAMA_MODEL` | e.g. `llama3.1:8b` |
| `AISER_CUSTOM_MODELS` | JSON array of OpenAI-compatible model configs |

Legacy alias: `AZURE_OPENAI_DEPLOYMENT` is accepted but `AZURE_OPENAI_DEPLOYMENT_NAME` is preferred.

### Embeddings (few-shot / knowledge RAG)

Uses Azure when `AZURE_OPENAI_*` is set (same as EE `embedding_service`):

| Variable | Description |
|----------|-------------|
| `EMBEDDING_MODEL` / `AISER_EMBEDDING_MODEL` | Default: `text-embedding-3-small` |
| `EMBEDDING_API_KEY` / `AISER_EMBEDDING_API_KEY` | Falls back to `AZURE_OPENAI_API_KEY`, then `OPENAI_API_KEY` |
| `EMBEDDING_API_BASE` / `AISER_EMBEDDING_API_BASE` | Falls back to `AZURE_OPENAI_ENDPOINT` |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME` | Optional dedicated embedding deployment on Azure |

### Rate limits

| Variable | Default | Description |
|----------|---------|-------------|
| `AISER_CE_NL2SQL_RPM` | `20` | Generate requests per user per minute |
| `AISER_CE_NL2SQL_AUX_RPM` | `40` | Explain/optimize RPM |

### Quality tuning

| Variable | Default | Description |
|----------|---------|-------------|
| `AISER_CE_TWO_PASS_NL2SQL` | `true` | Two-pass table selection for large schemas |
| `AISER_CE_TWO_PASS_TABLE_THRESHOLD` | `20` | Min tables before two-pass runs |

## Ollama (local / air-gapped)

```bash
export OLLAMA_BASE_URL=http://localhost:11434
export OLLAMA_MODEL=llama3.1:8b
```

Users can also configure provider keys in the UI for cloud models (Gemini, OpenAI, etc.).

## Query Editor UI

- **Model pill** next to **Generate SQL** — same `ModelSelector` as chat (`compact` + `composerEmbed`); persists preference via Settings.
- Operator env models (Azure, OpenAI, Ollama) are **probed on `/models`** and only appear selectable when the connection check succeeds; stale `OPENAI_API_KEY` is ignored when Azure env is configured.
- **First-run modal** when no operator/BYOK models are available; links to **Settings → API Keys → AI Provider Keys** (`/settings?tab=api-keys&subtab=providers`).
- Generate/explain/optimize responses include `model_name` when the backend used an LLM.

## EE boundary

Enterprise Edition keeps conversational LangGraph analytics (`/ai/analyze`, chat UI, multi-step SQL, charts+insights from NL). CE Query Editor AI uses `/api/nl2sql/*` only.
