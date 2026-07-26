'use client';

import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { isDark } from '../../dashboards/widgets/WidgetRendererConfig';

interface MiniEChartProps {
  option: EChartsOption;
  height?: number | string;
  className?: string;
}

/**
 * Lightweight ECharts mount for small, non-interactive preview charts (feed
 * cards, publish-composer preview). Same init/resize/dispose/dark-mode
 * pattern as EChartWidget — the platform's one charting library end to end,
 * not a second one just for these small previews.
 */
export const MiniEChart: React.FC<MiniEChartProps> = ({ option, height = '100%', className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    instanceRef.current = echarts.init(containerRef.current, isDark() ? 'dark' : undefined, {
      renderer: 'canvas',
    });
    instanceRef.current.setOption(option);

    const handleResize = () => instanceRef.current?.resize();
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    instanceRef.current?.setOption(option, true);
  }, [option]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height }} />;
};

export default MiniEChart;
