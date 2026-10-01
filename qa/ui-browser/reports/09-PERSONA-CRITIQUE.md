# 09 — Persona critique vs world-class analytics products

**Date:** 24 Sep 2026
**Input:** two screenshots (empty Ask screen; an AI-built lending dashboard), reports 04/07/08, and the code.
**Compared with:** ThoughtSpot (Spotter), Power BI Copilot, Tableau Pulse, Looker (Gemini), Hex, ChatGPT data analysis, Notion/Linear for general UX conventions.
**Audience:** product, FE, engine. Each finding names its root cause and where it was fixed; nothing below is a symptom patch.

---

## 1. Personas and what each one needs


| Persona                                      | First question they bring                         | What "good" feels like                                            | What world-class does                                                     |
| -------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Branch / ops manager** (low data literacy) | "How is my branch doing?"                         | One number, one sentence, one next step; no jargon                | Tableau Pulse: a metric card with a plain sentence of what changed        |
| **Executive / VP**                           | "Where are we losing money?"                      | Answer first, confidence stated plainly, a decision option        | Power BI Copilot summaries; ThoughtSpot "Spotter" answers with a headline |
| **Finance / risk analyst**                   | "Forecast NPL next quarter, and how sure are we?" | Honest range, method on request, reproducible numbers             | Hex / ChatGPT: method visible, code on demand                             |
| **Credit officer (case work)**               | "Should we restructure loan 111?"                 | The case file: the record, how it compares, what the options cost | Salesforce/nCino case views: the record, not a chart                      |
| **Data analyst / engineer**                  | "Show weekly order totals" in SQL                 | Correct SQL on the right table, types visible, fast editor        | Looker/Hex: governed metrics, SQL alongside                               |
| **IT admin**                                 | "Connect SSO, limit who sees which rows"          | Settings grouped by job; governance words they know               | Okta/Entra-style admin areas separated from personal settings             |




## 2. Screenshot 1: the empty Ask screen


| What a user saw                                                                         | Why it hurts adoption                                                                                                   | Root cause                                                                      | Fixed                                                                                                                                                          |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starter questions stayed as grey skeletons for ~27 s                                    | The first ten seconds decide whether a new user types anything. ChatGPT, Copilot and Spotter show starters instantly    | `/chat/discover` waited for an LLM before returning anything                    | Instant, data-aware starters (largest fact tables first, measures ranked) return at once; the model's refined set arrives in the background (`refining: true`) |
| Starters read like `order_total by store_region`                                        | Reads as a database, not a business                                                                                     | Identifiers were passed straight through                                        | Plain-names pass (`humanize_identifiers`); the prompt asks for business words                                                                                  |
| Five mode cards (Auto / Analyze / Forecast / Decide / Chat) competed with the questions | Asks "which engine?" before "what do you want to know?". World-class products lead with the question and route silently | The mode grid always rendered, expanded, under a heading that repeated the page | Questions lead; modes are a collapsed "More ways to answer (forecast, decide…)" row; Auto routes                                                               |
| "AI Engine" nav, "Data & Model", "Query Editor" beside Ask                              | Product vocabulary, not jobs                                                                                            | Nav labels were never reviewed for non-technical users                          | **Ask**, **My data** (data, SQL editor, knowledge, AI decisions), **Dashboards**, in all 10 languages                                                          |
| Model picker always under the composer                                                  | Nobody in the business personas knows what to pick; the engine already fails over (Gemini, hedged)                      | Picker had no disclosure level                                                  | Hidden; "Advanced → Choose model" turns it on and is remembered (also in the SQL editor)                                                                       |
| Sources panel showing `BIGINT`, every column expanded                                   | Signals "this is for engineers"                                                                                         | The tree always printed SQL types and auto-opened the first table               | Types on hover only                                                                                                                                            |




## 3. Screenshot 2: the AI-built lending dashboard


