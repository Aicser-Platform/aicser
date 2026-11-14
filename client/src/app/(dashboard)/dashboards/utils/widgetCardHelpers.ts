/** KPI layouts that render the title inside the card body. */
export const STAT_INLINE_TITLE_LAYOUTS = new Set(['executive', 'centered', 'tile']);

/** KPI layouts that paint their own surface (filled / tinted): the surface is the card, so it fills
 * the card edge to edge instead of sitting inside the card's padding as a second card. */
export const STAT_FILLED_LAYOUTS = new Set(['executive', 'tile']);

export function isFilledStatWidget(widget: { chartType: string; chartOptions?: Record<string, unknown> }): boolean {
  return widget.chartType === 'stat' && STAT_FILLED_LAYOUTS.has(String(widget.chartOptions?.layout || ''));
}

/** Whether a widget card should show the title header row. */
export function shouldShowWidgetHeader(
  widget: { chartType: string; title?: string; chartOptions?: Record<string, unknown> },
  options?: { isSelected?: boolean; isDesigner?: boolean },
): boolean {
  const isText = widget.chartType === 'text';
  const isDivider = widget.chartType === 'divider';
  const layout = String(widget.chartOptions?.layout || '');
  const inlineTitleStat = widget.chartType === 'stat' && STAT_INLINE_TITLE_LAYOUTS.has(layout);
  // Chart Designer already shows the title in the toolbar — hide the card header to avoid duplicates.
  // A KPI keeps it: the title is part of how the card reads on a dashboard, and the preview shows that.
  if (options?.isDesigner) return widget.chartType === 'stat' && !inlineTitleStat;
  // Text blocks render title inside TextWidget (document-style) — never use card chrome.
  if (isText) return false;
  if (isDivider) return false;
  if (inlineTitleStat) return Boolean(options?.isSelected);
  return true;
}
