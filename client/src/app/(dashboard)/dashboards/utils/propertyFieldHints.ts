/** i18n keys under chart_specific_fields for property panel tooltips. */
const FIELD_HINT_KEYS: Record<string, string> = {
  x: 'field_hint_category',
  yMetrics: 'field_hint_measure',
  yMetricsSecondary: 'field_hint_yMetricsSecondary',
  xMetrics: 'field_hint_xMetrics',
  legend: 'field_hint_legend',
  size: 'field_hint_size',
  filters: 'field_hint_filters',
  metricFilters: 'field_hint_metricFilters',
  yMetric: 'field_hint_yMetric',
};

export function resolvePropertyFieldHint(
  fieldKey: string,
  t: (key: string) => string,
): string | undefined {
  const hintKey = FIELD_HINT_KEYS[fieldKey];
  if (!hintKey) return undefined;
  try {
    const value = t(hintKey);
    return value && value !== hintKey ? value : undefined;
  } catch {
    return undefined;
  }
}
