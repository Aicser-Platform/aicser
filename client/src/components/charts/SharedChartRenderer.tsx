'use client';

import React from 'react';
import { WidgetRenderer } from '@/app/(dashboard)/dashboards/widgets/WidgetRenderer';

/** Shared chart renderer for chat, dashboards, and embed — single WidgetRenderer path. */
export type SharedChartRendererProps = {
  chartType: string;
  chartData?: unknown;
  chartOptions?: Record<string, unknown>;
  chartQuery?: Record<string, unknown>;
  isLoading?: boolean;
  error?: string | null;
  dashboardId?: string;
  readOnly?: boolean;
  minHeight?: number;
};

export function SharedChartRenderer({
  chartType,
  chartData,
  chartOptions,
  chartQuery,
  isLoading,
  error,
  dashboardId,
  readOnly = true,
  minHeight = 280,
}: SharedChartRendererProps) {
  return (
    <WidgetRenderer
      type={chartType}
      data={chartData}
      config={chartOptions}
      query={chartQuery}
      isLoading={isLoading}
      error={error}
      readOnly={readOnly}
      dashboardId={dashboardId}
      minHeight={minHeight}
    />
  );
}

export default SharedChartRenderer;
