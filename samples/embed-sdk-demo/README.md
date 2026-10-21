# Embed SDK demo

A small "customer app" for trying Aicser's embed SDKs against a running Aicser. The same page runs
on two interchangeable backends, so you can check that both server SDKs behave the same:

| Backend | Port | Signs links with | Browser SDK |
| --- | --- | --- | --- |
| `node/` | 4000 | [`@aicser/embed/server`](../../packages/embed) (npm) | `@aicser/embed` from `node_modules` |
| `python/` | 4001 | [`aicser-embed`](../../packages/embed-python) (PyPI) | `@aicser/embed` from jsDelivr |

```
browser (web/app.js)            demo server (node/ or python/)          Aicser
  embedDashboard({ getToken }) ─▶ POST /api/embed-token
                                    signEmbedUrl / sign_embed_url ─────▶ POST /api/embed/sign (API key)
                                 ◀─ { token }                       ◀─── single-use link token
  iframe /embed/dashboard/<id>?token=… ──────────────────────────────▶ opens session, renders
```

The API key stays on the demo server. Each signed link opens once, so the SDK calls `getToken()`
for every mount, before the session expires (silent renewal), and when a link fails to open.

## Setup

1. Start Aicser (for example `make ee` in `deploy/`). The defaults expect the API on `:8001` and
   the web app on `:3001`.
2. In Aicser, create an **API key** (Settings → API keys) and note a **dashboard id** (and
   optionally a chart id). Embedding needs a plan with `embed_analytics`.
3. `cp .env.example .env` and fill in `AICSER_API_KEY` and `AICSER_DASHBOARD_ID`.

## Run

Node (22+):

```bash
cd node && npm install && npm start          # http://localhost:4000
```

Python (3.8+):

```bash
cd python
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python server.py                    # http://localhost:4001
```

To test SDK changes before they are published, install the local packages instead:
`npm install ../../../packages/embed` (run `npm run build` there first) or
`.venv/bin/pip install -e ../../../packages/embed-python`.

## What to try

- **Mount**: the event log shows `getToken()`, then two `ready` messages. The first comes from the
  page layout; the second, with `kind: "dashboard"`, means the view loaded and accepts commands.
- **Host commands**: `refresh()`, `setFilters()`, `setPage()` and `exportImage()` resolve or
  reject with the embed's `command-result`. With `DOWNLOAD=none`, exports are refused.
- **Signed in as**: switching customer remounts with a new link. With `LOCKED_FILTER_FIELD` set,
  each customer only sees rows where that column equals their name. The server sets the filter
  from the "session"; the browser can't change it.
- **Silent renewal**: with `EXPIRES_IN_MINUTES=5`, about 2 minutes before expiry the log shows
  `token-expiring` → `getToken()` → `token-updated`, and the view doesn't reload.
- **Assistant chat** (set `AICSER_ASSISTANT_ID` and `AICSER_CHAT_TOKEN`): mounted with
  `embedChat({ assistantId, token })`. It uses the shared chat token from Settings rather than
  `getToken()`, since chat links can't be signed per visitor yet. The host commands don't apply to
  chat, and locked filters don't either: every visitor can ask about all of the assistant's data.
- **Single use**: copy the iframe URL from devtools and open it in a new tab. It says the link
  was already opened.

## Notes

- `/api/embed-token` has no login here. In a real app it sits behind your own auth, and the
  customer (and so the locked filter) comes from the signed-in user, never from the request body.
- `ALLOWED_DOMAINS` only admits `https://` sites, so leave it empty while the demo runs on
  `http://localhost`.
- A locked filter column must exist in every table the dashboard queries; otherwise its charts
  fail rather than show unfiltered data.
