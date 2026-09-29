# 08 — Depth pass: Dashboard · Chart Designer · Query Editor

**Date:** 24 Sep 2026  
**SUT:** `http://localhost:3001` · Demo · project **kj** · source **retail**  
**Method:** Live multi-step actions (not route-only). Viewport forced to 1440×900 for Studio.  
**Audience:** FE / product — action-level pass/fail for real experience.

---

## Executive verdict

| Surface | Job attempted | Outcome | Experience grade |
| --- | --- | --- | --- |
| **Dashboard Studio** | Create board → story layout → bind KPI (+ Trend) | **Partial pass** — board created; 1 KPI lit (`319.27k`); others still “Data unavailable” | Powerful once in Edit + Properties; **discoverability of binding is poor** |
| **Chart Designer** | Create Line → bind retail/orders/date+metric | **Weak pass** — properties bind; library still **“0 charts / No charts yet / Select a chart”**; no clear live preview of success | Feels unfinished / split-brain |
| **Query Editor** | Load → NL “Show weekly order totals” → Generate → Run | **Fail at Run** — SQL generated OK; **Binder Error: table `orders` not found** (candidate: `inventory`) | Load OK after wait; Sources show `orders` but run context wrong |

Depth vs prior tour: this is **L3–L4** on these three tools (act → outcome), not L0 page opens.

---

## A. Dashboard Studio — action log

| # | Action | Result | UX note |
| --- | --- | --- | --- |
| 1 | Open `/dashboards` | Empty CTA + templates | Strong empty state |
| 2 | **Create Dashboard** | Created `My dashboard` (`id=5d8c9e0b-…`) | Toast “Dashboard created” |
| 3 | Pick **Headline KPIs + trend** | 4 KPI + 1 Trend placeholders | Toast: “connect data in Properties” |
| 4 | Stay in **View** by default | Widgets show **No data / Data unavailable** | Easy to miss that Edit is required |
| 5 | Enter **Edit** (button becomes View) | Add / Undo appear | Mode toggle naming is confusing (Edit ↔ View) |
| 6 | Click KPI → **Properties** (right, 320px) | Data source / table / metric | Panel easy to miss on narrow viewports (hidden off-canvas at ~690px) |
| 7 | Select **retail** → table **orders** | Metric auto **Sum of order_total** | Nice auto-bind |
| 8 | KPI renders **319.27k** | Success | Only **one** of five widgets |
| 9 | Bind Trend → retail/orders | Category `order_date`, Sum `order_total`; went to “Loading…” | Left before confirm chart paint — treat as **in progress** |
| 10 | Remaining 3 KPIs | Still **Data unavailable** | Story layout does **not** cascade data binding |

### Dashboard experience findings (new IDs)

| ID | Finding | Severity | Verdict / status (24 Sep) |
| --- | --- | --- | --- |
| D-DASH-01 | After Create, user lands with empty widgets + “connect in Properties” with no guided next click | Major | **improved** — the empty widget now says what to do (“Pick a data source and fields…”) and one click fills the rest (D-DASH-04). Better still: an AI-built dashboard (“Build a dashboard of…”) now arrives bound. It takes 20–25 s (was 40–50 s) with a real AI plan instead of the heuristic fallback, so offer “Describe the dashboard you want” next to templates |
| D-DASH-02 | Edit vs View toggle: primary control labelled **View** while editing — nontech confusion | Major | **done** — toggle reads Edit / Done editing (F-DASH-02) |
| D-DASH-03 | Properties panel invisible / off-screen on ~690px mobile Studio chrome | Blocker for mobile | **done** — root cause: the panel kept `min-width: 320px` in a row layout; under 992 px it now stacks below the canvas |
| D-DASH-04 | Story layout leaves 4/5 widgets unbound; no “Apply data to all blocks” | Major | **done** — “N other widgets have no data yet. [Use this data]” in Properties binds every empty widget with type-appropriate fields (F-DASH-03) |
| D-DASH-05 | Error copy “Data unavailable… Try refreshing” when widget simply has no bind — wrong diagnosis | Major | **done** — widget errors now say *not connected yet* (no Retry), *no access* (no Retry), *couldn't load*, *taking too long*, or *field / query needs review*, in 10 languages. Was: Confirmed one generic string (`data_unavailable`) serves all three cases; split into *not connected yet* / *couldn't load* / *no access* |

---

## B. Chart Designer — action log

