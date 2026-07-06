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

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- CE-only and CE+EE setup with Docker Compose
- Submodule initialization
- Database migrations
- Contribution guidelines and licensing

Quick start (CE):

```bash
git clone https://github.com/Aicser-Platform/aicser.git
cd aicser
cp .env.example deploy/.env   # fill in required values
cd deploy
docker compose -f docker-compose.ce.yml up -d
#OR use make if already have make command  
make ce
```

## License

- `server/src/`, `client/src/` — [AGPL-3.0](LICENSE)
