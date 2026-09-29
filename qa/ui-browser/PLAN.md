# Plan — UI browser QA track (isolated)

## Principle

Run **beside** feature development. Never block PRs on this track until Phase 3 opt-in CI. Never edit default `deploy/docker-compose.*.yml` or `deploy/.env`. Never couple to `server/ee/modules/ai/decisions/` (engine Jev) — that is a different product path.

## Phases

### Phase 0 — Scaffold (done in-repo)

- [x] `qa/` isolation charter
- [x] Personas + journeys + rubric + report writer
- [x] Dry-run CLI (`aicser-qa run --dry-run`)
- [x] Developer reports 00–06 + findings backlog
- [x] Optional compose overlay (docs only / no default services)

**Exit:** Another developer can read `reports/00-INDEX.md` and file FE work from backlog IDs without running the agent.

### Phase 1 — Lab spike (1–2 weeks, one owner)

- [ ] `make vendor-jev` + pin commit SHA in `reports/runs/VENDOR_PIN.md`
- [ ] Chrome harness doctor green on one laptop
- [ ] Live pass: `smoke_nav_chat`, `composer_controls_density` against local EE docker
- [ ] Human review of first 5 run reports; tune journey goals / checks
- [ ] Document flaky selectors / Ant Design portal issues

**Exit:** ≥3 journeys green with independent checks; known flakes listed in `reports/05-RUNBOOK.md`.

### Phase 2 — Persona coverage (ongoing)

- [ ] Weekly dry schedule: nontech + finance + sales_vp + data_engineer
- [ ] Add journeys: login, empty state, Settings, Knowledge, AI Decisions page, locale `km`/`th`/`vi` smoke
- [ ] Map each FAIL to backlog ID in `04-UI-FINDINGS-BACKLOG.md` (or new IDs)
- [ ] FE owners pick P0 findings into normal sprints (separate PRs)

**Exit:** Backlog items have owners; rubric trend chart optional.

### Phase 3 — Opt-in CI (only if Phase 1 stable)

- [ ] Nightly job (not required on PR) with secrets for TypeSafe/OpenRouter
- [ ] Artifact upload of `reports/runs/*.md`
- [ ] Still **non-blocking** for merge until flake rate &lt; 10%

**Exit:** Nightly dashboard link in team channel.

### Out of scope (explicit)

- Shipping jev-ultrafast inside the Aicser product Actions menu (separate spike)
- Replacing Playwright/Vitest component tests
- Air-gapped runs that need TypeSafe cloud (use dry-run + human checklist there)
- Modifying AI engine routing to “pass QA”

## Separation from other process

| Other process | Collision risk | Mitigation |
| --- | --- | --- |
| EE AI decision layer (Jev classify) | Low | Different module; QA does not import it |
| Narrative / forecast engine work | Medium (shared env) | QA uses fixed demo source + QA user |
| Main compose / `.env` | High if edited | Forbidden — QA uses `qa/ui-browser/.env` only |
| Client FE refactors | Expected | Reports point at files; journeys versioned here |

## Success metrics

- P0 journeys: independent check pass rate
- Rubric overall on `first_time_nontech` ≥ 3.5 before calling a surface “simple”
- Zero product compose file diffs required to run this track
