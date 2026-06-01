'use client';

import React, { useEffect, useRef } from 'react';

type EmbedEChartsFallbackProps = {
  config: Record<string, unknown>;
  minHeight?: number;
};

/** Lightweight ECharts fallback for embed chat when SharedChartRenderer cannot render. */
export function EmbedEChartsFallback({ config, minHeight = 240 }: EmbedEChartsFallbackProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let instance: { dispose: () => void; setOption: (o: unknown) => void; resize: () => void } | null = null;

    void import('echarts').then((echarts) => {
      if (disposed || !chartRef.current) return;
      instance = echarts.init(chartRef.current);
      instance.setOption(config);
      instance.resize();
    });

    const onResize = () => instance?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      disposed = true;
      window.removeEventListener('resize', onResize);
      instance?.dispose();
    };
  }, [config]);

  return (
    <div
      ref={chartRef}
      style={{ width: '100%', minHeight, marginTop: 8 }}
    />
  );
}
