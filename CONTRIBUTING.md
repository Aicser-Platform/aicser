# Contributing to Aicser

Thank you for your interest in contributing! This guide explains how the project is structured across the Community Edition (CE) and Enterprise Edition (EE) so you can develop confidently in either.

---

## Repository Structure

Aicser uses a **monorepo + submodule** model:

```
aicser/                        ← Public CE monorepo (this repo)
├── server/
│   ├── src/                   ← CE server source (Python / FastAPI)
│   └── ee/                    ← Git submodule → aicser-ee-server (private)
├── client/
│   ├── src/                   ← CE client source
│   └── ee/                    ← Git submodule → aicser-ee-client (private)
├── deploy/
│   ├── docker-compose.ce.yml  ← CE stack
│   ├── docker-compose.ee.yml  ← EE stack
│   └── docker-compose.dev.yml ← Local dev stack
└── .gitmodules                ← Submodule definitions
```

| Repo               | Visibility | Contains                                                     |
| ------------------ | ---------- | ------------------------------------------------------------ |
| `aicser`           | Public     | CE code + submodule pointers for `server/ee` and `client/ee` |
| `aicser-ee-server` | Private    | EE-only server modules                                       |
| `aicser-ee-client` | Private    | EE-only client modules                                       |

> **Note:** If you do not have access to the EE private repos, the `server/ee` and `client/ee` directories will be empty. The CE platform runs fully without them.

---

## CE vs EE — What Goes Where

### Community Edition (CE)

CE code lives under `server/src/` and `client/src/`. These features are open-source (AGPL-3.0) and available to everyone.

**CE server modules** (`server/src/modules/`):

| Module           | Description                   |
| ---------------- | ----------------------------- |
| `authentication` | Basic user auth (JWT)         |
| `charts`         | Chart creation and management |
| `dashboards`     | Dashboard builder             |
| `data`           | Data source connections       |
| `queries`        | SQL query engine              |
| `knowledge`      | Knowledge base                |
| `notifications`  | In-app notifications          |
| `onboarding`     | User onboarding flows         |
| `pricing`        | Pricing page (CE tier info)   |
| `translations`   | i18n support                  |
| `user`           | User profile management       |
| `feed`           | Activity feed                 |
| `debug`          | Debug utilities               |


## How CE and EE Coexist at Runtime

EE modules are loaded **only when** the platform detects an Enterprise license. This is controlled by two environment variables:

```bash
AISER_EDITION=enterprise          # explicitly set edition
AISER_EDITION_LICENSE_KEY=<key>   # presence of a key also enables EE
```

If neither is set, the platform runs in **Community Edition** mode.

### Import Shim Pattern

EE modules shadow the CE module namespace using `__path__` redirect shims. For every EE module, there is a corresponding stub in `server/src/modules/<module>/__init__.py`:

```python
# server/src/modules/organizations/__init__.py
import os as _os
_ee_path = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "organizations"))
if _os.path.isdir(_ee_path):
    __path__ = [_ee_path]
```

This means application code always imports from `src.modules.*` — the shim transparently redirects to `ee/modules/*` when the EE directory is present.

---

## Setting Up for Development

### CE Only

```bash
git clone https://github.com/Aicser-Platform/aicser.git
cd aicser/deploy
cp .env.example .env   # fill in required values
docker compose -f docker-compose.ce.yml up -d
```

### CE + EE (requires EE repo access)

```bash
git clone --recurse-submodules https://github.com/Aicser-Platform/aicser.git
cd aicser/deploy
cp .env.example .env
# set AISER_EDITION=enterprise and AISER_EDITION_LICENSE_KEY=<your-key> in .env
docker compose -f docker-compose.ee.yml up -d
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

---

## Running Database Migrations

Migrations are managed with Alembic. Run them against a running stack:

```bash
docker run --rm \
  --network aiser-ce-network \
  -v $(pwd)/server/alembic/versions:/app/alembic/versions \
  -e DATABASE_URL="postgresql+asyncpg://postgres:<pass>@aiser-postgres-ce:5432/aiser_world_db" \
  -e SECRET_KEY=<secret> \
  -e ENVIRONMENT=production \
  deploy-server \
  alembic -c alembic.ini upgrade head
```

To generate a new migration:

```bash
# replace "upgrade head" with:
alembic -c alembic.ini revision --autogenerate -m "describe your change"
```

---

## Contributing Guidelines

- **CE contributions** — open a PR against this repo (`aicser`). All changes under `server/src/` and `client/src/` are welcome.
- **EE contributions** — work directly in the `server/ee` or `client/ee` submodule directories and push to the respective private repo. Update the submodule pointer in this repo with a follow-up commit.
- Follow existing code style; no new dependencies without discussion.
- Write tests for new business logic where possible.

---

## License

- `server/src/`, `client/src/` — [AGPL-3.0](LICENSE)
- `server/ee/`, `client/ee/` — Proprietary (see `server/ee/LICENSE`)