| # | Action | Result | UX note |
| --- | --- | --- | --- |
| 1 | Open `/chart-designer` | Long **Loading…** then empty library | Same slow shell as before |
| 2 | Click **Line** (popular blocks) | Properties populate for a Line widget | Left list still “0 charts” |
| 3 | Bind retail → orders → order_date + order_total | Fields set in Properties | Auto category/metric like Dashboard |
| 4 | Look for canvas / library entry | Still **“Select a chart” / “No charts yet” / 0 charts** | **No confirmation the chart exists** |
| 5 | Refresh in properties | Inconclusive | Save-to-library affordance unclear |

### Chart Designer findings

| ID | Finding | Severity | Verdict / status (24 Sep) |
| --- | --- | --- | --- |
| D-CHART-01 | Creating a chart type does not add a named item to the library list (stays 0) | Blocker for “build then reuse” story | **done** — the chart was saved; the library list only loaded on mount. It now reloads when a new chart appears on the canvas |
| D-CHART-02 | Main pane message fights Properties (“Select a chart” while editing Line) | Major | ✅ open |
| D-CHART-03 | No obvious Save / name chart before Share | Major | ✅ open |
| D-CHART-04 | Slow first load; empty state competes with build chrome | Minor–Major | ✅ open (shared skeleton, S-REL-02) |

---

## C. Query Editor — action log

| # | Action | Result | UX note |
| --- | --- | --- | --- |
| 1 | Open `/query-editor` | Earlier: indefinite Loading; today: **loads** after ~10–15s with Monaco | Unreliable first paint |
| 2 | See Sources tree | `retail` / tables; columns with **(BIGINT)** | Specialist by default |
| 3 | NL box: “Show weekly order totals” | Submit → Stop → **Generated SQL successfully! Ready to run.** | Good NL path |
| 4 | Click **Run SQL** | **Query Error** — `Referenced table "orders" not found! Candidate tables: "inventory"` | Schema/source context mismatch |
| 5 | Sources UI still lists **orders (120)** under retail | Contradicts binder | Trust-breaking |

### Query Editor findings

| ID | Finding | Severity | Verdict / status (24 Sep) |
| --- | --- | --- | --- |
| D-QE-01 | Cold load can hang or take >10s with only “Loading editor…” | Major (was Blocker earlier) | **done** — after 8 s the loader offers Reload / Go back |
| D-QE-02 | NL→SQL succeeds but Run uses wrong table catalog (inventory-only) | **Blocker** | **done**: engine bug, see root cause below |
| D-QE-03 | Sources panel shows tables that Run cannot see — dual source of truth | Blocker | **done**: same root cause; the catalog was right, the generated SQL was wrong |
| D-QE-04 | BIGINT types in default Sources tree | Major for nontech | **done for Ask** (types hidden, hover keeps them). Kept in the SQL editor on purpose: it now sits under My data as the analyst surface |
| D-QE-05 | After generate, must manually Run — OK for power users; nontech expect one-click | Minor | ✏️ Keep Generate → Run for SQL users. For nontech the answer is Ask, not a one-click Run in the editor |
| D-QE-06 | “Best available” model picker in QE header | Same composer jargon leak | **done** — hidden unless the user turned the model picker on in Ask (same remembered setting) or already picked a model |

### D-QE-02/03 root cause (engine, fixed 24 Sep)

Reproduced exactly: “Show weekly order totals” on `retail` generated
`SELECT SUM(orders.order_total) AS metric_value FROM retail_supply_chain.inventory …`.
The catalog wasn't the problem; the generated SQL was:

1. **The semantic-layer shortcut fired on an *auto-inferred* metric.** `order_total` (category `inferred`, not certified) matched the question's words, so the model was skipped and the SQL compiled from the metric definition alone, dropping “weekly”.
2. **The compiler used the first table** (`inventory`) instead of the metric's table, whatever the metric's expression said. `COUNT(*)` row-count metrics were worse: `total_orders` would have silently counted inventory rows.

Fix (`nl2sql_node.py`, `ee/modules/semantic/compiler.py`):
- **Shortcut:** only *certified* metrics may bypass the model.
- **Table choice:** the compiler uses the metric's declared table, then the table its expression references. It refuses rather than guesses when a multi-table source leaves it ambiguous; single-file sources are unchanged.
- **Verification:** the same question now produces `SELECT DATE_TRUNC('WEEK', order_date) … FROM retail_supply_chain.orders GROUP BY week`, which runs and returns 52 weeks. Execution accuracy stays at 100% on 51 questions across 4 languages. Tests are in `tests/modules/ai/test_semantic_base_table.py`.

---

