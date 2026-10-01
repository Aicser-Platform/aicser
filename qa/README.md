# QA tracks (isolated)

This directory holds **optional, side-channel quality work**. It does **not** run in
normal CE/EE compose stacks and must not block product development.

| Track | Path | Purpose |
| --- | --- | --- |
| UI browser agent (Jev Ultrafast) | [`ui-browser/`](ui-browser/) | Persona-driven UI journeys against a running local/dev Docker stack |

**Rules for all QA tracks**

1. Own Compose overlay / host Chrome only — never edit `deploy/docker-compose.*.yml` for defaults.
2. Own env file (`qa/**/.env`) — never require changes to `deploy/.env`.
3. Reports land under each track’s `reports/` for other developers; run artifacts are gitignored.
4. Do not import product code from `server/ee` or change AI engine behaviour from these harnesses.
