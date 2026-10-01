# Developer reports — UI browser QA

Read in order. These are the **source of truth for FE/UX enhancement context** for this track.

| Doc | Audience | Purpose |
| --- | --- | --- |
| [01-TRACK-CHARTER.md](01-TRACK-CHARTER.md) | All | Isolation rules, what success means |
| [02-PERSONA-MATRIX.md](02-PERSONA-MATRIX.md) | PM + FE | Who we design for; literacy × surfaces |
| [03-JOURNEY-CATALOG.md](03-JOURNEY-CATALOG.md) | QA + FE | Journeys, tags, severity |
| [04-UI-FINDINGS-BACKLOG.md](04-UI-FINDINGS-BACKLOG.md) | FE leads | Actionable defects with file pointers |
| [05-RUNBOOK.md](05-RUNBOOK.md) | Whoever runs the agent | How to execute without breaking Docker |
| [06-RUBRIC.md](06-RUBRIC.md) | FE + design | 1–5 scoring dimensions |
| [08-DEPTH-DASHBOARD-CHART-QE.md](08-DEPTH-DASHBOARD-CHART-QE.md) | FE + PM | **Depth pass** — real actions on Dashboard, Chart Designer, Query Editor |
| [09-PERSONA-CRITIQUE.md](09-PERSONA-CRITIQUE.md) | PM + FE + engine | **Persona critique** vs ThoughtSpot, Power BI Copilot, Tableau Pulse, Looker, Hex: each finding with root cause and fix |
| [07-SCENARIOS-FOR-REFINEMENT.md](07-SCENARIOS-FOR-REFINEMENT.md) | FE + PM | Live tour catalog — all refinement scenarios (24 Sep 2026) |
| [10-USER-TEST-AI-DECISIONS-KNOWLEDGE-DATA.md](10-USER-TEST-AI-DECISIONS-KNOWLEDGE-DATA.md) | FE + PM | **Live end-user E2E** — `/ai-decisions`, `/knowledge`, data source manage tabs (24 Sep 2026) |
| [11-PROPERTIES-CHART-DASHBOARD.md](11-PROPERTIES-CHART-DASHBOARD.md) | FE + PM | **Properties per chart type** + build a live dashboard (24 Sep 2026) |
| [TEMPLATE-RUN-REPORT.md](TEMPLATE-RUN-REPORT.md) | QA | Shape of each run artifact |

Generated runs (gitignored): `reports/runs/*.md` + `*.json`.

Related product critique context (chat): AI Engine screenshot review — answer-first, nav jargon, Sources types, composer triad.

**24 Sep 2026 — engine review:** every finding in 04/07/08 now has a verdict and status. Engine-side fixes are verified: Query Editor NL→Run, forecast trust copy, the mode hint on Auto, and starter wording. Engine regressions are gated by `cd deploy && make eval`.
