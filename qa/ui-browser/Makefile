.PHONY: help vendor-jev sync dry-run list doctor

help:
	@echo "Aicser UI browser QA (isolated track)"
	@echo "  make vendor-jev   Clone browser-use/jev-ultrafast into vendor/ (gitignored)"
	@echo "  make sync         uv sync (base) or uv sync --extra agent after vendor-jev"
	@echo "  make list         List personas/journeys"
	@echo "  make dry-run      Emit a sample report without Chrome/API keys"
	@echo "  make doctor       Check stack URL + optional browser-harness"

vendor-jev:
	@mkdir -p vendor
	@if [ ! -d vendor/jev-ultrafast/.git ]; then \
		git clone --depth 1 https://github.com/browser-use/jev-ultrafast.git vendor/jev-ultrafast; \
	else \
		echo "vendor/jev-ultrafast already present"; \
	fi

sync:
	uv sync

# After make vendor-jev — editable install of upstream (not part of default sync).
sync-agent: vendor-jev
	uv sync
	uv pip install -e vendor/jev-ultrafast

list:
	uv run aicser-qa list

dry-run:
	uv run aicser-qa run --journey smoke_nav_chat --dry-run

doctor:
	@echo "Checking AISER_BASE_URL (default http://localhost:3000)…"
	@curl -sf -o /dev/null -w "client HTTP %{http_code}\n" "$${AISER_BASE_URL:-http://localhost:3000}" || echo "client not reachable — start deploy stack first"
	@curl -sf -o /dev/null -w "api HTTP %{http_code}\n" "$${AISER_API_URL:-http://localhost:8000}/health" || echo "api /health not reachable"
	@if command -v uv >/dev/null && [ -d vendor/jev-ultrafast ]; then \
		cd vendor/jev-ultrafast && uv run browser-harness --doctor || true; \
	else \
		echo "Skip browser-harness doctor (vendor missing)"; \
	fi
