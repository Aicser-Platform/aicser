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
 *
 * Animation plays when the chart actually enters the viewport so a lazy-mounted
 * feed tile is not already finished drawing by the time the user scrolls to it.
 */
export const MiniEChart: React.FC<MiniEChartProps> = ({ option, height = '100%', className }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<echarts.ECharts | null>(null);
  const optionRef = useRef(option);
  const hasPlayedRef = useRef(false);
  optionRef.current = option;

  useEffect(() => {
    if (!containerRef.current) return;

    instanceRef.current = echarts.init(containerRef.current, isDark() ? 'dark' : undefined, {
      renderer: 'canvas',
    });
    hasPlayedRef.current = false;

    const paint = (animate: boolean) => {
      instanceRef.current?.setOption(
        {
          ...optionRef.current,
          animation: animate,
          animationDuration: animate ? 900 : 0,
          animationEasing: 'cubicOut',
        } as EChartsOption,
        true,
      );
    };

    const playIfVisible = (entry?: IntersectionObserverEntry) => {
      const visible = entry ? entry.isIntersecting : true;
      if (!visible || hasPlayedRef.current) return;
      hasPlayedRef.current = true;
      instanceRef.current?.clear();
      paint(true);
    };

    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (entry?.isIntersecting) playIfVisible(entry);
        },
        { threshold: [0.15, 0.35], rootMargin: '0px' },
      );
      observer.observe(containerRef.current);
    } else {
      paint(true);
      hasPlayedRef.current = true;
    }

    const handleResize = () => instanceRef.current?.resize();
    window.addEventListener('resize', handleResize);
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      observer?.disconnect();
      instanceRef.current?.dispose();
      instanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasPlayedRef.current) return;
    instanceRef.current?.setOption(
      { ...option, animation: false, animationDuration: 0 } as EChartsOption,
      true,
    );
  }, [option]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height }} />;
};

export default MiniEChart;
