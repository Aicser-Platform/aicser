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

/**
 * Build-tab chart type switcher — safe core targets, plus disabled extended types
 * for discoverability (except the widget's current extended type, which stays enabled).
 */
export function buildDashboardChartTypeSwitcherOptions(currentType?: string): DashboardChartTypeOption[] {
  const selectable = dashboardChartTypeSwitchTargets(currentType).map((type) => ({
    type,
    icon: getDashboardChartTypeIcon(type),
    label: chartTypeShortLabel(type),
  }));
  const shown = new Set(selectable.map((o) => o.type));
  const disabledExtended = DASHBOARD_EXTENDED_CHART_TYPES.filter((type) => !shown.has(type)).map(
    (type) => ({
      type,
      icon: getDashboardChartTypeIcon(type),
      label: chartTypeShortLabel(type),
      disabled: true as const,
      disabledReason: EXTENDED_CHART_TYPE_SWITCH_HINT,
    }),
  );
  return [...selectable, ...disabledExtended];
}
