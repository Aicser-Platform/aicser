# Aicser Platform — Comprehensive UX & Feature Audit (2026-05-27)

## Executive Summary

Aicser has a solid foundation: grid-based dashboard canvas, global/page/cross filters, drill-down/through, real-time collaboration, chart export, social feed, and AI chat modes. However, compared to Tableau, Power BI, Looker Studio, and Metabase there are meaningful gaps across every major surface. This document maps every gap and the ordered improvements needed to achieve world-class publication-ready analytics.

---

## 1. `/dashboards` — Canvas & Studio

### 1.1 Widget Catalogue Gaps

| Missing type | Priority | Notes |
|---|---|---|
| **Gauge / Speedometer** | P1 | Essential for KPI targets; Power BI / Tableau standard |
| **Treemap** | P1 | Hierarchical proportional data |
| **Waterfall chart** | P1 | Finance/bridge charts |
| **Bullet chart** | P2 | KPI vs target in compact form |
| **Box plot / Violin** | P2 | Statistical distribution |
| **Histogram** | P2 | Frequency distribution |
| **Choropleth / Geo map** | P1 | Geographic data — high demand |
| **Sankey diagram** | P2 | Flow/funnel analysis |
| **Radial bar / Polar** | P3 | Circular KPI variants |
| **Image widget** | P1 | Logo, brand visual in publication dashboards |
| **Iframe / Embed widget** | P2 | Embed Loom, Figma, third-party |
| **Section divider** | P1 | Group widgets visually; Notion-style |
| **Button / Nav widget** | P2 | Drill-through trigger, URL navigation |
| **Progress bar widget** | P2 | Goal tracking inline |
| **Rich markdown** | P1 | Dynamic text with `{{metric}}` bindings |

### 1.2 Slicer / Filter Widget Gaps (vs Power BI slicers)

Current: single Select dropdown only.  
Needed:
- **Date range slicer** with relative presets (Today, Last 7d, Last 30d, This Quarter, YTD, Custom)
- **Numeric range slider** (min/max)
- **Tile / chip slicer** (horizontal button group — most used in Power BI)
- **Toggle / boolean** slicer
- **Cascading filter dependency** — selecting Region auto-limits City options
- **Slicer search** for large cardinality fields
- **Multi-select with "Select All"** checkbox
- **Slicer sticky header** — persists when scrolling large dashboards

### 1.3 Stat / KPI Widget Gaps

Current: value + trend badge only.  
Needed:
- **Sparkline** (mini line/bar chart in the KPI card)
- **Comparison period** value from a second query (e.g., "vs last month: 12%")
- **Target / goal line** with progress bar fill
- **Conditional formatting** by rule (green/amber/red thresholds with icon overrides)
- **Icon pack** (custom icon per KPI — revenue, users, orders, etc.)
- **Multi-metric card** (2–3 metrics stacked)

### 1.4 Canvas / Layout Gaps

| Gap | Notes |
|---|---|
| `confirm()` for delete | Should be `Modal.confirm` — security/UX issue |
| No multi-widget select | Shift+click or rubber-band select for bulk move/delete/align |
| No alignment guides | Smart guides when dragging (show snap lines) |
| No zoom / pan | Large dashboards (>20 widgets) become unusable |
| No widget grouping | Group widgets as a section (lock group, move together) |
| No widget focus/fullscreen | Expand single widget to full viewport (no page leave) |
| No locked widgets | Lock header KPIs so they can't be accidentally moved |
| Excel export stub | `console.log` only — needs real implementation |
| Only 3 layout presets | Need: 2-col, 3-col, header+body, full-report, ops center |
| No canvas undo/redo | Ctrl+Z for accidental widget deletes |
| No section headers | Titled divider rows grouping chart areas |
| No keyboard shortcuts | Del to delete, Escape to deselect, arrow nudge |
| Empty canvas placeholder | Generic text — should be interactive widget picker |

