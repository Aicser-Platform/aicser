import type { WidgetInstance } from '../stores/dashboardStoreTypes';
import { CHART_TYPE_CONFIGS } from '../Properties/PropertiesPanelConfig';

export type SetupIssue = {
  key: string;
  messageKey: string;
  section?: 'dataSource' | 'table' | 'fields' | 'style';
};

const NON_DATA = new Set(['text', 'divider', 'image', 'embed']);

function isFieldPopulated(chartQuery: Record<string, unknown> | undefined, fieldKey: string, fieldType: string): boolean {
  const value = chartQuery?.[fieldKey];
  if (fieldType === 'metric-list' || fieldType === 'filter-list' || fieldType === 'metric-filter-list') {
    if (Array.isArray(value) && value.length > 0) return true;
    // A truthy chartQuery.aggregate is already treated elsewhere in this
    // codebase (PropertiesSetupSteps.tsx, useWidgetProperties.ts) as "this
    // widget's measure is configured" - it covers a yMetrics-less "count of
    // rows" query (chart_service.py's documented { x, aggregate: 'count' }
    // shape, e.g. from AI-generated widgets), which needs no yMetrics entry
    // since COUNT(*) needs no field.
    if (fieldKey === 'yMetrics' && chartQuery?.aggregate) return true;
    return false;
  }
  return Boolean(value);
}

/**
 * Which of the CURRENT chart type's own required fields (per
 * CHART_TYPE_CONFIGS) are actually populated on this widget. Chart-type
 * switching (chartTypeMappingPreserve.ts) carries chartQuery fields forward
 * as-is rather than reshaping them for the destination type, so a widget can
 * end up "valid" by the old generic hasFields check (something, anything, is
 * set) while genuinely missing a field the new type requires - e.g.
 * switching a stat widget (no x field at all) to Bar (x required) leaves x
 * unset, or switching to Heatmap leaves its required second dimension
 * (groupField) unset since nothing seeds it. Schema-driven check catches
 * both instead of only ever checking x/yMetrics/aggregate.
 */
function missingRequiredFields(widget: WidgetInstance): string[] {
  const config = CHART_TYPE_CONFIGS[widget.chartType];
  if (!config) return [];
  const chartQuery = widget.chartQuery as Record<string, unknown> | undefined;
  return config.fields
    .filter((f) => f.required && !isFieldPopulated(chartQuery, f.key, f.type))
    .map((f) => f.key);
}

export function getWidgetSetupIssues(widget: WidgetInstance | null): SetupIssue[] {
  if (!widget || NON_DATA.has(widget.chartType)) return [];

  const issues: SetupIssue[] = [];
  const isSlicer = widget.chartType === 'slicer' || widget.chartType === 'filter';
  const hasSource = Boolean(widget.dataSourceId);
  const hasTable = Boolean(widget.chartQuery?.tableName);
  // A widget bound to a saved query / snapshot / custom SQL never has (and
  // never needs) tableName - bindSavedQuery() explicitly deletes it. Without
  // this exemption every SQL-bound widget permanently showed "Table not
  // set" in the properties header despite rendering data correctly.
  const hasSqlSource = Boolean(
    widget.chartQuery?.saved_query_id ||
      widget.chartQuery?.query_snapshot_id ||
      (typeof widget.chartOptions?.sample_sql === 'string' && widget.chartOptions.sample_sql.trim()),
  );
  // A SQL-bound widget (saved query / snapshot / custom SQL) gets its shape
  // from the query's own result columns, not the x/yMetrics shelf UI - the
  // schema's required-field list assumes the shelf-driven path, so it
  // doesn't apply here (this generalizes what used to be a `table`-only
  // exemption, which was really just approximating "tables are often
  // SQL-bound" rather than the actual reason).
  const missingFields = hasSqlSource ? [] : missingRequiredFields(widget);
  const hasFields = missingFields.length === 0;

  if (!hasSource) {
    issues.push({ key: 'source', messageKey: 'setup_missing_source', section: 'dataSource' });
  }
  if (!isSlicer && hasSource && !hasTable && !hasSqlSource && widget.chartType !== 'stat') {
    issues.push({ key: 'table', messageKey: 'setup_missing_table', section: 'table' });
  }
  if (hasSource && !hasFields) {
    issues.push({ key: 'fields', messageKey: 'setup_missing_fields', section: 'fields' });
  }

  if ((widget.chartOptions as { _layoutSlot?: boolean })?._layoutSlot) {
    issues.push({ key: 'slot', messageKey: 'setup_layout_slot', section: 'fields' });
  }

  return issues;
}

export function isWidgetSetupComplete(widget: WidgetInstance | null): boolean {
  return getWidgetSetupIssues(widget).length === 0;
}
