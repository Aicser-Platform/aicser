# 11 — Properties per chart/widget type + build a dashboard

**Date:** 24 Sep 2026 · **SUT:** `http://localhost:3001` · Demo · project **kj** · source **retail**  
**Method:** Live end-user pass on `/chart-designer` and `/dashboards` — focus on **Build / Format / Filters / Sort** properties by chart type, then actually assemble a working board.  
**Related:** [08-DEPTH-DASHBOARD-CHART-QE.md](08-DEPTH-DASHBOARD-CHART-QE.md) (earlier bind depth); this report answers “are type-specific properties working and intuitive?”

---

## Verdict

| Question | Answer |
| --- | --- |
| Do Build shelves change by type? | **Yes** — KPI → Metric*; Line/Bar → Category* + Numbers* + Date grouping; Pie → **Slice by** + Numbers* |
| Does Format adapt by type? | **Partially** — KPI gets trend badge / goal / sparkline; Bar gets Orientation / Stacking / Value on bar; but **line overlays (Trend line…) stay visible on Bar** |
| Can a non-expert build a real dashboard? | **Yes, after learning Properties** — “Use this data” + Add → Bar → bind retail worked; board ended with 3 KPIs + Pie + Trend + Bar all painting |
| Intuitive for low literacy? | **Mixed** — empty-state copy is excellent; Format pane is **Power BI–dense** (icon library floods the scroll) |

---

## A. Chart Designer (`/chart-designer`)

### What worked
- Library shows **1 charts** with live Line canvas (prior D-CHART-01 “0 charts” no longer reproduced).
- Properties: **Build · Format · Filters · Sort** — same mental model as Dashboard Studio.
- Line **Build**: Category `order_date`, Date grouping **Month**, Numbers **Sum of order_total** — clear and working.
- **Format (Line):** Chart style / Stacking / Line style, Value format, Overlays (Trend / Average / anomalies), Legend, axes, templates — Feature-complete vs Tableau Marks / Power BI format.
- Toggling **Trend line** checked successfully.
- Unsafe type switches (Heatmap, Funnel, Gauge…) correctly **disabled** when data shape doesn’t allow.

### Friction
| ID | Finding | Severity |
| --- | --- | --- |
| **F-PROP-01** | After switching Line → Bar, **title stays “Line”**; canvas/type may update without renaming | Major (trust) |
| **F-PROP-02** | Bar Format still shows **Trend line / Average line / Highlight anomalies** (line overlays) alongside **Value on bar** / Orientation | Major (noise + wrong affordances) |
| **F-PROP-03** | Format **Header icon** library dumps ~80 icons (Dollar…Experiment) mid-pane — buries legend/axes | Major for nontech |
| **D-CHART-02** (open) | Chrome still feels “library + editor”; Share present, no obvious **Save as…** | Major |

---

## B. Dashboard Studio — build log (this session)

Board: **My dashboard** (`id=5d8c9e0b-…`).

| Step | Action | Result |
| --- | --- | --- |
| 1 | Open existing story layout | 1 KPI OK (`319.27k`); others “Couldn't load data” (better than old “Data unavailable”) |
| 2 | Select working KPI → Properties | Build shows retail / orders / Metric* Sum of order_total |
| 3 | Click **“4 other widgets have no data yet. Use this data”** | All KPIs + Trend lit — **F-DASH-03 verified working** |
| 4 | KPI → **Format** | Type-specific: Show trend badge, Currency/Unit, Goal, Warning/Critical, sparkline, layout — **good** |
| 5 | Switch same widget **KPI → Pie** | Build shelves become **Slice by** + Numbers*; Format gains Legend / Data label |
| 6 | Set Slice by `store_id` | Pie paints (slices labeled) |
| 7 | **Add → Bar** | Empty: “Not connected to data yet / Pick a data source…” — **excellent** |
| 8 | Bind retail (+ inventory fields auto) | Bar **Stock Quantity** by store renders |
| 9 | Format → **Value on bar** | Checkbox toggles (checked) |
| 10 | **Done editing** | Mode label clear |

**End state:** 3× order-total KPIs · Pie (still titled “KPI”) · Trend line · Bar stock by store — a usable retail snapshot.

---

## C. Properties by type (user matrix)

| Type | Build shelves (observed) | Format highlights | Working? | Intuitive? |
| --- | --- | --- | --- | --- |
| **KPI** | Metric* only | Trend badge, goal, thresholds, sparkline | Yes | **Best** — short Build; Format still long but relevant |
| **Line / Trend** | Category*, Date grouping, Numbers*, Split by | Line style, overlays, axes | Yes | Good Build; Format heavy |
| **Bar** | Category*, Numbers*, Split by | Orientation, Stacking, Value on bar | Yes (after bind) | Good once bound; overlays leak from Line |
| **Pie** | **Slice by**, Numbers* | Legend / labels | Yes after Slice by | Shelf rename helps; **title didn’t follow type** |
| **Heatmap / Funnel / Gauge / …** | Disabled in switcher | — | N/A | Correct safety; no explanation why disabled |

Config source of truth: `client/src/app/(dashboard)/dashboards/Properties/PropertiesPanelConfig.ts` (`CHART_TYPE_CONFIGS`).

---

## D. Industry comparison (user lens)

| Practice | Power BI / Tableau | Aicser today |
| --- | --- | --- |
| Field wells rename by viz | “Axis / Legend / Values” | Strong on Pie “Slice by”; Line/Bar “Category / Numbers” OK |
| Format pane only shows relevant cards | Cards filtered by visual | **Leak:** trend overlays on Bar; giant icon picker always expanded |
| Rename on type change | Often prompts | Title stuck on old type (KPI after → Pie; Line after → Bar) |
| Apply binding to siblings | Limited | **“Use this data”** is a real differentiator — keep |
| Empty widget | Clear “connect data” | Matches industry; better than many BI tools |

