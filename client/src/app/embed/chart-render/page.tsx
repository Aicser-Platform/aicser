'use client';

/**
 * Draws one ECharts option at a time for document exports (Word, PowerPoint, fallback PDF).
 * The server's headless browser opens this page, calls window.__renderChart(option) and
 * screenshots #chart — so exported charts are drawn by the same library, theme and settings as
 * the report page. The page holds no data of its own: it draws only what it is handed.
 */

import React, { Suspense, useEffect, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import * as echarts from 'echarts';

declare global {
  interface Window {
    __renderChart?: (option: Record<string, unknown>) => Promise<boolean>;
  }
}

function ChartRender() {
  const params = useSearchParams();
  const width = Math.min(2400, Math.max(200, Number(params?.get('w')) || 1000));
  const height = Math.min(1600, Math.max(150, Number(params?.get('h')) || 540));
  const dark = params?.get('theme') === 'dark';
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, dark ? 'dark' : undefined, { renderer: 'canvas', width, height });
    window.__renderChart = (option) =>
      new Promise<boolean>((resolve) => {
        try {
          chart.clear();
          chart.setOption({ backgroundColor: dark ? '#141414' : '#ffffff', ...option, animation: false }, true);
          // 'finished' fires once everything is drawn; the timeout covers options that never emit it.
          const done = () => resolve(true);
          chart.off('finished');
          chart.on('finished', done);
          window.setTimeout(done, 1500);
        } catch {
          resolve(false);
        }
      });
    return () => {
      window.__renderChart = undefined;
      chart.dispose();
    };
  }, [width, height, dark]);

  return (
    <div style={{ padding: 20, background: dark ? '#141414' : '#ffffff' }}>
      <div id="chart" ref={ref} style={{ width, height }} />
    </div>
  );
}

export default function ChartRenderPage() {
  return (
    <Suspense fallback={null}>
      <ChartRender />
    </Suspense>
  );
}
