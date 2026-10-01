# 04 — UI findings backlog (for frontend developers)

**Context:** Derived from AI Engine / shell UX review (Sep 2026) plus journey design for low-literacy enterprise users.  
**How to use:** Pick an ID into a normal FE PR. Link the ID in the PR description. Mark status in this table when done.

Status: `open` | `in_progress` | `done` | `wontfix` | `data` (content/config, not a code defect)

**Verdict** (engine review, 24 Sep 2026): ✅ worth doing as written · ✏️ worth doing, refined below · ⏸ needs a product decision first. Every finding was checked against the code or reproduced; nothing below is taken on trust.

## Review summary (24 Sep 2026)

- **All findings are worth acting on.** None were rejected. Two are data, not code (F-KNOW-01 "KBb" is a library a user named; the "Aiccser" byline in S-FEED-04 isn't the org name, which is "Aicser").
- **One blocker had a different root cause than suspected.** D-QE-02/03 wasn't a catalog mismatch. A semantic-layer shortcut compiled SQL from an *auto-inferred* metric and put it on the first table (`SUM(orders.order_total) … FROM inventory`), dropping "weekly". It's fixed in the engine and verified, with 100% on the 51-question accuracy eval.
- **Done in this pass:** F-CHAT-03, 04, 10, 11, 13; F-QE-02; F-BE-01, 02; S-ASK-02 (starter wording). See each row.
- **Second pass (24 Sep, later):** every remaining open row is done except the brand decision already taken (Ask). Saved dashboards that promised “by Branch” but grouped by the NPL flag were repaired by `python -m ee.scripts.repair_chart_groupings --apply` (6 charts; dry run by default). Dashboard widget errors now say *not connected yet* / *no access* / *couldn't load* / *field or query needs review* (D-DASH-05).
- **Duplicate ID fixed:** there were two `F-DASH-01`s. The story-layout binding item is now **F-DASH-03**.

## P0 — Simple & trustworthy Ask

| ID | Finding | Persona hit | Where to change | Acceptance (precise) | Verdict | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-CHAT-01 | Answer is not first: dense chart dominates before plain summary/insights | nontech, VP, finance | `client/ee/.../ChatPanel/ChatPanelMain.tsx`, chart/insight message components | After a forecast/analyze response, a headline + ≤3 insight cards appear **above** or clearly beside the chart before scrubbing; empty insights never look “done” | ✅ P0. The server streams the narrative before the chart is final, so this is layout only. Pair with the **“What this answer took into account”** panel (below) — **24 Sep (later):** Already answer-first in code: with data + chart, the summary is lifted above the Answer/Data table tabs, then chart, then insights; the considerations panel carries partial answers | done |
| F-CHAT-02 | Forecast chart too dense (daily spikes) without default aggregation cue | finance, nontech | Chart options / mode SQL grain / chart renderer | Default forecast grain weekly or show “Showing daily — switch to weekly” control in plain language | ✏️ Keep the data grain; offer the switch. When daily history is short or volatile, the engine now says why reliability is low and suggests “forecast a longer period (e.g. months instead of days)”. The UI control is still to do — **24 Sep (later):** “Showing daily points. [Show by week]” appears under any chart with 90+ consecutive daily points (`utils/denseTimeAxis.ts`); it asks the engine again at weekly grain, so a forecast is re-fitted, not just re-drawn | done |
| F-CHAT-03 | Model blend names (`ets + croston + moving_avg`) in primary UI | nontech | Forecast approaches UI under chart | Default label “Best forecast”; algorithm names only under **Advanced / Compare methods** | ✅ Now a collapsed **“How this forecast was made”** link, translated (it was hard-coded English). Method notes come from `echarts_config.aiserForecastDetails` | done |
| F-CHAT-04 | “Lower confidence (~0%)” without why or fix | finance, nontech | Forecast confidence chip / copy | Must show one plain reason + one suggested fix; never bare `~0%` alone | ✅ `forecast_accuracy_phrase` always gives a reason and a fix, e.g. “lower confidence — only 8 periods of history to check against; add more history or forecast a longer period”. A random-walk series says “no better than assuming the latest value holds — plan with the range” | done |
| F-CHAT-05 | Model picker (“Best available”) always visible under composer | nontech | `ModelSelector.tsx`, `ChatPanelMain` footer | Hide behind Advanced for default role; persist last choice for power users | ✅ Also applies to the Query Editor header (D-QE-06). The engine now fails over to a backup model on its own (Gemini, hedged), so most users never need the picker — **24 Sep (later):** Model picker hidden by default; “Advanced → Choose model” in the mode menu turns it on and is remembered (`aicser.composer.showModelPicker`) | done |
| F-NAV-01 | Nav label “AI Engine” vs job “Ask” | nontech, VP | `navConfig.ts`, `messages/*/nav.ai_engine` | i18n default job-oriented (“Ask” / “Ask Aicser”); keep technical alias in tooltip if needed | ⏸ Confirmed (`nav.ai_engine = "AI Engine"`). A one-line i18n change, but it's a brand/navigation decision; product to sign off on “Ask” — **24 Sep (later):** Nav is now **Ask** (sidebar, mobile tab, PWA shortcut), all 10 locales | done |

## P1 — Progressive disclosure & orientation

| ID | Finding | Persona hit | Where to change | Acceptance | Verdict | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-SRC-01 | Sources panel shows SQL types (`BIGINT`) by default | nontech | `EnhancedDataPanel.tsx`, `SchemaExplorerTree.tsx` | Default: “Using &lt;source&gt; · &lt;tables used&gt;”; types only when Expanded/Advanced or `data_engineer` preference | ✅ Same for the Query Editor tree (D-QE-04) — **24 Sep (later):** SQL types hidden in the Ask Sources tree (hover still shows them); only the schema level opens by default, so users scan table names first | done |
| F-CHAT-06 | Datasource pill looks like “industry/domain” (`retail`) | all | `ChatPanelMain` datasource pill + copy | Label “Data: …” or “Source: …”; never bare slug without prefix | ✅ Copy only, low risk — **24 Sep (later):** Composer pill reads “Data: <source>” and sits first in the footer | done |
| F-CHAT-07 | Mode + model + source triad always equal weight | nontech | `InlineModeSelector.tsx`, footer layout | Source confirmation primary; mode secondary; model tertiary/Advanced | ✅ — **24 Sep (later):** Order is now source → mode → (model only when turned on) | done |
| F-NAV-02 | “Dashboard Studio” / “Query Editor” peer to Ask | VP, nontech | `navConfig.ts`, role-based nav | Role or “simple shell”: Query Editor not top-level for low-literacy; Studio → “Dashboards” | ✅ Build together with F-SET-01 (role sections), not as a separate nav fork — **24 Sep (later):** Query Editor renamed **SQL editor** and moved under **My data**; Dashboard Studio → **Dashboards** | done |
| F-NAV-03 | “Data & Model” opaque | nontech | `nav.cat_data` i18n | Prefer “My data” / “Data”; “Model” only inside semantic/advanced | ⏸ Confirmed (`nav.cat_data = "Data & Model"`); same sign-off as F-NAV-01 — **24 Sep (later):** “Data & Model” → **My data** | done |
| F-CHAT-08 | Prompt Library only in header — empty state underuses starters | nontech | `PromptLibraryModal`, empty chat state | ≥3 starter prompts in empty state; Library remains for browse | ✏️ The empty state already shows starters (S-ASK-02 “good”). Their wording was the problem: the server now turns identifiers into words at `/api/ai/chat/discover` (“order total by store region”, not `order_total`). Still to do: a “Browse prompt library” link in the empty state — **24 Sep (later):** Empty chat leads with starter questions (instant, refined in the background); modes moved into a collapsed “More ways to answer” row; “Browse more example questions” opens the Prompt Library | done |
| F-CHAT-09 | Suggested chips compete with chart (long truncated text) | all | `GuidedModePanel` / `DiscoveryChips` | One primary CTA + “More ideas”; no truncated “executive p…” | ✅ Chips are now written from the answer and use display names, not raw columns, for every mode — **24 Sep (later):** Chips wrap to two lines instead of cutting off mid-word (CSS said “allow wrap” but forced `nowrap`); text is written in plain words server-side | done |

## P2 — Cross-page excellence

| ID | Finding | Persona hit | Where to change | Acceptance | Verdict | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-SHELL-01 | Same dense chrome for IT admin path to Settings | it_admin | `Navigation.tsx`, settings entry | Settings always one click from shell; not buried after AI chrome | ✅ — **24 Sep (later):** Settings is one click from the sidebar footer; inside, pages are grouped Me · Workspace · AI · Admin · Developer (F-SET-01) | done |
| F-I18N-01 | Hardcoded English mode labels (`FRONTEND_MODE_LABELS`) | km/th/vi users | mode constants + `next-intl` | All composer/mode strings via messages | ✅ Confirmed: `chat/constants.ts:272`, duplicated in `EmbedAssistantModal.tsx:53`. Fix both together — **24 Sep (later):** One translated helper (`translatedModeLabel`) now feeds the mode menu, the resolved-mode badge (its English tooltips too) and the embed assistant form | done |
| F-DASH-01 | Studio naming vs “view my dashboards” | sales_vp | dashboard routes + nav | First click reaches list of dashboards without “designer” framing | ✅ — **24 Sep (later):** Nav label is **Dashboards** | done |
| F-CHAT-10 | After Auto already produced a forecast, UI still prompts “Try Forecast?” | all | mode suggestion / ChatPanelMain | Do not ask to switch to Forecast if the completed answer is already a forecast; or auto-select Forecast silently | ✅ Fixed on both sides: the server no longer emits the mode hint for Auto, or for the mode already in use; the client ignores hints on Auto | done |
| F-CHAT-11 | Forecast chart subtitle exposes blend method + “95% CI” jargon | nontech | forecast chart header | Plain subtitle first (“Next 8 weeks · about 89% reliable”); methods under Advanced | ✅ The subtitle is now horizon + reliability only; method and band levels moved to `aiserForecastDetails` (see F-CHAT-03). Diagnose subtitles also dropped `z=` / `|z|` for plain words | done |
| F-CHAT-13 | Copy “Reliability is reliable (~89%…)” | finance, nontech | forecast narrative / evidence insights | Use one adjective: “About 89% reliable on 8-week totals” | ✅ The phrase is now “about 89% reliable on 8-week totals”; the prompt says to use it as “the forecast is …” and its worked example was corrected | done |
| F-FEED-01 | Shared cards use raw AI/SQL titles | all | Feed cards | Require readable title on share; sanitize snake_case | ✅ Answer text now goes through a plain-names pass (`utils/plain_names.py`); apply the same at share time for older cards — **24 Sep (later):** Root cause was privacy-scrubber placeholders (“<DATE_TIME> Performance”) saved as titles. The scrubber leak stopped at source (no new cases since 31 Aug); Dashboard, Chart and Feed post titles now also reject placeholders on save; the one old card was repaired | done |
| F-DATA-01 | “1 ungoverned grant” on default sources table | nontech | data sources list | Plain status; governance detail in Advanced / admin | ✅ — **24 Sep (later):** Badge now reads “1 share sees all rows” (admins only, as before), tooltip says how to limit it | done |
| F-QE-01 | Query Editor stuck on full-screen Loading | all | query-editor page | Fix hang; timeout + Back within 8s | ✅ Not reproduced today (it loads in about 10–15 s), but a timeout + Back is right regardless — **24 Sep (later):** Shared loader gained an opt-in “This is taking longer than usual” with Reload / Go back after 8 s; on for the SQL editor | done |
| F-QE-02 | NL→SQL Run: Binder Error `orders` not found while Sources lists orders | analyst | query-editor NL2SQL + execute path | Align catalog with selected source; see D-QE-02 in report 08 | ✅ **Root cause wasn't the catalog** (see 08 §C). Fixed: only *certified* metrics may bypass the model; the compiler uses the metric's own table. “Show weekly order totals” now runs (52 weeks) | done |
| F-DASH-03 | Story layout widgets stay unbound; only first KPI gets data | nontech | dashboard studio bind | “Apply data to all empty widgets”; empty-state CTA on cards | ✅ (renumbered from a duplicate F-DASH-01) — **24 Sep (later):** Properties shows “N other widgets have no data yet. [Use this data]” once a widget has a table; each empty widget gets fields suited to its type (KPIs spread across different measures, trend on a date, bars on a category) and placeholder titles are replaced (`utils/bindEmptyWidgets.ts`, tested) | done |
| F-DASH-02 | Edit/View toggle confusing; Properties off-screen on narrow width | nontech | dashboard page / PropertiesPanel | Clear mode label; responsive Properties | ✅ — **24 Sep (later):** Toggle reads **Edit** / **Done editing**; under 992 px Properties stacks below the canvas (it kept a 320 px min-width in a row and fell off-screen) | done |
| F-CHART-01 | Chart Designer stays “0 charts / Select a chart” after configuring Line | all | chart-designer | Persist to library + show preview | ✅ Blocker for the “build then reuse” story — **24 Sep (later):** Root cause: the chart *was* saved, but the library list only loaded on mount. It now reloads when a new chart appears on the canvas | done |
| F-SET-01 | Settings shows 20+ peer items to everyone | nontech, it_admin | settings nav | Role-grouped sections | ✅ Sections: Me · Workspace · Admin (Identity/SCIM, Residency, Decision Layer) · Developer. Settings grew this round, which makes this more urgent — **24 Sep (later):** Done as proposed plus an **AI** group; labels and descriptions translated in all 10 locales, jargon removed (“Permissions and RBAC” → “Who can do what”) | done |
| F-KNOW-01 | Library named “KBb”; “Open AI Search” | nontech | knowledge page | Friendly default names; “Search in Ask” | ✏️ “KBb” is a name a user typed (`data`). The “Open AI Search” copy is still worth changing — **24 Sep (later):** Copy now says “Search docs” everywhere (it was “AI Search” in 9 places); permission codes removed from the access-denied text | done |

## Engine coordination (not FE-only)

| ID | Issue | Backend pointer | FE expectation | Status |
| --- | --- | --- | --- | --- |
| F-BE-01 | Narrative timeout → 0 insights still looking OK | `insight_synthesizer_node`, `evidence_insights.py`, `response_finalizer_node` | Always render evidence/fallback cards; show “partial answer” | **done (engine).** Slow starts race a backup model (Gemini, 10 s); the fallback summary leads with the engine's result (forecast/drivers), never “X totals Y”; a fallback answer is marked `degraded_pass` and never cached; a *Review* item appears in the considerations panel |
| F-BE-02 | Wrong metric sum (IDs) | `column_guard.py`, mode SQL builders | Surface “we switched aggregation” note in UI when guard fires | **done (engine).** The panel shows “Changed how customer id is measured: counting distinct instead of adding up — it identifies records…” with a one-click “Add up … anyway” |

## New since this backlog — engine features the UI now carries (QA please cover)

| Area | What the user sees | Where | Suggested journey |
| --- | --- | --- | --- |
| Considerations | “What this answer took into account (n)”: Assumed / Caveat / Skipped / Changed / Would help / Review, each with a one-click Refine or Answer | `ConsiderationsPanel.tsx`; `execution_metadata.considerations` | `answer_considerations.yaml`: forecast shows horizon + data range; Search docs with no documents shows “Changed: ran Analyze instead of AI Search” |
| Waiting | “usually about N s” next to the timer; “Taking longer than usual…” only past this mode's slow mark (learned per org) | `ThoughtProcessDisplay.tsx`; SSE `timing_hint` | `wait_expectation.yaml`: second Decide run shows a typical duration |
| Decide — per case | Case file card: the record, peer ranking bars, flags with base rates, linked records; review verdict; options with effort/timeline; risks, KPIs; **“What did you decide?”** record buttons | `DecisionBriefCard.tsx`, `CaseFilePanel.tsx`; `POST /conversations/{id}/messages/{mid}/decision` | `decide_case.yaml`: “Should we restructure the loan with the largest outstanding principal?” → case file for one loan + a recorded decision |
| AI Search, no documents | Says so up front, answers from data, suggests connecting the policy document | supervisor + considerations | `ai_search_no_kb.yaml` |

## New — Chart/Dashboard properties by type (24 Sep 2026)

Full write-up: [11-PROPERTIES-CHART-DASHBOARD.md](11-PROPERTIES-CHART-DASHBOARD.md). Built a live board (KPIs + Pie + Trend + Bar).

| ID | Finding | Persona hit | Where to change | Acceptance | Verdict | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-PROP-01 | Title stays “KPI”/“Line” after type switch to Pie/Bar | all | PropertiesPanel / widget title sync | Rename or prompt on type change | ✅ | open |
| F-PROP-02 | Format shows Line overlays (Trend/Average/anomaly) on Bar | nontech | Format pane gated by `chartType` | Only type-relevant Format cards | ✅ | open |
| F-PROP-03 | Header icon library always expanded (~80 icons) | nontech | Format Header icon section | Collapsed until opened | ✅ | open |
| F-PROP-04 | Table select can stay “Select table” while fields already bound | analyst | Data source/table sync in Build | Select shows actual table | ✅ | open |
| F-PROP-05 | Disabled chart types have no “why” | all | Chart type switcher tooltips | One-line reason | ✅ | open |

## New — AI Decisions / Knowledge / Data manage (user E2E, 24 Sep 2026)

Full write-up: [10-USER-TEST-AI-DECISIONS-KNOWLEDGE-DATA.md](10-USER-TEST-AI-DECISIONS-KNOWLEDGE-DATA.md).

| ID | Finding | Persona hit | Where to change | Acceptance | Verdict | Status |
| --- | --- | --- | --- | --- | --- | --- |
| F-AIDEC-01 | Save decision → 402 plan gate; toast only `error`; New decision still offered | all | `ee/.../ai-decisions/page.tsx`, `utils/api.ts` plan-gate helpers | Gate on empty state or open Upgrade modal; never bare `error` after a filled form | ✅ — **fixed 24 Sep:** Root cause was platform-wide: the server's error normaliser dropped structured fields (upgrade_required, required_plan) whenever a message was present, and the client read the `error` code ("error") before the human `message`. Both fixed, so every plan gate now opens the upgrade prompt. AI Decisions also checks the plan up front: locked orgs see an explanation and "See plans" instead of a form | done |
| F-AIDEC-02 | Threshold / unmask lack plain “what this does” | nontech | ai-decisions form + `messages/*/ai_decisions` | One helper line under each control | ✅ — **fixed 24 Sep:** Threshold shown as a percentage with what happens below it; unmask help says when to turn it on | done |
| F-KNOW-02 | Test search hangs on Searching…; API/BFF errors silent | all | `KnowledgeSearchPanel.tsx`, knowledge BFF route | Alert + Retry; never infinite spin | ✅ — **fixed 24 Sep:** Root cause: the local embedding model loaded inside the first search after each deploy (~65 s importing + ~28 s loading + a 400 MB download, since the cache wasn't persisted). Now warmed at startup, loaded from cache first, cached in a volume (`hf_model_cache`), and the endpoint answers "starting up" after 30 s. Panel shows the error with Retry and no longer says "No results" before searching | done |
| F-KNOW-03 | Sync from apps: disabled Sync now with no next step | it_admin | knowledge Sync tab | CTA to connect SharePoint / Settings | ✅ — **fixed 24 Sep:** Nothing connected → one plain message (admin connects once for the workspace; upload meanwhile) instead of disabled controls. Connector settings documented in `.env.ee.example` (they were missing). A per-org credential UI is a separate feature | done |
| F-DATA-02 | Overview label “Policy name” for source name | all | `DataSourceOverviewTab.tsx` (wrong `data_source_rls_policy_name` key) | Label is source name | ✅ — **fixed 24 Sep:** Label is Name | done |
| F-DATA-03 | Overview Status UNKNOWN, em-dash rows/size, raw ISO, `SAMPLE_DUCKDB` | nontech | Overview tab + connection status mapping | Active/friendly type; relative Updated | ✅ — **fixed 24 Sep:** Friendly type (Sample data / PostgreSQL / File…), status Ready / Connected / Can't connect / Not checked yet, table and row counts from the schema, relative Updated with exact time on hover | done |
| F-DATA-04 | `/data` full-page Loading with no escape | all | `data/page.tsx` + shared loader | 8s tip + Reload/Back (same as F-QE-01) | ✅ — **fixed 24 Sep:** The dashboard route loader and /data's permission loader offer Reload / Go back after 8 s (all pages) | done |
| F-DATA-05 | Schema type shows concatenated `NumberBIGINT` | nontech | Schema tab type cell | Friendly type; SQL on hover | ✅ — **fixed 24 Sep:** Friendly kind tag; SQL type on hover; "NOT NULL" → Required | done |
| F-DATA-06 | Bypass banner still grant/RLS jargon | nontech | `BypassBanner` / Overview | Plain copy aligned with F-DATA-01 | ✅ — **fixed 24 Sep:** "N shares see every row of this source. Add a row rule in Permissions to limit what each group sees." | done |

## Suggested FE sprint slice (first)

1. F-NAV-01 + F-NAV-03 + F-CHAT-06 (copy only, after the naming sign-off)  
2. F-CHAT-05 + F-CHAT-07 (disclosure)  
3. F-CHAT-01 (answer first; use the considerations panel as the “partial answer” surface)  
4. F-SRC-01 / D-QE-04 (Sources summary)  
5. F-CHART-01 + F-DASH-03 (the two remaining depth blockers)

## Verification

After a fix, run (dry or live):

```bash
cd qa/ui-browser && uv run aicser-qa run --journey <related> [--dry-run]
```

Engine-side regressions are gated separately: `cd deploy && make eval` (51-question execution accuracy + all 15 modes, with answer shape, text hygiene and time budgets).

Attach `reports/runs/*.md` to the PR when live QA was used.
