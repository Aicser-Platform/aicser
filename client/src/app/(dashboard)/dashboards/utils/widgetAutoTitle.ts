/**
 * Automatic widget titles (Power BI / Looker style): a widget whose title the user never typed
 * gets one from its data ("Total order total by store") and keeps it in step when the data or the
 * chart type changes. A title the user typed is never touched.
 *
 * A title is automatic when it equals `chartOptions.__autoTitle` (set whenever we write one), or
 * for older widgets, when it is still a placeholder: a widget template name or a story-layout slot
 * label. Placeholders are passed in so they can be the translated ones.
 */
import { WIDGET_TEMPLATES } from '../widgetTemplates';

export const AUTO_TITLE_KEY = '__autoTitle';

type Translate = (key: string, values?: Record<string, string>) => string;

type WidgetLike = {
  title?: string;
  chartType?: string;
  chartQuery?: Record<string, unknown> | null;
  chartOptions?: Record<string, unknown> | null;
};

const NO_TITLE_TYPES = new Set(['text', 'divider', 'image', 'embed', 'slicer', 'filter']);

export function isAutoTitle(widget: WidgetLike, placeholders: Iterable<string> = []): boolean {
  const title = String(widget.title ?? '').trim();
  if (!title) return true;
  const marked = widget.chartOptions?.[AUTO_TITLE_KEY];
  if (typeof marked === 'string' && marked.trim() === title) return true;
  const lower = title.toLowerCase();
  for (const t of WIDGET_TEMPLATES) if (t.name.toLowerCase() === lower) return true;
  for (const p of placeholders) if (p && p.trim().toLowerCase() === lower) return true;
  return false;
}

/** "order_total" → "order total"; a trailing _id/_key names the thing itself ("store_id" → "store"). */
export function fieldPhrase(field: string): string {
  const base = String(field).split('.').pop() || String(field);
  const stripped = base.replace(/_(id|key)$/i, '') || base;
  return stripped.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function capitalise(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

const AGG_KEYS: Record<string, string> = {
  sum: 'auto_title_sum',
  avg: 'auto_title_avg',
  mean: 'auto_title_avg',
  count: 'auto_title_count',
  distinct_count: 'auto_title_distinct',
  min: 'auto_title_min',
  max: 'auto_title_max',
};

/** A title from the widget's data, or null when there's nothing bound to name it after. */
export function deriveAutoTitle(widget: WidgetLike, t: Translate): string | null {
  const type = String(widget.chartType || '').toLowerCase();
  if (NO_TITLE_TYPES.has(type)) return null;
  const q = (widget.chartQuery || {}) as Record<string, unknown>;
  const metrics = Array.isArray(q.yMetrics) ? (q.yMetrics as Array<{ field?: string; aggregation?: string }>) : [];
  const first = metrics.find((m) => m && m.field);
  if (!first?.field) return null;
  const aggKey = AGG_KEYS[String(first.aggregation || '').toLowerCase()];
  const field = fieldPhrase(first.field);
  const metric = aggKey ? t(aggKey, { field }) : field;
  const x = typeof q.x === 'string' && q.x && type !== 'stat' && type !== 'gauge' ? q.x : null;
  const title = x ? t('auto_title_by', { metric, dimension: fieldPhrase(x) }) : metric;
  return capitalise(title);
}

/**
 * The title (and marker) to apply after `next` replaces `prev`, or null to leave it alone.
 * With no data yet, a type switch still renames a placeholder to the new type's template name,
 * so a pie is never left titled "KPI".
 */
export function autoTitlePatch(
  prev: WidgetLike,
  next: WidgetLike,
  t: Translate,
  placeholders: Iterable<string> = [],
): { title: string; chartOptions: Record<string, unknown> } | null {
  if (!isAutoTitle(prev, placeholders)) return null;
  let title = deriveAutoTitle(next, t);
  if (!title && next.chartType !== prev.chartType) {
    title = WIDGET_TEMPLATES.find((tpl) => tpl.type === next.chartType)?.name ?? null;
  }
  if (!title || title === prev.title) return null;
  return { title, chartOptions: { ...(next.chartOptions || {}), [AUTO_TITLE_KEY]: title } };
}

/** Titles layouts give their empty slots ("KPI", "Trend"…), as dashboards_page keys. */
export const PLACEHOLDER_TITLE_KEYS = [
  'story_slot_kpi',
  'story_slot_trend',
  'story_slot_compare',
  'story_slot_share',
  'story_slot_detail',
] as const;

/**
 * The title to show. A widget still carrying a placeholder ("KPI" on a pie, "Line" on a bar)
 * shows the title its data gives it, on every surface, until someone types their own.
 */
export function displayTitle(widget: WidgetLike, t: Translate): string {
  const title = String(widget.title ?? '');
  const placeholders = PLACEHOLDER_TITLE_KEYS.map((k) => t(k));
  if (!isAutoTitle(widget, placeholders)) return title;
  return deriveAutoTitle(widget, t) || title;
}
