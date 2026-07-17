/** Whether a widget card should show the title header row. */
export function shouldShowWidgetHeader(
  widget: { chartType: string; title?: string; chartOptions?: Record<string, unknown> },
  options?: { isSelected?: boolean },
): boolean {
  const isText = widget.chartType === 'text';
  const isDivider = widget.chartType === 'divider';
  const isExecutiveStat = widget.chartType === 'stat' && widget.chartOptions?.layout === 'executive';
  const hasTitle = Boolean(widget.title?.trim());
  if (isDivider) return false;
  if (isExecutiveStat) return Boolean(options?.isSelected);
  if (!isText) return true;
  return hasTitle || Boolean(options?.isSelected);
}
