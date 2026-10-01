# 12 — Dashboard builder and chart library vs Datawrapper, Canva, Flourish, Looker Studio

**Date:** 25 Sep 2026 · **Method:** live headless-browser walkthrough of `/dashboards` (every Properties tab for KPI, pie, line and bar widgets) and `/chart-designer`, as a first-time employee. Each widget type was compared with how the reference tools handle the same job.
**Audience:** product and FE. Items marked **Done** are in the working tree and were verified in the browser; the rest are recommendations, in priority order.

---

## 1. What the reference tools get right

| Tool | The one idea worth copying |
| --- | --- |
| **Datawrapper** | A linear path (data → chart type → refine → annotate → publish). *Refine* shows only the few options that matter for the chosen chart, with smart defaults; annotations (title, description, source, notes) are first-class; charts shrink gracefully on small screens. |
| **Canva** | Select anything and its controls appear immediately. Nothing needs an "apply" step. Every change can be undone, so destructive-looking actions rarely need a confirmation. |
| **Flourish** | Template first: pick a visual story and the data sheet sits beside it. |
| **Looker Studio / Power BI** | *Setup* (fields on shelves) vs *Style* tabs, a field list used as a drag source, filters as on-canvas controls. |

The common thread: **intent before plumbing**, **no apply step**, **basics before power features**, **reversible actions instead of warnings**.

---

## 2. Findings from this pass and what was done

| # | What a new user hit | Reference pattern | Status |
| --- | --- | --- | --- |
| 1 | Clicking a card's title strip selected it but did not open Properties; only a click in the body did | Canva: select → controls | **Done:** the header drag handle no longer swallows the click unless the card actually moved |
| 2 | Build asked about data plumbing first (source → Table/Query → saved query → table → fields); chart type was below the fold | Datawrapper / Canva: visual first | **Done:** Title → Chart type → Data → field shelves → field list (drag source) |
| 3 | Table/Query switch and a saved-query picker shown together | Progressive disclosure | **Done:** saved-query picker only in Query mode |
| 4 | A full-width primary "Refresh" under every tab made edits look unsaved | No apply step | **Done:** quiet "Reload data" with a tooltip that changes apply automatically |
| 5 | Placeholder titles ("KPI" on a pie, "Line" on a bar) | Auto titles | **Done:** new data follows automatically; old placeholders get a one-click "Suggested: Total order total by store" |
| 6 | Filters tab mixed "Page filters", "Chart filters", "Select columns here or click", "Keep totals…" | Plain language | **Done:** "Filters on this page", "Only this chart", "Only include rows where…", "Only show groups whose total…", "Add a condition" (10 languages) |
| 7 | Conditional formatting sat at the top of bar/line/pie Format tabs | Datawrapper Refine: basics first | **Done:** folded under an Advanced section (opens itself when rules exist); tables keep it visible |
| 8 | Pie sorted by `store_id` | Largest slice first | **Done** on switching to pie/donut (a user-chosen sort is kept) |
| 9 | Single-series bars painted a rainbow | One series = one colour | **Done:** one colour; "Colour each bar" to opt in |
| 10 | "Clear all" read like it wipes the dashboard | Undo instead of confirm | **Done:** "Reset filters", tooltip says widgets and filters stay, "Filter selections cleared · Undo" for 6 s |
| 11 | "Describe / improve with AI" drawer: slow, clipped header, English-only, duplicated AI Chat | One place for AI | **Done:** removed; the widget menu has "Ask AI about this chart", which opens AI Chat with the question and data source |
| 12 | Empty, not-connected and no-rows states overflowed small cards | Graceful shrink | **Done:** container-query compact state (headline + action only) |
| 13 | Dashboard list: two-line names overlapped the next row; repeat AI builds had identical names | — | **Done:** rows no longer shrink; new AI builds get "Name (2)"; existing look-alikes show the created date |
| 14 | "1 charts" | — | **Done:** plural forms (en, de, es, fr) |

