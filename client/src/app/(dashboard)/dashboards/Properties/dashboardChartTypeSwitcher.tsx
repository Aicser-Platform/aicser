'use client';

import React from 'react';
import {
  LineChartOutlined,
  BarChartOutlined,
  PieChartOutlined,
  TableOutlined,
  NumberOutlined,
  AreaChartOutlined,
  DotChartOutlined,
  HeatMapOutlined,
  FunnelPlotOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  FundOutlined,
  AimOutlined,
  GlobalOutlined,
  BranchesOutlined,
  ColumnHeightOutlined,
} from '@ant-design/icons';
import {
  chartTypeShortLabel,
  dashboardChartTypeSwitchTargets,
  DASHBOARD_EXTENDED_CHART_TYPES,
} from '@/components/charts/chartTypeCatalog';

const ICONS: Record<string, React.ReactNode> = {
  bar: <BarChartOutlined />,
  line: <LineChartOutlined />,
  area: <AreaChartOutlined />,
  pie: <PieChartOutlined />,
  donut: <PieChartOutlined />,
  scatter: <DotChartOutlined />,
  table: <TableOutlined />,
  stat: <NumberOutlined />,
  heatmap: <HeatMapOutlined />,
  funnel: <FunnelPlotOutlined />,
  gauge: <DashboardOutlined />,
  treemap: <AppstoreOutlined />,
  waterfall: <FundOutlined />,
  bullet: <AimOutlined />,
  geo: <GlobalOutlined />,
  sankey: <BranchesOutlined rotate={90} />,
  histogram: <ColumnHeightOutlined />,
};

export function getDashboardChartTypeIcon(type: string): React.ReactNode {
  return ICONS[type?.toLowerCase?.() || ''] ?? <BarChartOutlined />;
}

export type DashboardChartTypeOption = {
  type: string;
  icon: React.ReactNode;
  label: string;
  /** When true, switching TO this type is unsafe without remapping (extended visuals). */
  disabled?: boolean;
  disabledReason?: string;
};

export const EXTENDED_CHART_TYPE_SWITCH_HINT =
  'Needs its own data shape — add via Add Block or AI, then map fields. Switching here would blank the chart.';

type QueryShape = {
  x?: unknown;
  yMetrics?: Array<{ field?: string }>;
  groupField?: unknown;
  legend?: unknown;
} | null | undefined;

/**
 * Whether an extended type can draw from the chart's current fields. Most need what a bar
 * needs (a category and a number), so switching to them — and back — keeps working; a map's
 * own settings stay on the chart meanwhile, so returning to Map restores it.
 */
export function extendedTypeFits(type: string, q: QueryShape): boolean {
  const hasNumber = Array.isArray(q?.yMetrics) && q!.yMetrics!.some((m) => m && m.field);
  const hasCategory = Boolean(q?.x);
  switch (type) {
    case 'gauge':
      return hasNumber;
    case 'heatmap':
    case 'sankey':
      // Two categories (from → to, or across × down) and a number.
      return hasNumber && hasCategory && Boolean(q?.groupField || q?.legend);
    case 'histogram':
      // The spread of a number column: the chart's number field is enough.
      return hasNumber;
    case 'geo':
    case 'funnel':
    case 'treemap':
    case 'waterfall':
    case 'bullet':
      return hasNumber && hasCategory;
    default:
      return false;
  }
}

/**
 * Build-tab chart type switcher: the core types, plus every extended type the chart's fields
 * can already draw; the rest stay listed, disabled, with what they need.
 */
export function buildDashboardChartTypeSwitcherOptions(
  currentType?: string,
  chartQuery?: QueryShape,
): DashboardChartTypeOption[] {
  const selectable = dashboardChartTypeSwitchTargets(currentType).map((type) => ({
    type,
    icon: getDashboardChartTypeIcon(type),
    label: chartTypeShortLabel(type),
  }));
  const shown = new Set(selectable.map((o) => o.type));
  const extended = DASHBOARD_EXTENDED_CHART_TYPES.filter((type) => !shown.has(type)).map((type) => {
    const fits = extendedTypeFits(type, chartQuery);
    return {
      type,
      icon: getDashboardChartTypeIcon(type),
      label: chartTypeShortLabel(type),
      ...(fits ? {} : { disabled: true as const, disabledReason: EXTENDED_CHART_TYPE_SWITCH_HINT }),
    };
  });
  return [...selectable, ...extended];
}
