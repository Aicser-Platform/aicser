# Docker Compose CE/EE Client Deploy — Design Spec

**Date:** 2026-04-30  
**Branch:** move-frontend  
**Goal:** Wire the Next.js client into the existing CE and EE docker-compose stacks so both editions can be built and run with `docker compose up`.

---

## Context

- `deploy/docker-compose.ce.yml` — CE stack (postgres + redis + server). Client service exists but is commented out.
- `deploy/docker-compose.ee.yml` — EE stack (postgres + redis + clickhouse + server). Client service exists but is commented out.
- `client/Dockerfile.prod` — multi-stage Next.js build. No EDITION handling yet.
- `client/scripts/setup-ee.js` — postinstall script (already wired in `package.json`). Symlinks `ee/src/ee/` → `src/ee/` when the EE submodule is present; otherwise CE stubs in `src/ee/` are used.
- `client/ee/` — EE submodule directory. Content is already pushed to the private `aicser-ee-client` repo and present locally.

---

## Port Allocation

| Edition | Client (host) | Server (host) | Server (container-internal) |
| ------- | ------------- | ------------- | --------------------------- |
| CE      | `3000:3000`   | `8000:8000`   | `http://server:8000`        |
| EE      | `3000:3000`   | `8001:8000`   | `http://server:8000`        |

CE and EE are not meant to run simultaneously — both use client port 3000.

---

## Architecture

### 1. `client/Dockerfile.prod` — EDITION build arg

Add `ARG EDITION=community` at the top of the file (global scope, before any `FROM`).

The `deps` stage is unchanged — it only installs npm dependencies.

In the `builder` stage, after `COPY . .` (which copies the full source including `ee/`), add the symlink step:

```dockerfile
ARG EDITION=community
# Wire EE source for enterprise builds; CE uses src/ee/ stubs as-is
RUN if [ "$EDITION" = "enterprise" ] && [ -d "ee/src/ee" ]; then \
      rm -rf src/ee && ln -s /app/ee/src/ee src/ee; \
    fi
```

- **EE:** `ee/src/ee/` is present in the build context → symlink replaces `src/ee/` stubs → build compiles EE code
- **CE:** `ee/src/ee/` absent (or condition skipped) → `src/ee/` stubs remain → EE code never compiled

The `builder` stage also needs `ARG` declarations for `NEXT_PUBLIC_*` build args (already present in current Dockerfile):

- `NEXT_PUBLIC_API_URL` — browser-visible API URL
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anon key
- `NEXT_PUBLIC_EDITION` — `community` or `enterprise`

No git install, no BuildKit secrets, no tokens. The EE files are already present in the local build context.

### 2. `deploy/docker-compose.ce.yml` — uncomment client service

```yaml
client:
  build:
    context: ../client
    dockerfile: Dockerfile.prod
    args:
      EDITION: community
      NEXT_PUBLIC_EDITION: community
      NEXT_PUBLIC_API_URL: http://localhost:8000
      NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL:-}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}
  container_name: aiser-client-ce
  environment:
    API_TARGET: http://server:8000
  ports:
    - "3000:3000"
  depends_on:
    server:
      condition: service_healthy
  restart: unless-stopped
```

### 3. `deploy/docker-compose.ee.yml` — uncomment client service

```yaml
client:
  build:
    context: ../client
    dockerfile: Dockerfile.prod
    args:
      EDITION: enterprise
      NEXT_PUBLIC_EDITION: enterprise
      NEXT_PUBLIC_API_URL: http://localhost:8001
      NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL:-}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}
  container_name: aiser-client-ee
  environment:
    API_TARGET: http://server:8000
  ports:
    - "3000:3000"
  depends_on:
    server:
      condition: service_healthy
  restart: unless-stopped
```

No secrets block — EE files are already in the build context.

---

## Key Files Changed

| File                           | Change                                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `client/Dockerfile.prod`       | Add `ARG EDITION=community`; pass `NEXT_PUBLIC_EDITION` build arg; ensure `ee/` is copied in builder stage |
| `deploy/docker-compose.ce.yml` | Uncomment and wire client service                                                                          |
| `deploy/docker-compose.ee.yml` | Uncomment and wire client service                                                                          |

---

## How to Run

**CE:**

```bash
cd deploy
SECRET_KEY=your-secret docker compose -f docker-compose.ce.yml up --build
# App: http://localhost:3000  API: http://localhost:8000
```

**EE:**

```bash
cd deploy
SECRET_KEY=your-secret docker compose -f docker-compose.ee.yml up --build
# App: http://localhost:3000  API: http://localhost:8001
```

---

## Success Criteria

- `docker compose -f docker-compose.ce.yml up --build` starts postgres, redis, server, and client. Client is accessible at `http://localhost:3000` and calls API at `http://localhost:8000`.
- `docker compose -f docker-compose.ee.yml up --build` starts postgres, redis, clickhouse, server, and client. Client is accessible at `http://localhost:3000` and calls API at `http://localhost:8001`. EE pages (chat, alerts, billing, etc.) are accessible.
- CE image contains no EE source code.
- No tokens or credentials are required to build either image.
