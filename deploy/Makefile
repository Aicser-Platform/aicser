DEPLOY_DIR := $(patsubst %/,%,$(dir $(abspath $(lastword $(MAKEFILE_LIST)))))
COMPOSE    := docker compose --project-directory $(DEPLOY_DIR)
DEV_BASE   := -f $(DEPLOY_DIR)/docker-compose.dev.yml
DEV_CE     := AISER_EDITION=community $(COMPOSE) -p aiser-dev-ce $(DEV_BASE) -f $(DEPLOY_DIR)/docker-compose.dev.ce.yml
DEV_EE     := AISER_EDITION=enterprise $(COMPOSE) -p aiser-dev-ee $(DEV_BASE) -f $(DEPLOY_DIR)/docker-compose.dev.ee.yml
DEV_CE_EXTRAS := $(DEV_CE) -f $(DEPLOY_DIR)/docker-compose.dev.extras.yml
DEV_EE_EXTRAS := $(DEV_EE) -f $(DEPLOY_DIR)/docker-compose.dev.extras.yml
DEV_LEGACY := $(COMPOSE) -p deploy $(DEV_BASE)
CE         := $(COMPOSE) -f $(DEPLOY_DIR)/docker-compose.ce.yml
EE         := $(COMPOSE) -f $(DEPLOY_DIR)/docker-compose.ee.yml

# ── Dev (live-reload, volume-mounted) ────────────────────────────────────────
dev: dev-ce

# Start only the CE development stack.
dev-ce:
	-$(DEV_LEGACY) down --remove-orphans
	-$(DEV_EE_EXTRAS) down --remove-orphans
	$(DEV_CE) up -d

dev-ce-build:
	-$(DEV_LEGACY) down --remove-orphans
	-$(DEV_EE_EXTRAS) down --remove-orphans
	$(DEV_CE) up -d --build

dev-ce-logs:
	$(DEV_CE) logs -f

dev-ce-down:
	$(DEV_CE_EXTRAS) down --remove-orphans

# Start only the EE development stack.
dev-ee:
	-$(DEV_LEGACY) down --remove-orphans
	-$(DEV_CE_EXTRAS) down --remove-orphans
	$(DEV_EE) up -d

dev-ee-build:
	-$(DEV_LEGACY) down --remove-orphans
	-$(DEV_CE_EXTRAS) down --remove-orphans
	$(DEV_EE) up -d --build

dev-ee-logs:
	$(DEV_EE) logs -f

dev-ee-down:
	$(DEV_EE_EXTRAS) down --remove-orphans

dev-ee-turbo:
	NEXT_DEV_TURBO=true $(DEV_EE) up -d --force-recreate client

# Optional services. These remain stopped during normal CE/EE development.
dev-ce-warehouse:
	$(DEV_CE_EXTRAS) --profile warehouse up -d clickhouse

dev-ee-warehouse:
	$(DEV_EE_EXTRAS) --profile warehouse up -d clickhouse

dev-ce-worker:
	$(DEV_CE_EXTRAS) --profile worker up -d worker

dev-ee-worker:
	$(DEV_EE_EXTRAS) --profile worker up -d worker

dev-ce-observability:
	$(DEV_CE_EXTRAS) --profile observability up -d

dev-ee-observability:
	$(DEV_EE_EXTRAS) --profile observability up -d

dev-down:
	-$(DEV_LEGACY) down --remove-orphans
	-$(DEV_CE_EXTRAS) down --remove-orphans
	-$(DEV_EE_EXTRAS) down --remove-orphans

dev-logs: dev-ce-logs

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
	$(DEV_EE) exec server python -m ee.scripts.seed_rbac

.PHONY: dev dev-ce dev-ce-build dev-ce-logs dev-ce-down dev-ee dev-ee-build \
        dev-ee-logs dev-ee-down dev-ee-turbo dev-ce-warehouse dev-ee-warehouse \
        dev-ce-worker dev-ee-worker dev-ce-observability dev-ee-observability \
        dev-down dev-logs ce ce-down ce-logs ce-restart ce-recreate ce-reset \
        ee ee-down ee-logs ee-client-light ee-restart ee-restart-client \
        ee-recreate ee-reset seed-rbac-ee seed-rbac-dev
