import * as echarts from 'echarts';
import type { ReportSection } from './report';

/** The section's chart (title left out: the section heading names it). */
export function sectionChartOption(section: ReportSection): Record<string, unknown> | null {
  if (!section.chart) return null;
  const option: Record<string, unknown> = { ...section.chart };
  delete option.title;
  return option;
}

export interface ChartImage {
  /** The image as a `data:` URL (Docs and Slides keep pictures inline). */
  dataUrl: string;
  /** Pixel size (twice the drawn size). */
  width: number;
  height: number;
}

/**
 * Draws an ECharts option off screen on white (documents are paper) and returns it as a PNG or JPEG `data:` URL,
 * or null when ECharts can't draw it.
 */
export function renderChartImage(
  option: Record<string, unknown>,
  { width, height, type }: { width: number; height: number; type: 'png' | 'jpeg' }
): ChartImage | null {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
  });
  document.body.append(host);
  const chart = echarts.init(host, null, { renderer: 'canvas', width, height });
  try {
    chart.setOption({ ...option, animation: false, backgroundColor: '#ffffff' });
    const dataUrl = chart.getDataURL({ type, pixelRatio: 2, backgroundColor: '#ffffff' });
    return { dataUrl, width: width * 2, height: height * 2 };
  } catch {
    return null;
  } finally {
    chart.dispose();
    host.remove();
  }
}
