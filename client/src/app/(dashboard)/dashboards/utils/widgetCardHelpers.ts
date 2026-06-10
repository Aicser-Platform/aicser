/** Whether a widget card should show the title header row. */
export function shouldShowWidgetHeader(
  widget: { chartType: string; title?: string },
  options?: { isSelected?: boolean },
): boolean {
  const isText = widget.chartType === 'text';
  const isDivider = widget.chartType === 'divider';
  const hasTitle = Boolean(widget.title?.trim());
  if (isDivider) return false;
  if (!isText) return true;
  return hasTitle || Boolean(options?.isSelected);
}