## Cross-cutting experience (actual user feeling)

1. **Studio is editor-first, not outcome-first** — you build shells, then hunt Properties; nontech expect “pick data → see numbers.”  
2. **Mobile Studio chrome breaks the job** — bottom nav + narrow width hides Properties.  
3. **Success signals are inconsistent** — Dashboard KPI can show `319.27k` while Chart Designer still says zero charts; QE says SQL ready then Binder Error.  
4. **Errors blame refresh** when the real issue is unbound widgets or wrong SQL catalog.  
5. **Query Editor’s friendliest control (NL ask) is undermined** if Run fails against the schema the tree displays.

---

## Suggested FE fixes (ordered by depth pass)

1. **D-QE-02/03** — Align NL2SQL / Run engine schema with selected Sources tree (or disable Run until catalog matches).  
2. **D-DASH-04** — “Apply this data source to all empty widgets” after first bind on a story layout.  
3. **D-DASH-02/03** — Clear Edit mode label; dock Properties or show “Configure data” empty-state CTA on each unbound widget.  
4. **D-CHART-01/02** — Persist Line to library list + show preview pane titled with chart name.  
5. **D-DASH-05** — Differentiate unbound vs fetch failure vs permission error.  
6. **D-QE-01** — Skeleton + timeout for Monaco load.

---

## What we still did *not* finish (honest)

- Confirm Trend chart painted after bind  
- Bind all four KPIs / rename dashboard / Share / View as consumer  
- Save chart to library / pin chart to dashboard  
- Visualize query / Explain SQL after a successful Run  
- Template-based dashboard with banking sample on retail data (likely mismatch)

---

## Artifacts

- Screenshots from session under Cursor temp screenshots (dashboard create, KPI bind, QE error)  
- Related: `07-SCENARIOS-FOR-REFINEMENT.md`, `04-UI-FINDINGS-BACKLOG.md` (merge D-* IDs into backlog in follow-up)

**Bottom line (updated 24 Sep):** The Query Editor blocker is fixed at the engine; Studio binding (D-DASH-03/04) and the Chart Designer library (D-CHART-01) are the remaining depth blockers.

**Original bottom line:** Real action depth shows Studio can produce a live KPI, but **Chart Designer doesn’t acknowledge creation**, and **Query Editor’s NL→Run path is broken on schema context** — more damaging than first-paint jargon.

---

## D. Export, print and chart rendering (24 Sep, verified in a headless browser)

| ID | What users saw | Root cause | Fix |
| --- | --- | --- | --- |
| D-EXP-01 | PDF/print/PNG: widgets below the fold exported as grey shimmer | `LazyWidgetMount` only mounts charts near the viewport; export captured before they existed | Export and `beforeprint` fire a prepare event that mounts every widget; capture waits until no placeholder/loader remains and animations settle (≤12 s) |
| D-EXP-02 | "Dashboard canvas not found" (PNG/print from preview) | Each caller hard-coded one grid selector; `printDashboardOnly` ignored the selector it was given | `resolveDashboardRoot` finds the visible grid (studio, viewer, preview); print passes the selector through |
| D-EXP-03 | Export cropped the left/top of the first row | html2canvas measured the clone inside page padding/centring; the grid shifted inside its own box | The cloned grid is pinned to the clone's top-left; capture uses real window width |
| D-CH-01 | Trend axes "Jan, Apr, Jul, Oct, Sep, Jun" or newest-first | Grouped SQL had no ORDER BY; sort-by-x defaulted to DESC; the planner sorted time axes by value | Time axes (line/area or a date grain) default to x ascending; planner sets monthly grain + ascending for date axes |
| D-CH-02 | "…over Time" charts with hundreds of daily spikes | Planner gave date axes no grain | Monthly grain by default; saved charts repaired (`repair_chart_groupings`, 41 charts) |
| D-CH-03 | "Interest Rate over Time" summed rates | Non-additive guard only applied to KPI cards | Intensive measures (rate, ratio, score, percent…) are averaged in every chart type |
| D-CH-04 | Axis labels `2024-01-01T00:00:00`, rate axis "0.1, 0.1, 0.1" | Category axis printed raw values; value axis fixed at 1 decimal | Dates formatted by their real grain ("Jan 2024"); decimals follow magnitude |
| D-CH-05 | True/false column blank in tables | React renders nothing for booleans | Yes/No (translated), "—" for empty, dates formatted |
| D-CH-06 | Legend "total_principal_amount" | Series named after SQL aliases | Snake_case series names humanised; number formats still matched by raw field |
