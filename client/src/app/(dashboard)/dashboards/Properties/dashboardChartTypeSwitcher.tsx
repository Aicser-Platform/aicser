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
};

/**
 * Build-tab chart type switcher — safe switch targets only (core 8, same order as /chat pivot).
 * The extended 7 (heatmap/funnel/gauge/treemap/waterfall/bullet/geo) don't have a working
 * buildFromQueryResult transform, so switching TO them from this row would silently break the
 * widget's data — see SAFE_CHART_TYPE_SWITCH_TARGETS in chartTypeCatalog.ts. If the widget's own
 * current type is one of those 7 (e.g. an AI-authored Geo map), it's appended so its button still
 * appears (and shows active) instead of the row giving no indication of the widget's real type.
 */
export function buildDashboardChartTypeSwitcherOptions(currentType?: string): DashboardChartTypeOption[] {
  return dashboardChartTypeSwitchTargets(currentType).map((type) => ({
    type,
    icon: getDashboardChartTypeIcon(type),
    label: chartTypeShortLabel(type),
  }));
}