---

## E. New backlog IDs

| ID | Severity | Finding | Acceptance |
| --- | --- | --- | --- |
| **F-PROP-01** | P1 | Widget/chart title does not update when chart type changes | Auto-rename or prompt; never leave “KPI” on a pie |
| **F-PROP-02** | P1 | Format overlays/controls not filtered by chart type | Bar hides Trend/Average/anomaly line; Line hides Value on bar |
| **F-PROP-03** | P1 | Header icon library expanded by default in Format | Collapse under “Header icon”; search-only until opened |
| **F-PROP-04** | P2 | Table dropdown can stay “Select table” while fields already loaded (inventory) | Keep table select in sync with bound schema |
| **F-PROP-05** | P2 | Disabled chart types (Heatmap…) have no tooltip why | One-line “Needs X/Y matrix fields” etc. |

---

## Rubric (this pass)

| Dimension | Chart Designer | Dashboard properties | Build-a-board E2E |
| --- | --- | --- | --- |
| Type-aware Build | 4 | 4 | — |
| Type-aware Format | 2 | 3 (KPI strong; Bar leak) | — |
| Task completion | 3 | 4 | **4** (full board lit) |
| Literacy / density | 2 | 2 | 3 (Use this data saves the day) |

---

## Suggested FE slice

1. **F-PROP-02** — filter Format sections by `chartType` (biggest intuition win).  
2. **F-PROP-01** — sync title on type switch.  
3. **F-PROP-03** — collapse icon library.  
4. Keep **Use this data** prominent; consider auto-offer once first widget binds.

---

## Engine response (24 Sep, later) — fixed at the root, verified in a headless browser

| ID | Root cause | Fix |
| --- | --- | --- |
| F-PROP-01 | Titles were plain strings; nothing knew whether the user typed one or the product did | Automatic titles (`utils/widgetAutoTitle.ts`): a placeholder ("KPI", "Line", story-slot labels) or a title we wrote (`chartOptions.__autoTitle`) follows the data ("Total order total by store") and the chart type; a typed title is never touched. "Use this data" titles are automatic too. Translated in 10 locales |
| F-PROP-02 | Overlays were offered for every Cartesian type | Average and reference lines stay (valid on any bar). Trend line and anomaly highlighting only on an ordered axis (dates, a date grain, or scatter): across stores or products the order is arbitrary and the line would mislead. Still shown if already on, so it can be turned off |
| F-PROP-03 | Icon library always expanded | Folded behind "Choose icon / Change"; the preview row (icon, colour, clear) stays |
| F-PROP-04 | The Build fields fell back to a default table while the picker showed the unset value; names were matched exactly ("inventory" ≠ "retail.inventory") | One resolver (`columnSourceTable`) feeds both the fields and the picker, matching by bare name; the table is written to the query on the first field change |
| F-PROP-05 | The reason existed, but a disabled `<button>` gets no mouse events so the tooltip never showed; and it was generic English | Wrapper receives the hover; per-type plain reasons ("Heatmap needs a row category, a column category and a number…"), 10 locales |

### Reported separately: colour changes leaking into the feed and other dashboards

**Root cause (two parts):**
1. Every chart renderer read the palette of *whichever dashboard was open in the studio* (`activeDashboardId` in the global store), not the dashboard the chart belongs to. Opening dashboard B then visiting the feed painted every feed post, shared view and chart post in B's palette, with no publish involved. Reproduced before the fix: a chart from another dashboard drawn in the colour-blind palette's first colour (`#E69F00`) after opening "New dash".
2. Changing a dashboard's palette rewrote every following chart row and baked the colours into saved ECharts snapshots.

**Fix:** a `DashboardPaletteProvider` per surface. The studio uses the open dashboard; shared/embed and live feed viewers use the viewed dashboard's own config; snapshot posts use the palette captured at publish; a live chart post uses its own dashboard's palette. No provider means the chart's own palette. A palette change now saves only the dashboard's config. It touches a chart row only when that chart pinned the old default or carried a single-colour override, and it never writes snapshot colours. A palette chosen on the chart or dashboard now beats colours frozen in a snapshot.

**Verified:** after the fix, zero colour-blind pixels in the feed after opening "New dash", while the studio still paints that dashboard's charts in its palette (4,045 matching pixels).

### Also fixed from this pass

- **Table Total row summed averages** (Avg Interest Rate 0.109 + 0.107 = "0.216"). Averages, minimums, maximums and distinct counts now show "-". The Total is now a pinned summary footer instead of a data row: no longer counted in "Showing 1-3 of 3" or scrolled out of view.
- **true/false categories** on axes and tables read Yes / No (translated).
- **Data source picker showed a raw UUID** when the chart's source lives in another project; it now reads "BB (another project)" (or "Source you can't access").
- **Fields list** put `loan_id`, `branch_id`, `status_id` under Numbers; identifiers now have their own IDs group. Group names and type tags are translated.

### Still open (next slice)

- Many AI-built dashboards share one name (9× "Principal Amount Overview", 5× "Total Principal Amount" from repeated builds). Recommend: the build names a new dashboard distinctly (or offers "update the existing one"), and the list shows the date / widget count next to identical names.
- A date filter saved as a fixed range ("Custom 2026-08-12 → 2026-09-10") on 2024 data leaves widgets empty. Recommend relative ranges by default and an empty-state hint "No rows in the selected dates".
- Filters and Properties open together leave ~50% of a 1400 px screen for the canvas; opening Properties could collapse Filters.
