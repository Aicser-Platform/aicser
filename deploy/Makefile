DEPLOY_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
COMPOSE    := docker compose --project-directory $(DEPLOY_DIR)
DEV        := $(COMPOSE) -f $(DEPLOY_DIR)/docker-compose.dev.yml
CE         := $(COMPOSE) -f $(DEPLOY_DIR)/docker-compose.ce.yml
EE         := $(COMPOSE) -f $(DEPLOY_DIR)/docker-compose.ee.yml

# ── Dev (live-reload, volume-mounted) ────────────────────────────────────────
dev:
	$(DEV) up -d

# Start Ce Dev (live-reload, volume-mounted, with CE-specific services like Postgres and Redis)
dev-ce:
	$(DEV) --profile ce up -d

dev-down:
	$(DEV) down

dev-logs:
	$(DEV) logs -f

# ── CE build (rebuild image on code change, run migrations, start) ────────────
ce:
	$(CE) up -d --build

ce-down:
	$(CE) down

ce-logs:
	$(CE) logs -f

ce-restart:
	$(CE) restart server

# Rebuild + force-recreate (use after adding new migrations without code changes)
ce-recreate:
	$(CE) up -d --build --force-recreate server

# Stop everything and wipe volumes (fresh start)
ce-reset:
	$(CE) down -v


# EE DEV
dev-ee:
	AISER_EDITION=enterprise $(DEV) --profile ee up -d

dev-ee-build:
	AISER_EDITION=enterprise $(DEV) --profile ee up -d --build

dev-ee-down:
	AISER_EDITION=enterprise $(DEV) --profile ee down

dev-ee-logs:
	AISER_EDITION=enterprise $(DEV) --profile ee logs -f

dev-ee-turbo:
	AISER_EDITION=enterprise NEXT_DEV_TURBO=true $(DEV) --profile ee up -d --force-recreate client-ee

# -- EE build
ee:
	$(EE) up -d --build
ee-up:
	$(EE) up -d
ee-client-light:
	COMPOSE_PARALLEL_LIMIT=1 NEXT_BUILD_CPUS=1 NEXT_BUILD_MAX_OLD_SPACE_SIZE=1024 $(EE) build client
	$(EE) up -d --no-deps client
ee-down:
	$(EE) down
ee-logs:
	$(EE) logs -f
ee-restart:
	$(EE) restart server
ee-restart-client:
	$(EE) restart client
ee-recreate:
	$(EE) up -d --build --force-recreate server
ee-reset:
	$(EE) down -v

# ── RBAC seed ─────────────────────────────────────────────────────────────────
# Run inside the already-running EE container (prod build)
seed-rbac-ee:
	$(EE) exec server python -m ee.scripts.seed_rbac

# Run inside the already-running dev container
seed-rbac-dev:
	$(DEV) exec chat2chart-server python -m ee.scripts.seed_rbac

.PHONY: dev dev-ce dev-down dev-logs ce ce-down ce-logs ce-restart ce-recreate ce-reset \
        dev-ee dev-ee-build dev-ee-down dev-ee-logs dev-ee-turbo ee ee-down ee-logs \
        ee-client-light ee-restart ee-restart-client ee-recreate ee-reset seed-rbac-ee seed-rbac-dev
