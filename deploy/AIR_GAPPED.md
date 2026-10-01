# Air-gapped / sovereign deployment

Run Aicser EE with no prompts, data or decisions leaving your network. Start from
`.env.ee.self-host.example` and set the values below.

## 1. Language models: your own servers only

Use either an Ollama server or any OpenAI-compatible server (vLLM, TGI, LM Studio).

```env
# Ollama
OLLAMA_BASE_URL=http://ollama.internal:11434
OLLAMA_MODEL=qwen3:32b

# or an OpenAI-compatible server (vLLM etc.)
OPENAI_COMPAT_BASE_URL=http://vllm.internal:8000/v1
OPENAI_COMPAT_MODEL=Qwen/Qwen3-32B-Instruct
OPENAI_COMPAT_API_KEY=local-key

# Leave every hosted-provider key unset:
# OPENAI_API_KEY, AZURE_OPENAI_*, OPENROUTER_API_KEY, GOOGLE_API_KEY, GROQ_API_KEY
```

## 2. Enforce it: a deployment-wide AI residency policy

Even if a hosted key is configured by mistake later, this policy refuses every AI call to a
provider or host not on the list. It is checked on every LLM call and in the decision layer.

```env
AISER_AI_RESIDENCY_DEFAULT={"allowed_providers":["ollama","openai"],"allowed_hosts":["ollama.internal","vllm.internal"],"decision_layer":false}
```

`openai` is the provider name for OpenAI-compatible servers; the host list is what keeps them
on your network. Individual organizations can tighten this further under
**Settings → AI Residency**.

## 3. Embeddings: local (default)

```env
EMBEDDING_PROVIDER=local        # sentence-transformers inside the server container
```

## 4. Decisions: self-hosted Laya, or off

The hosted decision model (Jev) is unavailable offline. Either keep the decision layer off,
or run a fine-tuned Laya model on a GPU host:

```env
DECISION_LAYER_BACKEND=laya
LAYA_ENDPOINT=http://laya.internal:8080/decide
LAYA_SUPPORTED_SCRIPTS=Latin    # Laya abstains on scripts it wasn't trained on (e.g. Khmer)
DECISION_LAYER_MODES={"*":"shadow"}
```

Run in shadow mode first and switch a question set to `primary` only when
**Settings → Decision Layer** shows it ready and calibrated. AI Decisions (per-row questions)
uses Laya when configured, otherwise your local LLM.

## 5. Identity, audit and outside access

- **SSO / provisioning:** your IdP → **Settings → Identity (SCIM)** (base URL `/scim/v2`).
- **Audit to your SIEM:** `AUDIT_SIEM_URL` pointing at an internal collector.
- **Assistants on your network** can use Aicser through the MCP server at `/mcp` with a
  platform API key; they get the same row- and column-level security as the key's owner.

## 6. Verify before go-live

1. `docker compose logs server | grep -i "residency\|not allowed"` after asking a question —
   no blocked calls should appear for your local models.
2. Temporarily set a hosted key and ask a question: the call must be refused
   (`not allowed by this organization's AI residency policy`) and your local model answer instead.
3. From the server container, confirm there is no route to the internet
   (e.g. `curl -m 5 https://openrouter.ai` fails).
