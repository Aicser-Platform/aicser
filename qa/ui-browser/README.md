# Aicser UI browser QA — Jev Ultrafast track

**Status:** Scaffolded lab track (optional). Does **not** run in default Docker compose.  
**Upstream:** [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) (MIT) — Jev picks click/type target; small LLM only for `TYPE_TEXT`.  
**Isolation:** Everything lives under `qa/ui-browser/`. Product AI decision layer (`server/ee/modules/ai/decisions/`) is unrelated and untouched.

## Why this exists

Programmers keep shipping features on the EE stack. In parallel, this track drives a real Chrome session against that stack to score **enterprise UI for all personas** (low-literacy → data engineer) and emit **developer reports** with file pointers and backlog IDs.

It is **not** a replacement for Playwright unit/component tests, and **not** a customer-facing browser agent in product.

## Prerequisites

1. Aicser already up (your existing Docker / `deploy` stack) — typically client `:3000`, API `:8000`.
2. Python 3.11+, [uv](https://github.com/astral-sh/uv).
3. For **live** agent runs: Chrome + Browser Harness, `TYPESAFE_API_KEY`, `TEXT_MODEL_API_KEY` (see `.env.example`).
4. Dedicated QA user (prefer non-admin).

## Quick start (zero impact on other work)

```bash
cd qa/ui-browser
cp .env.example .env   # fill QA user when ready; keys only for live agent
uv sync
make dry-run           # sample report, no Chrome, no vendor
```

Live agent (optional, separate):

```bash
make vendor-jev        # clones into vendor/ (gitignored)
make sync-agent
# ensure Chrome debugging via: cd vendor/jev-ultrafast && uv run browser-harness --doctor
uv run aicser-qa run --journey smoke_nav_chat
```

Optional Compose **overlay** (does not modify `deploy/docker-compose.*.yml`):

```bash
# from repo root — only if you want a named network alias; stack must already run
docker compose -f qa/ui-browser/docker-compose.qa.ui.yml config
```

## Layout

```
qa/ui-browser/
  README.md                 ← this file
  PLAN.md                   ← phased rollout
  reports/                  ← key docs for other developers
  personas/                 ← YAML personas
  journeys/                 ← YAML goals + independent checks
  harness/                  ← runner, verify, rubric, reports
  docker-compose.qa.ui.yml  ← optional overlay only
  vendor/                   ← gitignored clone of jev-ultrafast
```

## Keys (important)

**Yes — OpenRouter alone is sufficient** for Aicser QA Ultra, if you point System One at OpenRouter
(same as `server/ee/modules/ai/decisions/backends.py`):

```env
OPENROUTER_API_KEY=sk-or-...
TYPESAFE_API_KEY=$OPENROUTER_API_KEY          # alias
TYPESAFE_API_URL=https://openrouter.ai/api/v1/systemone
TYPESAFE_MODEL=typesafe/jev-1.13
TEXT_MODEL_API_KEY=$OPENROUTER_API_KEY
```

Upstream jev-ultrafast defaults to `api.typesafe.ai`; our vendor checkout under
`qa/ui-browser/vendor/jev-ultrafast` reads `TYPESAFE_API_URL` / OpenRouter defaults.
Verified: OpenRouter `/api/v1/systemone` returns HTTP 200 with `typesafe/jev-1.13`.

Also still need: `AISER_QA_*` for login, and Chrome + Browser Harness for the Ultra loop
(or use Cursor IDE browser probes as we did for scenario discovery).

From jev-ultrafast README: no frames/shadow DOM/canvas/uploads/pop-up tabs in MVP; `DONE` still needs **our** verifiers (`harness/verify.py`). Prefer journeys that stay in main document UI.

## Separation from engine Jev

| | Engine decision layer | This QA track |
| --- | --- | --- |
| Package | `server/ee/modules/ai/decisions/` | `qa/ui-browser/` |
| Purpose | Route/classify inside AI requests | Drive Chrome for UI scoring |
| Keys | `OPENROUTER_API_KEY` / `DECISION_LAYER_*` in deploy | `qa/ui-browser/.env` only |
| Affects product compose? | Yes (feature flags) | No |

## Reports for developers

Start at [`reports/00-INDEX.md`](reports/00-INDEX.md). Highest-leverage FE list: [`reports/04-UI-FINDINGS-BACKLOG.md`](reports/04-UI-FINDINGS-BACKLOG.md).
