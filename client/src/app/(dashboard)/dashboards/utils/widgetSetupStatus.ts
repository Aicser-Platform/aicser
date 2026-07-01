import type { WidgetInstance } from '../stores/dashboardStoreTypes';

export type SetupIssue = {
  key: string;
  messageKey: string;
  section?: 'dataSource' | 'table' | 'fields' | 'style';
};

const NON_DATA = new Set(['text', 'divider', 'image', 'embed']);

export function getWidgetSetupIssues(widget: WidgetInstance | null): SetupIssue[] {
  if (!widget || NON_DATA.has(widget.chartType)) return [];

  const issues: SetupIssue[] = [];
  const isSlicer = widget.chartType === 'slicer' || widget.chartType === 'filter';
  const isScatter = widget.chartType === 'scatter';
  const hasSource = Boolean(widget.dataSourceId);
  const hasTable = Boolean(widget.chartQuery?.tableName);
  const hasFields = Boolean(
    (widget.chartQuery as { field?: string })?.field ||
      widget.chartQuery?.x ||
      widget.chartQuery?.yMetrics?.length ||
      widget.chartQuery?.aggregate ||
      (isScatter && widget.chartQuery?.xMetrics?.length && widget.chartQuery?.yMetrics?.length),
  );

  if (!hasSource) {
    issues.push({ key: 'source', messageKey: 'setup_missing_source', section: 'dataSource' });
  }
  if (!isSlicer && hasSource && !hasTable && widget.chartType !== 'stat') {
    issues.push({ key: 'table', messageKey: 'setup_missing_table', section: 'table' });
  }
  if (hasSource && (isSlicer ? !hasFields : !hasFields && widget.chartType !== 'table')) {
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
