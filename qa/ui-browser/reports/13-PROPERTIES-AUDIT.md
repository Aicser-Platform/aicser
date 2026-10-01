# 13 — Properties panel audit (Build, Format, Filters, Sort)

**Date:** 25 Sep 2026 · **Scope:** every property of every widget type, in the Chart Designer and the dashboard studio (same panel).
**Bar:** a newcomer, a non-technical employee or a non-native English speaker can build a publication-ready chart quickly, without reading help.
**Compared with:** Datawrapper (Refine / Annotate), Power BI format and analytics panes, Looker Studio (Setup / Style), Canva (select → controls).

Status: **Done** = in the working tree and checked in the running app. **Open** = recommended next.

---

## 1. Structure

| Before | Industry pattern | Now |
| --- | --- | --- |
| Four tabs: Build, Format, Filters, Sort. Sort held 2–3 controls plus click behaviour | Sort sits with the data (Datawrapper, Looker); click behaviour sits with filters | **Done:** three tabs. Sort is the last Build section; "On click" is on Filters |
| Format was a flat list: style, overlays, value format, colors, display toggles, then a "Design" block that repeated several of them | One pass from general to specific (Power BI: visual → axes → labels → analytics) | **Done:** Preset → Style → Colors → Labels → X axis → Y axis → Analytics (folded) |
| Description and source above the chart type | Datawrapper: data → refine → annotate | **Done:** annotations are the last Build section |

## 2. Duplicates removed

| Two controls for one thing | Kept |
| --- | --- |
| "Brand footer" (Format → Design) and "Source / notes" (Build) | Source / notes. Old brand footers show as the source; editing the source retires them |
| "Value on bar" (Design) and "Data label" (Display) | Data label, with a position choice for bars (outside end / inside) |
| "Thresholds" (Design) and "Reference lines" (Overlays) | One Reference lines list in Analytics. Old thresholds appear in it and move over on first edit |
| Axis title and show/hide under Display; axis scale under Design | One block per axis: show values, title, label angle, scale |
| Chips "Category: order_date · month" under Table, repeating the shelves below | Removed |
| Field list + search under the shelves, repeating the shelf pickers | Folded behind "Fields (n)"; search only for tables with 12+ columns |
| "Auto (compact K/M)" and "Compact (1.2K / 3.4M)" | Auto. Compact stays only for charts already using it |

## 3. Build

| Property | Finding | Status |
| --- | --- | --- |
| Chart type | 18 unlabelled icons, 6 greyed out | **Done:** name under each icon; types that need other data behind "N more types", each saying what it needs |
| Dataset (Table / Query) | Choosing Query could not be undone; table shelves stayed visible, so it was unclear which drove the chart | **Done:** Table always goes back; in Query mode the shelves wait for a query, with one line saying what to do |
| Shelves | "Category", "Slice by", "Split by", "Row grouping", "Metric", "Value" for the same few ideas, English only | **Done:** Group by / Color by / Numbers everywhere; every shelf label translated |
| Date grouping | "None (raw values)" | **Done:** "Exact dates", Year … Hour, translated |
| Sort | "Sort ascending" checkbox; "Largest first" on a date | **Done:** direction named by the field: Oldest/Newest first, A→Z, Smallest/Largest first |
| Row limit | "Row limit", placeholder "Default (5000)" | **Done:** "Show up to", placeholder "All" |
| Switching to Scatter | Failed with "Couldn't load data": the query read the source's first table, not the chart's | **Done** (server fix + test) |
| Pie from a bar | Largest-first sort stayed when going back, so dates ran backwards | **Done:** the pie's automatic sort is undone when leaving pie |

## 4. Format