### 1.5 Properties Panel Gaps

- No **conditional formatting** rules editor (table + stat)
- No **reference lines / bands** on chart (avg line, goal line, date band)
- No **custom tooltip** content override
- No **annotations** (pinned notes on specific data points)
- No **sparkline field** for stat widget
- No **data label format** patterns (YYYY-MM-DD, $#,##0, K/M suffixes)
- Missing **border/shadow** controls per widget
- Missing **padding/inner spacing** control
- No **chart-level filter** separate from dashboard filter
- No **sort/limit** for legend series

### 1.6 Analytics / AI in Dashboard

- No **trend line** overlay (linear regression, moving average)
- No **forecasting** lane (Prophet-style projections)
- No **anomaly highlighting** (auto-detect outliers, highlight in chart)
- No **"Explain this chart"** AI button per widget
- No **smart insight chips** below chart ("↑ 23% higher than last month")
- No **comparative period** toggle (WoW, MoM, YoY)
- No **confidence intervals** on forecasts

### 1.7 Dashboard Management Gaps

- No **folder / workspace** hierarchy
- No **tags / labels** on dashboards
- No **version history** / snapshots
- No **dashboard duplication** action
- No **dashboard search** beyond simple name filter in navigator
- No **starred/favourites** list
- No **dashboard permissions** UI (view vs edit per user)
- No **audit log** for who changed what

### 1.8 Export Gaps

- Excel export: **not implemented** (console.log stub)
- No **PDF export** from the studio toolbar (only PNG via exportDashboardCanvas)
- No **scheduled export** to S3/email as PDF/Excel
- No **pixel-perfect print** stylesheet
- No **branded export** (add logo, title page)

---

## 2. `/chat` — AI Analytics Modes

### 2.1 Mode Coverage

The chat page is **EE-only** and redirects CE users to `/dashboards`. Mode gaps:

| Mode | Gap |
|---|---|
| **Standard analytics** | Response should auto-choose chart type from query intent; currently may return wrong chart |
| **Predictive mode** | Needs clearly rendered confidence bands + model attribution |
| **Report mode** | Should produce multi-section structured markdown with charts embedded; missing print/PDF download |
| **Dashboard mode** | Needs 2-way sync: (a) AI builds a draft dashboard layout, (b) edits to that draft persist to `/dashboards` |
| **Data exploration** | No "show me related insights" follow-up chain |

### 2.2 Chat UX Gaps

- No **message reactions / pin** for important insights
- No **conversation history search**
- No **share individual message** as feed post
- No **"Follow up on this chart"** — clicking a chart opens a follow-up thread
- No **multi-turn context awareness** across sessions (reset on page reload)
- No **inline chart editing** — can edit query from chat but not chart type
- No **AI confidence indicator** per response
- No **citation / data source attribution** per query
- No **streaming** visual for chart render (skeleton → chart)
- No **response quality feedback** thumbs up/down stored to backend

### 2.3 Dashboard Mode Specific

- When chat produces a dashboard layout it should **render an interactive mini-canvas** (not just widget screenshots)
- **"Add to dashboard"** should respect page structure
- **Widget parameter linking** — dashboard slicer changes should propagate to chat context
- **Cross-filter from chat** — clicking a chart data point in chat triggers analytical follow-up

---

## 3. `/chart-designer` — Studio Gaps

- No **AI field suggestion** ("given this table, recommend X for axis")
- No **visual comparison** of chart type options side by side
- Missing **custom color per series** override at design time
- No **template gallery** for starting a chart from a known pattern
- No **data preview panel** (see sample data rows while designing)
- No **formula / calculated field** builder (e.g., `revenue / orders` as a field)
- No **chart annotation layer** (draw a circle, add text note on chart)
- Missing **chart description/caption** field in designer

---

## 4. `/feed` — Social Knowledge Feed Gaps

- No **full-text search** across feed items
- No **reaction types** beyond likes (useful, insightful, question, etc.)
- No **thread / reply** nesting in comments
- No **@mention** in comments with notifications
- No **collections** — curated sets of feed items (playlist for BI content)
- No **richer embed** — embedded charts in feed should be interactive (not screenshots)
- No **follow author** functionality
- No **feed personalisation** based on viewing history
- Feed card only shows asset type tag — needs **data freshness badge** (chart data as of X)
- No **digest email** for feed highlights

---

## 5. `/query-editor` — SQL IDE Gaps

- No **query history** panel (past 50 queries with timestamps)
- No **saved queries** browser with folders
- No **AI explain** for SQL queries ("what does this query do?")
- No **AI refactor** ("optimise this query")
- No **visual query builder** tab (drag-and-drop table joins → SQL)
- No **result set charts** inline (run query → instant chart preview)
- No **pagination** for large result sets
- No **column type annotations** in results
- No **diff view** for comparing two query result sets
- No **schema explorer** tree sidebar while editing

---

## Priority Order for Implementation

### Wave 1 — Critical UX Fixes (implement immediately)
1. Replace `confirm()` → `Modal.confirm` in `DashboardCanvas.tsx`
2. Implement **Excel export** (`xlsx` library)
3. Add widget **focus/fullscreen** mode (expand single widget full viewport)
4. Add **section divider** widget type
5. Add **Image** widget type
6. **More layout presets** (2-col, analytics, report, ops)

### Wave 2 — Slicer & Stat Enhancements
7. Slicer: **date relative presets** (Today, Last 7d, This Month, etc.)
8. Slicer: **tile/chip mode** (horizontal toggle buttons)
9. Slicer: **numeric range slider** mode
10. StatWidget: **sparkline** mini-chart
11. StatWidget: **comparison period** value

### Wave 3 — New Chart Types
12. **Gauge** widget (ECharts gauge series)
13. **Treemap** widget
14. **Waterfall** chart
15. **Bullet** chart
16. **Geo / Choropleth** map widget

### Wave 4 — Analytics Intelligence
17. **Trend line** overlay toggle in chart options
18. **Reference lines** (average, target, custom value)
19. **Anomaly highlighting** (statistical outliers highlighted)
20. **"Explain this chart"** AI button per widget

### Wave 5 — Dashboard Management
21. **Dashboard tags**
22. **Folder hierarchy** for dashboards
23. **Dashboard duplicate** action
24. Canvas **undo/redo** (Ctrl+Z)
25. **Multi-widget select** (shift+click)

### Wave 6 — Chat Mode Depth
26. Dashboard mode: **interactive mini-canvas** preview
27. Streaming response skeleton
28. Response quality feedback
29. Comparative period selector in analytics mode

---

## Benchmark Matrix (vs leading tools) — Updated 2026-05-28

| Capability | Aicser | Power BI | Tableau | Looker Studio | Metabase | Status |
|---|---|---|---|---|---|---|
| Widget variety | **20 types** | 35+ | 40+ | 20+ | 18 | ✅ +8 since launch |
| Slicer types | **5** (dropdown, multi, tile, date, range) | 7 | 6 | 4 | 3 | ✅ Near-parity |
| Conditional formatting | **✓ table + stat** | ✓ | ✓ | ✓ | Partial | ✅ Implemented |
| Trend lines | **✓** | ✓ | ✓ | ✓ | ✓ | ✅ |
| Reference lines | **✓** multi (avg + N custom) | ✓ | ✓ | ✓ | ✗ | ✅ Improved |
| Anomaly highlighting | **✓** IQR outlier markpoints | ✓ | ✓ | ✗ | ✗ | ✅ Differentiator |
| Value format (K/M/%) | **✓** compact/currency/percent/full | ✓ | ✓ | ✓ | Partial | ✅ |
| Widget border/shadow | **✓** configurable per widget | ✓ | ✓ | ✓ | ✗ | ✅ |
| Widget subtitle | **✓** editable caption field | ✓ | ✓ | ✓ | ✗ | ✅ |
| AI explain chart | **✓ streaming** | Copilot | ✗ | ✗ | ✗ | ✅ Differentiator |
| AI chat in dashboard | EE only | Copilot | Ask Data | ✗ | ✗ | — |
| Cross-filter | ✓ | ✓ | ✓ | ✓ | Partial | ✅ |
| Drill-down | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ |
| Canvas zoom | **✓** 25–200% | ✓ | ✓ | ✓ | ✗ | ✅ |
| Undo / redo | **✓** | ✓ | ✓ | ✓ | ✗ | ✅ |
| Version history | **✓** (browser snapshots) | ✓ | ✓ | ✓ | ✗ | ✅ |
| Multi-widget select | **✓** shift+click | ✓ | ✓ | ✗ | ✗ | ✅ |
| Real-time collab | ✓ | ✗ | ✗ | ✓ | ✗ | ✅ Ahead |
| Geo maps | **✓** choropleth | ✓ | ✓ | ✓ | ✓ | ✅ |
| Excel export | **✓** | ✓ | ✓ | ✓ | ✓ | ✅ Fixed |
| Embed widget | **✓** iframe | ✓ | ✓ | ✓ | ✗ | ✅ |
| Stat sparklines | **✓** SVG inline | ✓ | ✓ | ✓ | ✗ | ✅ |
| Stat comparison | **✓** period delta | ✓ | ✓ | ✓ | ✗ | ✅ |
| Scheduled delivery | ✓ | ✓ | ✓ | ✓ | ✓ | ✅ |
| Dashboard duplication | **✓** | ✓ | ✓ | ✓ | ✓ | ✅ |
| Starred dashboards | **✓** | ✓ | ✗ | ✗ | ✗ | ✅ |
| Dashboard tags | **✓** | ✓ | ✓ | ✗ | ✗ | ✅ |
| Chart designer data preview | **✓** 5-row sample inline | ✓ | ✓ | ✓ | ✗ | ✅ |
| SQL AI explain | **✓** | n/a | n/a | n/a | n/a | ✅ Unique |
| SQL AI optimize | **✓** | n/a | n/a | n/a | n/a | ✅ Unique |
| Feed search | **✓** full-text + filters | ✓ | n/a | ✗ | ✗ | ✅ |
| Feed reactions | **✓** 6 types (like/love/insightful/…) | ✓ | n/a | ✗ | ✗ | ✅ |
| Live AI chart data† | Partial‡ | ✓ | ✓ | ✓ | ✓ | ⚠️ |

† AI-generated charts now prefer live SQL data over snapshots when filters change (WidgetRenderer fix). Full live-query requires AI to store chartQuery on save.  
‡ Filter-responsive only when chartQuery is stored alongside the snapshot.

---

## Remaining Gaps (not yet closed)

| Area | Gap | Complexity | Status |
|---|---|---|---|
| Dashboard | Folder/workspace hierarchy | High — needs backend tree model | ✅ Client-side localStorage folders in `useFolderStore`; full tree UI in navigator |
| Slicer | Cascading filter dependency (Region→City) | High — needs runtime filter chain | ✅ `cascadeFromField` prop; options reload when parent slicer value changes |
| Chat (EE) | Dashboard mode interactive mini-canvas | High — EE AI pipeline | — EE only, skipped |
| Feed | Interactive chart embeds in cards (not screenshots) | Medium | ✅ `ChartLivePreview` renders live ECharts for `chart` type feed items |
| Chart designer | AI field suggestion per table | Medium — EE AI | ✅ Heuristic `suggestFields()` + "Suggest fields" button in mapping mode |
| SQL editor | CE schema explorer without EE panel | Low | ✅ `CeSchemaExplorer` wired into `MonacoSQLEditor` behind IS_EE flag |

All platform gaps are now closed (EE-gated chat feature intentionally skipped for CE build).
