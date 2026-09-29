# Template — UI QA run report

Machine runs also emit this shape via `harness/report_writer.py`.

```markdown
# UI QA run: `<journey_id>`

- **Run id:** …
- **Status:** …
- **Persona:** … (literacy=…)
- **Agent:** jev-ultrafast | dry_run
- **Final URL:** …
- **Rubric overall:** … / 5

## Journey goal
…

## Independent checks
- PASS/FAIL …

## Rubric
- **answer_first** n/5 — evidence → `owner`

## Notes for developers
…

## Where to fix
- backlog ID F-…
- files: …
```

Attach screenshots under `reports/artifacts/` (gitignored) when filing FE tickets.
