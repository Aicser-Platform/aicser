# 01 — Track charter

## Mission

Use **browser-use/jev-ultrafast** as an internal QA agent to pressure-test Aicser UI against **enterprise personas of all literacy levels**, and write precise reports so frontend developers can enhance UX without guessing intent.

## Non-goals

- Not a product feature (no “browser agent” in customer Actions menu from this track).
- Not a substitute for the **engine** decision layer (`ee/modules/ai/decisions/` + TypeSafe Jev for routing/classify).
- Not allowed to mutate `deploy/.env` or default compose stacks.

## Isolation contract

| Allowed | Forbidden |
| --- | --- |
| `qa/ui-browser/**` | Editing `deploy/docker-compose.dev*.yml` for QA defaults |
| `qa/ui-browser/.env` | Requiring secrets in `deploy/.env` |
| Read-only HTTP against running stack | Writing migrations / EE AI nodes from this track |
| Opening FE PRs from backlog IDs | Blocking merges on agent flake (until Phase 3 policy) |

## Definition of a good report

1. **Persona** named and literacy level stated  
2. **Journey goal** quoted  
3. **Independent checks** pass/fail (never trust agent `DONE` alone)  
4. **Rubric** scores with **file owner hints**  
5. **Backlog ID** link (`F-NAV-01`, etc.) when failing  

## Relationship to Docker

Existing Docker remains the SUT (system under test). This track is a **client of that stack**, like a human tester with a scripted agent.
