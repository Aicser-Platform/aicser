# Aicser

Aicser (AI Data Scientist) is an open-source data analytics and visualization platform. Connect data sources, build interactive charts and dashboards, and run SQL queries.

**Community Edition (CE)** is a SQL-first analytics studio: data connections, query editor, chart designer, dashboards, knowledge search, and social feed.

**Enterprise Edition (EE)** adds conversational analytics: ask questions in natural language via the AI Engine (`/chat`), AI orchestration, RBAC, billing, alerts, and the data platform services. Natural-language Q&A requires EE for business team and non-techncial users but CE still include AI Text-to-SQL with a natural-language prompting for ease of analysts and developers. 

## Repository layout

| Path | Edition | License |
| --- | --- | --- |
| `server/src/` | Community (CE) | AGPL-3.0 |
| `client/src/` | Community (CE) | AGPL-3.0 |
| `server/ee/` | Enterprise (EE) | Private submodule |
| `client/ee/` | Enterprise (EE) | Private submodule |

The public monorepo ships the Community Edition. Enterprise features live in private git submodules (`server/ee`, `client/ee`) and are loaded at runtime when an Enterprise license is present.

## CE vs EE

**Community Edition** includes dashboards, chart designer, data connections, SQL query editor, knowledge bases (document upload and search), notifications, feed, and user management. It also include NL-to-SQL with your own AI Provider's API key.

**Enterprise Edition** adds multi-tenancy, RBAC custom roles, billing, alerts (with agent investigate flow), scheduled AI briefings, collaboration social analytic feed, Telegram bots, embed SDK, AI chat, audit logs, and other paid enterprise features. 

Edition is controlled by environment variables:

```bash
AISER_EDITION=community              # or enterpirse (default)
AISER_EDITION_LICENSE_KEY=<key>       # presence also enables EE
NEXT_PUBLIC_EDITION=enterprise        # frontend edition flag
```

## Quick Start: Community Edition

Run Aicser CE locally with Docker Compose. The root CE compose file pulls
published images from GitHub Container Registry (GHCR), so users do not need a
local Node/Python toolchain.

```bash
git clone https://github.com/Aicser-Platform/aicser.git
cd aicser
cp .env.example .env
docker compose -f docker-compose.ce.yml pull
docker compose -f docker-compose.ce.yml up -d
```

Open http://localhost:3000.

Useful commands:

```bash
docker compose -f docker-compose.ce.yml logs -f server
docker compose -f docker-compose.ce.yml logs -f client
docker compose -f docker-compose.ce.yml down
docker compose -f docker-compose.ce.yml down -v   # reset all local CE data
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- CE-only and CE+EE setup with Docker Compose
- Submodule initialization
- Database migrations
- Contribution guidelines and licensing

For live-reload CE development from the repository root:

```bash
cp .env.example .env
docker compose -f docker-compose.dev.ce.yml up
```

## Enterprise Self-Host Images

Enterprise images are built from a checkout that includes the private EE
submodules. Secrets are supplied at runtime through the VPS `.env`; do not bake
API keys, database passwords, or license keys into images.
The app version shown in the user menu is stamped into the image at build time.

Build local self-host images:

```bash
git submodule update --init --recursive
NEXT_PUBLIC_API_URL=https://api.example.com \
make -C deploy ee-self-host-build
```

Build and push to a registry:

```bash
REGISTRY=ghcr.io/YOUR_ORG IMAGE_TAG=2026.07.31 PUSH=1 \
AISER_VERSION=1.1.2 \
NEXT_PUBLIC_API_URL=https://api.example.com \
make -C deploy ee-self-host-build
```

Or publish from GitHub Actions:

```text
Actions → Publish EE Self-Host Images to GHCR → Run workflow
```

For private EE submodules, add a repository secret named
`EE_SUBMODULE_TOKEN` with read access to the private submodule repositories.
The workflow publishes:

```text
ghcr.io/aicser-platform/aicser-server-ee
ghcr.io/aicser-platform/aicser-client-ee
```

Run on a VPS:

```bash
mkdir -p /opt/aiser
cp deploy/docker-compose.ee.self-host.yml /opt/aiser/
cp deploy/.env.ee.self-host.example /opt/aiser/.env
# edit /opt/aiser/.env
cd /opt/aiser
docker login ghcr.io
docker compose --env-file .env -f docker-compose.ee.self-host.yml pull
docker compose --env-file .env -f docker-compose.ee.self-host.yml up -d
```

The default self-host stack uses local authentication. After first login,
workspace admins can update SMTP/Resend and S3-compatible storage from Settings
→ Integrations → Email & Storage.

## License

- `server/src/`, `client/src/` — [AGPL-3.0](LICENSE)
