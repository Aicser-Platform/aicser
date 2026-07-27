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
  DASHBOARD_SWITCHABLE_CHART_TYPES,
  chartTypeShortLabel,
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

/** Build-tab chart type switcher — same core order as /chat pivot, plus dashboard extensions. */
export const DASHBOARD_CHART_TYPE_SWITCHER: DashboardChartTypeOption[] =
  DASHBOARD_SWITCHABLE_CHART_TYPES.map((type) => ({
    type,
    icon: getDashboardChartTypeIcon(type),
    label: chartTypeShortLabel(type),
  }));