| Property | Finding | Status |
| --- | --- | --- |
| Preset | Paragraph of jargon ("same idea as Tableau Marks / Power BI format pane") | **Done:** ⓘ tooltip; the picker shows only when the type has a preset besides Standard |
| Stacking, series order, max series | Shown on single-series charts | **Done:** only with a Color by or several numbers |
| Orientation, stacking, line style | "Combo Line", "100% Stacked Line Chart", English only | **Done:** "Bars + line", "Stacked to 100%", "Smooth", translated |
| Palette | "Chart colors (this widget)" | **Done:** "Palette" |
| Number format | Currency was always "$" | **Done:** any currency (common ones named in the reader's language, or any typed symbol, e.g. ៛, CHF), used by axes, labels, tooltips and KPI cards |
| Decimals | No control | **Done:** Auto / 0–3 |
| X label angle | No control (renderer supported it) | **Done:** Level / 45° / Vertical |
| Axis titles | Fixed 42 px from the axis: overlapped wide labels ("$1,250,000"), floated away when labels were hidden | **Done:** placed from the labels actually drawn, rotation included (test added) |
| Pie legend and slices | Raw timestamps "2024-06-01T00:00:00" | **Done:** "Jun 2024"; clicks still filter by the exact value |
| Reference lines | Drawn on Y even for horizontal bars; value unformatted | **Done:** on the value axis; value in the chart's number format |
| Header icon | Set in the Designer, where the card header is hidden | **Open:** show only on dashboards, or preview it in the Designer toolbar |
| Axis range (start / end) | Missing (Power BI has it) | **Open:** optional min / max per value axis |

## 5. Filters

| Property | Finding | Status |
| --- | --- | --- |
| Chart filter editor | All 12 SQL operators for every column ("Like" on dates, ">" on text), "Is null" first, English only | **Done:** operators per column kind in plain words (is, is one of, contains, before, after, at least…) |
| Value input | Date columns got a list of raw timestamps; ">" on numbers got a list of existing values | **Done:** date picker for dates, number box for comparisons, list for is/is not, Yes/No for booleans, nothing for "is empty" |
| Captions | "Only this chart" → "Filters" → "Keep totals…" stacked | **Done:** the buttons carry the meaning ("Add a condition", "Only show groups whose total…") |
| Messages | Two hardcoded English explanations | **Done:** translated, plain wording |

## 6. Words around the chart

Title, description under it, source / notes under the chart: now the same in the studio, viewer, feed, Designer (description under the toolbar title) and **PNG / SVG exports**, which previously had the title only.

---

## 7. Second pass (after review of a horizontal-bar chart)

| Area | Finding | Status |
| --- | --- | --- |
| Horizontal bars | Category labels "2024-…" (raw timestamps cut at 50 px); tooltip title a raw timestamp | **Done:** "Jun 2024", 120 px, tooltip titles formatted on every chart |
| Data label position | Horizontal bars always drew values inside, where they vanished; no choice for lines or pies | **Done:** one dropdown per type — bars: Outside / Inside / Center; lines: Above / Below; pies: Outside / Inside. Colliding labels are dropped |
| Pie labels | Always "Name: value (percent)" | **Done:** choose any of Name, Value, Percent |
| Log scale on bars | Offered, and bars were measured from the smallest value | **Done:** not offered on bars and ignored for saved bar charts |
| Axis range | Missing | **Done:** From / To on the value axis (X on horizontal bars) |
| Label angle | Three presets only | **Done:** any angle −90° to 90° (slider or typed), presets marked |
| Axis labels with fixed decimals | "KHR 5.00k" | **Done:** decimals apply to data labels and tooltips; axes stay clean |
| Last value-axis labels | Overlapped ("30.00k 35.00k") or were cut | **Done:** colliding labels hidden, end labels kept inside |
| Average / reference line labels | Ghosted white outline, cut at the edge | **Done:** plain muted text inside the plot |
| Legend position | Top / Bottom / Left / Right | **Done:** 8 positions (top/bottom × left/center/right, middle left/right) |
| Colors | One "primary" color; no way to change one bar or series | **Done:** "Colors of items" — click any series, bar or slice to change it; Reset per item or all. 20 curated colors per palette, more generated beyond that |
| Text | No font, size or color control | **Done:** Text section — font, size (S/M/L), color for all chart text; per element (title, axis labels, data labels, legend) color, size, bold |
| Source / notes | Spaces vanished while typing | **Done** |
| Designer data | No copy or download | **Done:** Download menu — Copy data (pastes into a spreadsheet), CSV, Excel, PNG, SVG. Dashboards gain Copy data; the card menu is translated |
| Header icon | Offered in the Designer, where it never shows | **Done:** dashboards only |
| Translations | ≈610 strings English in 8 languages | **Done:** all strings in use translated in de, es, fr, id, ja, km, th, vi, zh (511 dashboard/Properties + 90 Designer). A native-speaker review is still advised |
| Counts | "1 charts" in several languages; the dashboard list said "charts" | **Done:** plural forms; dashboards counted as dashboards |

## 8. Still open

1. Native-speaker review of the new translations, starting with km and th.
2. Month names inside charts follow the browser's language, not the app's.