### Correctness bugs found on the way (all fixed)

- **Dashboard date ranges applied only the end date.** Runtime filters on one field replaced each other, so `>= from` was dropped. Every date-range filter showed everything up to the end date. Now both bounds apply (server test added).
- **Every chart with a design lost its formatters.** The option clone fell back to JSON, dropping axis date labels, currency formats and tooltip formatters. The clone now keeps functions.
- **A chart built on compiled SQL ran a meaningless structured query.** The editor's default `aggregate: "count"` counted as a "mapping", producing 120 rows labelled "Total". Structured mode now needs real fields.
- **Tables summed averages in the Total row.** Averages, minimums and maximums now show "-", and the total is a pinned footer.

---

## 3. How chat, Chart Designer and Query Editor feed the dashboard

All three routes create ordinary chart rows, and every surface (studio, viewer, feed, designer) uses the same renderer and Properties panel. Fixes to palettes, formatters, titles, totals and Yes/No labels therefore apply to all of them. The routes differ in what the chart is bound to:

| Origin | Bound to | Dashboard filters | Editable in Build |
| --- | --- | --- | --- |
| Chart Designer / Add block | Table + fields | Yes | Fully |
| Query Editor → Visualize | Saved query | Only on columns the SQL outputs | Mappings over the query's columns |
| AI Chat → Pin | Table + fields when the SQL is simple; otherwise saved query | Yes / only on columns the SQL outputs | Fully / mappings over the query's columns |
| AI dashboard build | Table + fields (compiled SQL for multi-table) | Yes / only on output columns | Fully / partially |

**Fixed for alignment:**
- Chat pins stored the chat's default colours as a "custom" palette and ignored the dashboard theme. They now follow it, including existing pins.
- Saved-query charts silently ignored filters on columns they don't output. The card now says "Not filtered by Disbursement date", with a tooltip saying why and what to do.
- One saved-query path failed the whole widget on such a filter. It now skips just that filter.

**Chat pins now join the table + fields model** where their SQL has an exact equivalent (section 4), so they filter and edit like designer charts. What remains SQL-bound are genuinely complex answers (joins, CTEs, window functions); they say on the card which dashboard filter they can't take.

---

## 4. Next slice — built 25 Sep (verified in the browser)

| Item | What users get | Works for any data because |
| --- | --- | --- |
| Pie "Other" + small cards | Past 6 slices: largest 5 + a grey "Other" (Format → Slices: 6 / 10 / All). Cards under 320×220 px drop the legend; tooltips still name every value. Clicking "Other" never filters. | Driven by slice count and card size, not by field names |
| Description + Source / notes | "Add description or source" under the title; the description shows under the chart title, the source as a byline under the chart, in the studio, viewer, feed and exports | Free text on the chart |
| Quick bar (Canva) | Above the selected card: chart type, colours (Match dashboard + palettes), duplicate, delete | Uses the same type-change rules as Properties (one shared helper) |
| Chat pins → table + fields | A chart pinned from chat whose SQL is a simple single-table query becomes a normal table + fields chart: dashboard filters apply and Build can edit it. The data source is linked if the pin had none. | SQL is parsed (sqlglot, per-source dialect); only exact equivalents convert. 16 generated queries on 6 tables gave identical results both ways. Joins, CTEs, window functions and OR stay as SQL (and say which filters they can't take). |
| Varied KPIs | "Use this data" gives each KPI something different: each measure's total, row count, unique count of each linked ID, then the average, skipping metrics already on the dashboard | Built from the table's own column types and keys |

### Also fixed from user testing (trust)

- **A click in edit mode filtered the whole dashboard.** Clicking a bar to select a chart set a cross-filter (KPIs 23 → 1) and cut the chart itself to one bar. Now in edit mode a click only selects. In view mode, a chart grouped by the clicked field keeps all its bars and highlights the choice while the rest narrows, and a "Filtered by: … ✕" row shows what's applied and undoes it.
