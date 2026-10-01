import type { ECharts } from 'echarts';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { getCrossFilterValues } from './filterOperators';

export type CrossFilterChartOpts = {
  chartType?: string;
  legendField?: string;
  interactionMode?: 'drill' | 'cross_filter';
  onDrill?: (field: string, value: unknown) => void;
};

export function crossFilterValueFromClick(
  params: {
    name?: string | number;
    componentType?: string;
    data?: unknown;
  },
  chartType?: string
): unknown {
  if (params.componentType === 'series') {
    // A grouped "Other" pie slice isn't a category of the data.
    if (params.data && typeof params.data === 'object' && (params.data as { isOther?: boolean }).isOther) {
      return null;
    }
    if (chartType === 'scatter' && Array.isArray(params.data)) {
      return params.data[0];
    }
    // Pie slices show a formatted name ("Jun 2024"); filter by the value itself.
    if (params.data && typeof params.data === 'object' && (params.data as { raw?: unknown }).raw != null) {
      return (params.data as { raw: string | number }).raw;
    }
    if (params.name != null) return params.name;
  }
  return null;
}

function nativeShiftKey(params: { event?: { event?: MouseEvent } }): boolean {
  return Boolean(params.event?.event?.shiftKey);
}

export function createCrossFilterChartReady(
  xField: string | undefined,
  onCrossFilter?: (field: string, value: unknown) => void,
  runtimeFilters: RuntimeFilter[] = [],
  opts?: CrossFilterChartOpts
) {
  return createChartInteractionReady({
    xField,
    onCrossFilter,
    onDrill: opts?.onDrill,
    interactionMode: opts?.interactionMode,
    runtimeFilters,
    chartType: opts?.chartType,
    legendField: opts?.legendField,
  });
}

export function createChartInteractionReady(opts: {
  xField?: string;
  onCrossFilter?: (field: string, value: unknown) => void;
  onDrill?: (field: string, value: unknown) => void;
  interactionMode?: 'drill' | 'cross_filter';
  runtimeFilters?: RuntimeFilter[];
  chartType?: string;
  legendField?: string;
}) {
  const {
    xField,
    onCrossFilter,
    onDrill,
    interactionMode = 'cross_filter',
    runtimeFilters = [],
    chartType,
    legendField,
  } = opts;

  return (instance: ECharts) => {
    // Replace only our own previous handler: other listeners (editing axis titles, adding notes
    // on points) live on the same chart.
    const holder = instance as ECharts & { __aicserInteractionClick?: (...args: any[]) => void };
    if (holder.__aicserInteractionClick) instance.off('click', holder.__aicserInteractionClick);

    const handleClick = (params: {
      name?: string | number;
      componentType?: string;
      data?: unknown;
      event?: { event?: MouseEvent };
    }) => {
      const shiftKey = nativeShiftKey(params);

      if (params.componentType === 'legend' && legendField && params.name != null) {
        if (shiftKey && onCrossFilter) {
          onCrossFilter(legendField, params.name);
        } else if (onDrill && interactionMode === 'drill') {
          onDrill(legendField, params.name);
        } else if (onCrossFilter) {
          onCrossFilter(legendField, params.name);
        }
        return;
      }

      if (!xField) return;
      const value = crossFilterValueFromClick(params, chartType);
      if (value == null) return;

      if (shiftKey && onCrossFilter) {
        onCrossFilter(xField, value);
        return;
      }

      if (onDrill && interactionMode === 'drill') {
        onDrill(xField, value);
        return;
      }

      if (onCrossFilter) {
        onCrossFilter(xField, value);
      }
    };

    if (onCrossFilter || onDrill) {
      // echarts' .on('click', ...) overload wants the full ECElementEvent + `this`
      // binding; handleClick only reads a small, stable subset of those fields.
      holder.__aicserInteractionClick = handleClick as (...args: any[]) => void;
      (instance.on as (event: 'click', handler: typeof handleClick) => void)('click', handleClick);
    }

    if (xField) {
      syncCrossFilterHighlight(instance, xField, runtimeFilters);
    }
  };
}

/** Dim non-selected categories when a cross-filter is active on the x dimension. */
export function syncCrossFilterHighlight(
  instance: ECharts,
  xField: string,
  runtimeFilters: RuntimeFilter[]
) {
  const selected = new Set(getCrossFilterValues(runtimeFilters, xField));
  if (!selected.size) {
    instance.dispatchAction({ type: 'downplay', seriesIndex: 'all' as unknown as number });
    return;
  }

  const option = instance.getOption() as {
    xAxis?: { data?: unknown[] } | { data?: unknown[] }[];
    series?: { data?: unknown[]; type?: string }[];
  };
  const xAxis = Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis;
  const categories = (xAxis?.data || []).map(String);

  instance.dispatchAction({ type: 'downplay', seriesIndex: 'all' as unknown as number });

  if (!categories.length) {
    const pieSeries = option.series?.find((s) => s.type === 'pie');
    if (pieSeries && Array.isArray(pieSeries.data)) {
      pieSeries.data.forEach((item, dataIndex) => {
        const obj = typeof item === 'object' && item !== null ? (item as { name?: unknown; raw?: unknown }) : null;
        // Slices carry the raw value next to their formatted name ("Jun 2024").
        const name = obj ? String(obj.raw ?? obj.name) : String(item);
        if (selected.has(name)) {
          instance.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex });
        } else {
          instance.dispatchAction({ type: 'downplay', seriesIndex: 0, dataIndex });
        }
      });
    }
    return;
  }

  categories.forEach((cat, dataIndex) => {
    const action = selected.has(cat) ? 'highlight' : 'downplay';
    (option.series || []).forEach((_, seriesIndex) => {
      instance.dispatchAction({ type: action, seriesIndex, dataIndex });
    });
  });
}
