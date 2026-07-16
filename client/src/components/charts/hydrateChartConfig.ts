/** Unwrap primary_chart wrapper used by backend chart builder. */
export function rawChartConfig(config: unknown): Record<string, unknown> {
  if (!config || typeof config !== 'object') return {};
  const c = config as Record<string, unknown>;
  if (c.primary_chart && typeof c.primary_chart === 'object') {
    return c.primary_chart as Record<string, unknown>;
  }
  return c;
}

/**
 * Inject query rows into ECharts dataset when series use encode but carry no data.
 * Common for backend configs that expect client-side dataset hydration.
 */
export function hydrateChartConfigFromQueryResult(
  config: unknown,
  rows: Record<string, unknown>[] | null | undefined
): unknown {
  if (!config || !rows?.length || typeof config !== 'object') return config;

  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  } catch {
    return config;
  }

  const inner = rawChartConfig(cfg);
  const series = inner.series as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(series) || series.length === 0) return config;

  const hasSeriesData = series.some((s) => {
    const data = s.data as unknown[] | undefined;
    return Array.isArray(data) && data.length > 0;
  });
  const ds = inner.dataset as Record<string, unknown> | undefined;
  const dsSource = ds?.source as unknown[] | undefined;
  const hasDataset = Array.isArray(dsSource) && dsSource.length > 0;
  if (hasSeriesData || hasDataset) return config;

  const hasEncode = series.some((s) => s.encode && typeof s.encode === 'object');
  if (!hasEncode) return config;

  inner.dataset = {
    ...(ds || {}),
    source: rows,
    dimensions: (ds?.dimensions as string[] | undefined) || Object.keys(rows[0] || {}),
  };

  if (cfg.primary_chart && typeof cfg.primary_chart === 'object') {
    return { ...cfg, primary_chart: inner };
  }
  return inner;
}

/** Validate chart config has renderable structure (series and/or dataset). */
export function isChartConfigRenderable(
  config: unknown,
  rows?: Record<string, unknown>[] | null
): boolean {
  if (!config || typeof config !== 'object') return false;
  const hydrated = hydrateChartConfigFromQueryResult(config, rows || null);
  const inner = rawChartConfig(hydrated);
  const anim = inner.__animate as Record<string, unknown> | undefined;
  if (anim && Array.isArray(anim.frames) && anim.frames.length > 0) return true;
  const series = inner.series as Array<Record<string, unknown>> | undefined;
  const ds = inner.dataset as Record<string, unknown> | undefined;
  const hasSeries = Array.isArray(series) && series.length > 0;
  const hasDataset =
    ds &&
    (Array.isArray(ds.source) && ds.source.length > 0 ||
      (ds.source && typeof ds.source === 'object'));
  if (!hasSeries && !hasDataset) return false;
  const hasSeriesData = (series || []).some((s) => {
    const data = s.data as unknown[] | undefined;
    return Array.isArray(data) && data.length > 0;
  });
  const hasEncode = (series || []).some((s) => s.encode && typeof s.encode === 'object');
  const hasRows = Array.isArray(rows) && rows.length > 0;
  return hasSeriesData || !!hasDataset || (hasEncode && hasRows);
}
