/**
 * Configuration for chart types and their properties
 * Makes it easy to add new chart types or modify existing ones
 */

export interface ChartTypeConfig {
  label: string;
  fields: ChartFieldConfig[];
}

export interface ChartFieldConfig {
  key: string;
  type: 'select' | 'toggle' | 'segmented' | 'checkbox' | 'metric-list' | 'filter-list' | 'metric-filter-list';
  label: string;
  required?: boolean;
  dependsOn?: string;
  options?: SegmentedOption[];
  conditionalRender?: (query: any, chartOptions?: any) => boolean; // Updated to accept chartOptions
  maxCount?: number;
  /** For select fields that accept multiple values (e.g. drillPath) */
  mode?: 'multiple' | 'tags';
  allowClear?: boolean;
  /** Shown under Build → More options (progressive disclosure for non-technical users). */
  advanced?: boolean;
}

export interface SegmentedOption {
  label: string;
  value: string | boolean;
}

/** Date bucketing for X — matches chart_service._get_date_trunc grains */
export const X_GRAIN_OPTIONS: SegmentedOption[] = [
  { label: 'None (raw values)', value: '' },
  { label: 'Year', value: 'year' },
  { label: 'Quarter', value: 'quarter' },
  { label: 'Month', value: 'month' },
  { label: 'Week', value: 'week' },
  { label: 'Day', value: 'day' },
  { label: 'Hour', value: 'hour' },
];

const X_GRAIN_FIELD: ChartFieldConfig = {
  key: 'xGrain',
  type: 'select',
  label: 'Date grouping',
  required: false,
  options: X_GRAIN_OPTIONS,
  allowClear: true,
  conditionalRender: (query) => {
    if (query?.xGrain) return true;
    const x = String(query?.x || '');
    return /date|time|year|month|week|day|quarter|hour|timestamp/i.test(x);
  },
};

const ADDITIONAL_DIMS_FIELD: ChartFieldConfig = {
  key: 'drillPath',
  type: 'select',
  label: 'Drill-down levels',
  required: false,
  mode: 'multiple',
  allowClear: true,
  advanced: true,
};

/** Insert date grain after X and additional dims after legend (or after Y if no legend). */
function withDimensionShelves(fields: ChartFieldConfig[]): ChartFieldConfig[] {
  const out: ChartFieldConfig[] = [];
  let insertedGrain = false;
  let insertedExtra = false;
  for (const field of fields) {
    out.push(field);
    if (field.key === 'x' && !insertedGrain) {
      out.push(X_GRAIN_FIELD);
      insertedGrain = true;
    }
    if (field.key === 'groupField' && !insertedExtra) {
      out.push(ADDITIONAL_DIMS_FIELD);
      insertedExtra = true;
    }
  }
  if (!insertedExtra) {
    // table / pie: put after yMetrics
    const yIdx = out.findIndex((f) => f.key === 'yMetrics');
    if (yIdx >= 0) {
      out.splice(yIdx + 1, 0, ADDITIONAL_DIMS_FIELD);
    } else {
      out.push(ADDITIONAL_DIMS_FIELD);
    }
  }
  return out;
}

export interface ComputedMetricSide {
  field: string;
  aggregation: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'distinct_count';
  filter?: Array<{ field: string; operator: string; value: unknown }>;
}

export type MetricValueFormat = 'auto' | 'compact' | 'currency' | 'percent' | 'full';

export interface ComputedMetric {
  type: 'ratio';
  numerator: ComputedMetricSide;
  denominator: ComputedMetricSide;
  multiplier: 1 | 100;
  format?: MetricValueFormat;
}

export const METRIC_OPTIONS: SegmentedOption[] = [
  { label: "Don't summarize", value: 'none' },
  { label: 'Count', value: 'count' },
  { label: 'Count distinct', value: 'distinct_count' },
  { label: 'Sum', value: 'sum' },
  { label: 'Average', value: 'avg' },
  { label: 'Minimum', value: 'min' },
  { label: 'Maximum', value: 'max' },
];

export const BAR_CHART_TYPE_OPTIONS: SegmentedOption[] = [
  { label: 'Vertical', value: 'vertical' },
  { label: 'Horizontal', value: 'horizontal' },
];

export const BAR_CHART_TYPE_SELECT_OPTIONS = [
  { label: 'Vertical', value: 'vertical' },
  { label: 'Horizontal', value: 'horizontal' },
  { label: 'Combo Line', value: 'combo-line' },
];

export const BAR_STACK_MODE_OPTIONS = [
  { label: 'None', value: 'none' },
  { label: 'Stacked', value: 'stacked' },
  { label: '100% Stacked', value: 'stacked-100' },
];

export const LINE_CHART_TYPE_OPTIONS = [
  { label: 'Line', value: 'line' },
  { label: 'Smooth', value: 'smooth' },
  { label: 'Step', value: 'step' },
];

export const LINE_STACK_MODE_OPTIONS = [
  { label: 'Line Chart', value: 'none' },
  { label: 'Stacked Line Chart', value: 'stacked' },
  { label: '100% Stacked Line Chart', value: 'stacked-100' },
];

