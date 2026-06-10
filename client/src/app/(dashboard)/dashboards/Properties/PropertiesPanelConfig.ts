/**
 * Configuration for chart types and their properties
 * Makes it easy to add new chart types or modify existing ones
 */

export interface ChartTypeConfig {
  label: string;
  fields: ChartFieldConfig[];
  supportsPieSort?: boolean;
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
}

export interface SegmentedOption {
  label: string;
  value: string | boolean;
}

export const METRIC_OPTIONS: SegmentedOption[] = [
  { label: "Don't summarize", value: 'none' },
  { label: 'Count', value: 'count' },
  { label: 'Count (Distinct)', value: 'distinct_count' },
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
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Pie Slice (Field)',
        required: false, // In Power BI you can have just values
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Values',
        required: true,
      },
      {
        key: 'filters',
        type: 'filter-list',
        label: 'Filters',
        required: false,
      },
    ],
    supportsPieSort: true,
  },
  donut: {
    label: 'Donut Chart',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Pie Slice (Field)',
        required: false,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Values',
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
        label: 'Metric Filters',
        required: false,
      },
    ],
    supportsPieSort: true,
  },
  bar: {
    label: 'Bar Chart',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'X-axis',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Y-axis',
        required: true,
      },
      {
        key: 'yMetricsSecondary',
        type: 'metric-list',
        label: 'Secondary y-axis (Line Chart)',
        required: false,
        conditionalRender: (query: any, chartOptions: any) => {
          // Only show secondary axis when chart type is combo-line
          return chartOptions?.barChartType === 'combo-line';
        },
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
        label: 'Metric Filters',
        required: false,
      },
    ],
  },
  line: {
    label: 'Line Chart',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'X-axis',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Y-axis',
        required: true,
      },
      {
        key: 'yMetricsSecondary',
        type: 'metric-list',
        label: 'Secondary y-axis',
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
        label: 'Metric Filters',
        required: false,
      },
    ],
  },
  area: {
    label: 'Area Chart',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'X-axis',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Y-axis',
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
        label: 'Metric Filters',
        required: false,
      },
    ],
  },
  table: {
    label: 'Table',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'Grouping (Row)',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Columns (Metrics)',
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
        label: 'Metric Filters',
        required: false,
      },
    ],
  },
  scatter: {
    label: 'Scatter Chart',
    fields: [
      {
        key: 'xMetrics',
        type: 'metric-list',
        label: 'X-Axis',
        required: true,
        maxCount: 1,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Y-Axis',
        required: true,
        maxCount: 1,
      },
      {
        key: 'legend',
        type: 'select',
        label: 'Legend',
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
        label: 'Metric Filters',
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
        label: 'Values',
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
        label: 'Metric Filters',
        required: false,
      },
    ],
  },
  heatmap: {
    label: 'Heatmap',
    fields: [
      {
        key: 'x',
        type: 'select',
        label: 'X-axis',
        required: true,
      },
      {
        key: 'groupField',
        type: 'select',
        label: 'Y-axis (rows)',
        required: true,
      },
      {
        key: 'yMetrics',
        type: 'metric-list',
        label: 'Values',
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
    fields: [],
  },
  image: {
    label: 'Image',
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
    fields: [],
  },
};

export const CHART_OPTIONS_CONFIG = {
  all: ['showLegend', 'showDataLabel'],
  nonPie: ['showGridline', 'showAxis'],
  secondaryAxis: ['showYAxisLegend'],
  bar: [], // Stacked is now part of chart type, not separate option
};