| What a user saw                                                | Why it hurts trust                                                             | Root cause                                                                                                                        | Fixed                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Charts titled "… by Branch" grouped by **NPL flag** (Y/N)      | One wrong chart discredits the whole dashboard; a VP won't open the second one | The planner's `x` was "branches.name"; it couldn't resolve a field of a *linked* table and fell back to a column of its own table | Planner resolves linked fields through the foreign key (`branch_id`, names shown by the chart engine); unreachable widgets are dropped, not faked. **6 saved charts repaired** with `python -m ee.scripts.repair_chart_groupings --apply` |
| An NPL filter `= 'Y'` on a true/false column returned nothing  | Silent empty widgets look like "no problem"                                    | String literal on a boolean column                                                                                                | Planner and repair script coerce Y/yes/1 to `true`                                                                                                                                                                                        |
| KPI "change" deltas that were implausible (total vs one month) | Finance users check the arithmetic first                                       | Delta compared the all-time total with the last period                                                                            | The card compares latest period with the prior one and says so ("latest vs prior period")                                                                                                                                                 |
| Values cut to "1.2…" and labels broken mid-word                | Looks unfinished                                                               | Fixed font size and ellipsis in a resizable card                                                                                  | Container-query font sizing; the icon hides below 220 px; labels wrap at words                                                                                                                                                            |
| Legend "Loans.outstanding Principal"                           | Leaks the schema                                                               | Table prefix kept in series names                                                                                                 | Prefix dropped                                                                                                                                                                                                                            |
| Titles like " Performance"                                     | Obvious machine output                                                         | Privacy-scrubber placeholders saved as titles (scrubber leak stopped at source on 31 Aug)                                         | Dashboard, Chart and Feed titles reject placeholders on save; old rows cleaned                                                                                                                                                            |




## 4. Beyond the screenshots: persona walk-throughs

**Branch manager:** a story layout gave one KPI data and four "Data unavailable — try refreshing" boxes. Refresh could never help. Now empty widgets say *Not connected to data yet*, and one click ("Use this data") fills the rest, with different measures per KPI. Failures are split into *no access* (no Retry), *couldn't load*, *taking too long* and *needs review*. The toggle reads **Edit / Done editing** (the Notion/Google convention), and Properties no longer falls off-screen on a tablet.

**Executive:** answers already lead with the summary above the chart. Dense daily forecast charts now offer "Show by week", which re-asks the engine, so the forecast is re-fitted at weekly grain rather than re-drawn. Forecast reliability is one plain phrase with a reason and a fix ("lower confidence — only 8 periods of history…").

**Credit officer:** Decide resolves a single case (loan, claim, defect) into a case file: the record, its peer ranking, its flags against base rates, and linked records. Options come with effort and timeline, and there's a "What did you decide?" record. No mainstream BI tool does per-case decisions; this is a differentiator worth marketing.

**Analyst:** SQL types stay visible in the SQL editor on purpose, since that is the analyst surface. "Weekly order totals" now compiles against the right table (a semantic shortcut used to put an inferred metric on the wrong table). The Chart Designer library used to say "0 charts" after a chart was built. The chart *was* saved; the list just never reloaded. It now refreshes when the canvas creates a chart.

**IT admin:** Settings is grouped **Me · Workspace · AI · Admin · Developer**, and permission filtering hides whole groups. Descriptions are plain ("Who can do what", not "Permissions and RBAC"), and everything is translated. The data-source governance badge says "1 share sees all rows" instead of "1 ungoverned grant".

## 5. Where Aicser now stands vs the leaders


| Capability                                    | Leaders                                  | Aicser now                                                                  | Gap to close next                                                 |
| --------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Question-first entry                          | Spotter, Copilot, ChatGPT                | Instant starters, modes secondary, Auto routing                             | Personalised starters from the user's role and recent questions   |
| Plain-language answers with honest confidence | Pulse, Copilot                           | Grounded numbers (T0/T1/T2), plain reliability phrase, considerations panel | A single "trust" line per answer (source, freshness, row count)   |
| Per-case decisions                            | none mainstream                          | Case file + options + decision record, reviewed by Jev                      | Close the loop: show outcomes of recorded decisions in Feed       |
| Dashboard authoring for non-technical users   | Power BI Copilot "create report", Looker | AI build 20–30 s with a real plan; one-click binding of empty widgets       | Describe-to-edit on an existing dashboard ("make this by region") |
| Governance language                           | Okta, Entra                              | Plain status, admin-only                                                    | Row-rule presets ("each branch sees its own rows")                |
| Localisation                                  | varies                                   | 10 locales across nav, settings, widgets, modes                             | Translate the remaining older English-only message namespaces     |




## 6. Verification

- Server: 1,553 AI-module tests pass. The 20 failures are pre-existing and listed in the release notes (sandbox needs pyarrow, licensing fixtures, stale timeout assertions).
- Client: 597 of 600 tests pass. The 3 failures are pre-existing (the mode-order test predates the committed constants; LicenseTab). New tests: widget error classification, empty-widget binding, dense daily axis, chart-grouping repair.
- `make eval` (51-question accuracy + all 15 modes) is the release gate; run it after deploy.