export const AREA_STACK_MODE_OPTIONS = [
  { label: 'Area Chart', value: 'none' },
  { label: 'Stacked Area Chart', value: 'stacked' },
  { label: '100% Stacked Area Chart', value: 'stacked-100' },
];

export const CHART_TYPE_CONFIGS: Record<string, ChartTypeConfig> = {
  pie: {
    label: 'Pie Chart',
    fields: withDimensionShelves([
      {
        key: 'x',
        type: 'select',
        label: 'Slice by',
        required: false, // In Power BI you can have just values
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ]),
  },
  donut: {
    label: 'Donut Chart',
    fields: withDimensionShelves([
      {
        key: 'x',
        type: 'select',
        label: 'Slice by',
        required: false,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ]),
  },
  bar: {
    label: 'Bar Chart',
    fields: withDimensionShelves([
      {
        key: 'x',
        type: 'select',
        label: 'Category',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
      },
      {
        key: 'groupField',
        type: 'select',
        label: 'Split by',
        required: false,
      },
      {
        key: 'yMetricsSecondary',
        type: 'metric-list',
        label: 'Second measure (line)',
        required: false,
        advanced: true,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ]),
  },
  line: {
    label: 'Line Chart',
    fields: withDimensionShelves([
      {
        key: 'x',
        type: 'select',
        label: 'Category',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
      },
      {
        key: 'groupField',
        type: 'select',
        label: 'Split by',
        required: false,
      },
      {
        key: 'yMetricsSecondary',
        type: 'metric-list',
        label: 'Second measure',
        required: false,
        advanced: true,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ]),
  },
  area: {
    label: 'Area Chart',
    fields: withDimensionShelves([
      {
        key: 'x',
        type: 'select',
        label: 'Category',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
      },
      {
        key: 'groupField',
        type: 'select',
        label: 'Split by',
        required: false,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ]),
  },
  table: {
    label: 'Table',
    fields: withDimensionShelves([
      {
        key: 'x',
        type: 'select',
        label: 'Row grouping',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
      },
      {
        key: 'groupField',
        type: 'select',
        label: 'Split by',
        required: false,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ]),
  },
  scatter: {
    label: 'Scatter Chart',
    fields: [
      {
        key: 'xMetrics',
        type: 'metric-list',
        label: 'Horizontal (X)',
        required: true,
        maxCount: 1,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Vertical (Y)',
        required: true,
        maxCount: 1,
      },
      {
        key: 'legend',
        type: 'select',
        label: 'Color by',
        required: false,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ],
  },
  funnel: {
    label: 'Funnel Chart',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Stages',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
      {
        key: 'metricFilters',
        type: 'metric-filter-list',
        label: 'Keep totals…',
        required: false,
      },
    ],
  },
  heatmap: {
    label: 'Heatmap',
    fields: withDimensionShelves([
      {
        key: 'x',
        type: 'select',
        label: 'Across (columns)',
        required: true,
      },
      {
        key: 'groupField',
        type: 'select',
        label: 'Down (rows)',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Numbers',
        required: true,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ]),
  },
  stat: {
    label: 'KPI / Stat',
    fields: [
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Metric',
        required: true,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ],
  },
  text: {
    label: 'Text Block',
    // Format: fontSize, textAlign, color (ChartSpecificFields). Inline rich-text toolbar while editing.
    fields: [],
  },
  slicer: {
    label: 'Slicer',
    fields: [
      {
        key: 'field',
        type: 'select',
        label: 'Filter field',
        required: true,
      },
    ],
  },
  filter: {
    label: 'Filter',
    fields: [
      {
        key: 'field',
        type: 'select',
        label: 'Filter field',
        required: true,
      },
    ],
  },
  gauge: {
    label: 'Gauge',
    fields: [
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Value',
        required: true,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ],
  },
  treemap: {
    label: 'Treemap',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Category',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Size',
        required: true,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ],
  },
  waterfall: {
    label: 'Waterfall',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Category / Stage',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Value (delta)',
        required: true,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ],
  },
  bullet: {
    label: 'Bullet Chart',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Category',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Actual Value',
        required: true,
        maxCount: 1,
      },
      {
        key: 'yMetricsSecondary',
        type: 'metric-list',
        label: 'Target Value',
        required: false,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ],
  },
  divider: {
    label: 'Section Divider',
    // Format: sectionTitle, uppercase, hideLine, titleSize
    fields: [],
  },
  image: {
    label: 'Image',
    // Format / inline: imageUrl (URL or data URI), altText, objectFit, borderRadius
    fields: [],
  },
  geo: {
    label: 'Geo Map',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Country / Region (names)',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Value',
        required: true,
        maxCount: 1,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ],
  },
  embed: {
    label: 'Embed / iframe',
    // Format: url, frameTitle, allowScrolling, borderRadius
    fields: [],
  },
};

export const CHART_OPTIONS_CONFIG = {
  all: ['showLegend', 'showDataLabel'],
  nonPie: ['showGridline', 'showAxis'],
  secondaryAxis: ['showYAxisLegend'],
  bar: [], // Stacked is now part of chart type, not separate option
};
