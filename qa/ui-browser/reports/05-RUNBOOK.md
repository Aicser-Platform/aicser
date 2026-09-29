# 05 — Runbook

## Before you start

1. Confirm product Docker (or local) is **already** healthy — this track does not start it.
2. Work only under `qa/ui-browser/`.
3. Copy `.env.example` → `.env` (gitignored). Do **not** put QA keys in `deploy/.env`.

## Dry run (safe anytime)

```bash
cd qa/ui-browser
uv sync
make dry-run
# → reports/runs/smoke_nav_chat_*.md
```

## Live agent

```bash
make vendor-jev          # once; clones gitignored vendor/
make sync-agent
# Chrome: follow vendor README — uv run browser-harness --doctor
# Fill TYPESAFE_API_KEY + TEXT_MODEL_API_KEY + AISER_QA_* in .env
uv run aicser-qa run --journey smoke_nav_chat
```

## Optional compose profile

```bash
docker compose -f qa/ui-browser/docker-compose.qa.ui.yml --profile qa-ui run --rm qa-ui-hints
```

Only curls host ports; does not alter product services.

## Interpreting results

| Outcome | Meaning |
| --- | --- |
| Exit 0 | Checks passed (or dry-run) |
| Exit 1 | Agent incomplete or soft check failures |
| Exit 2 | Blocker checks or rubric blockers |

Always open the markdown report: independent checks &gt; agent status.

## Flakes / known issues

| Symptom | Likely cause | Mitigation |
| --- | --- | --- |
| Agent stuck on overlays | Ant Design modal/portal | Prefer journeys that dismiss onboarding first; add WAIT in goal text |
| Cannot upload | Upstream MVP limit | Don’t write upload journeys yet |
| DONE but wrong page | Agent optimism | Strengthen `url_contains` / `text_present` checks |
| Cost spikes | Long max_steps | Cap `QA_MAX_STEPS`; keep goals narrow |

## Pinning upstream

After `make vendor-jev`:

```bash
git -C vendor/jev-ultrafast rev-parse HEAD > reports/runs/VENDOR_PIN.txt
```

Commit the pin file (not the vendor tree) when a lab week starts.

## Security

- QA user should lack billing/admin destructive rights when possible.  
- Traces may include page text — keep `reports/runs/` gitignored; redact before sharing externally.  
- TypeSafe/OpenRouter keys stay in `qa/ui-browser/.env` only.
