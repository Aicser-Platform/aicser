import * as echarts from 'echarts';

/** png: screen (2×) · png-print: print quality (4×, ~300 dpi at typical print sizes) · svg: vector. */
export type ExportType = 'png' | 'png-print' | 'svg';

// ─── helpers ────────────────────────────────────────────────────────────────

const sanitizeFilename = (name: string) =>
  (name || 'chart')
    .trim()
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();

const download = (url: string, filename: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
};

const getChartInstance = (widgetId: string) => {
  const container = document.querySelector(
    `[data-widget-id="${widgetId}"] [_echarts_instance_]`
  ) as HTMLDivElement | null;
  if (!container) return null;
  return echarts.getInstanceByDom(container);
};

// ─── shared layout ─────────────────────────────────────────────────────────

/** Words around the chart, as on the card: description under the title, source under the chart. */
export type ChartExportAnnotations = { description?: string; source?: string };

const FONT = `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const PADDING_X = 16;
const TITLE_BAND = 48; // title alone
const DESCRIPTION_LINE = 20; // extra band when there is a description
const SOURCE_BAND = 28;
const MUTED = '#6b7280';

/** Heights (logical px) of the header and footer bands for these annotations. */
/** Line breaks the author typed read as " · " in the one-line export bands. */
const oneLine = (text?: string) => (text ? text.split(/\s*\n+\s*/).filter(Boolean).join(' · ') : text);

export function exportBands(a: ChartExportAnnotations = {}) {
  const header = TITLE_BAND + (a.description ? DESCRIPTION_LINE : 0);
  const footer = a.source ? SOURCE_BAND : 0;
  return { header, footer };
}

const escapeXml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One line that fits `maxWidth`, ending in "…" when cut. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

// ─── PNG export ─────────────────────────────────────────────────────────────

/**
 * Composes: white background → title (and description) → thin divider → chart → source line.
 * No widget card chrome (no borders, shadows, or ⋮ button).
 */
const exportPNG = async (
  chart: echarts.ECharts,
  title: string,
  filename: string,
  raw: ChartExportAnnotations = {},
  pixelRatio = 2,
) => {
  const annotations = { description: oneLine(raw.description), source: oneLine(raw.source) };
  const PIXEL_RATIO = pixelRatio;
  const BG = '#ffffff';
  const TEXT_COLOR = '#111827'; // near-black
  const DIVIDER = '#e5e7eb'; // subtle gray line
  const { header, footer } = exportBands(annotations);

  const chartDataUrl = chart.getDataURL({ type: 'png', backgroundColor: BG, pixelRatio: PIXEL_RATIO });
  const chartImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = chartDataUrl;
  });

  const chartW = chartImg.naturalWidth; // already hi-dpi
  const chartH = chartImg.naturalHeight;
  const headerH = header * PIXEL_RATIO;
  const dividerH = 1 * PIXEL_RATIO;
  const footerH = footer * PIXEL_RATIO;
  const logicalW = chartW / PIXEL_RATIO;

  const canvas = document.createElement('canvas');
  canvas.width = chartW;
  canvas.height = headerH + dividerH + chartH + footerH;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(fitText(ctx, title, logicalW - PADDING_X * 2), PADDING_X, annotations.description ? 20 : TITLE_BAND / 2);
  if (annotations.description) {
    ctx.fillStyle = MUTED;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText(fitText(ctx, annotations.description, logicalW - PADDING_X * 2), PADDING_X, 44);
  }
  ctx.restore();

  ctx.fillStyle = DIVIDER;
  ctx.fillRect(0, headerH, chartW, dividerH);
  ctx.drawImage(chartImg, 0, headerH + dividerH);

  if (annotations.source) {
    ctx.save();
    ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = MUTED;
    ctx.font = `400 11px ${FONT}`;
    const top = (headerH + dividerH + chartH) / PIXEL_RATIO;
    ctx.fillText(fitText(ctx, annotations.source, logicalW - PADDING_X * 2), PADDING_X, top + SOURCE_BAND / 2);
    ctx.restore();
  }

  download(canvas.toDataURL('image/png'), `${filename}.png`);
};

// ─── SVG export ─────────────────────────────────────────────────────────────

/**
 * Composite SVG: title band (with description) on top, the ECharts SVG body shifted down, and
 * the source line below. No widget chrome included.
 */
export function composeChartSvg(
  svgStr: string,
  title: string,
  raw: ChartExportAnnotations = {},
): string {
  const annotations = { description: oneLine(raw.description), source: oneLine(raw.source) };
  const { header, footer } = exportBands(annotations);
  const vbMatch = svgStr.match(/viewBox="([^"]+)"/);
  const wMatch = svgStr.match(/\bwidth="([^"]+)"/);
  const hMatch = svgStr.match(/\bheight="([^"]+)"/);
  const origW = wMatch ? parseFloat(wMatch[1]) : 800;
  const origH = hMatch ? parseFloat(hMatch[1]) : 600;
  const [vbX, vbY, vbW, vbH] = vbMatch ? vbMatch[1].split(/\s+/).map(Number) : [0, 0, origW, origH];

  const text = (content: string, y: number, size: number, weight: number, fill: string) =>
    `<text x="${vbX + PADDING_X}" y="${y}" font-family='${FONT}' font-size="${size}" font-weight="${weight}" fill="${fill}">${escapeXml(content)}</text>`;

  const titleY = vbY + (annotations.description ? 26 : TITLE_BAND / 2 + 6);
  const band = `
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${header}" fill="#ffffff"/>
  ${text(title || 'Chart', titleY, 16, 600, '#111827')}
  ${annotations.description ? text(annotations.description, vbY + 48, 13, 400, MUTED) : ''}
  <line x1="${vbX}" y1="${vbY + header}" x2="${vbX + vbW}" y2="${vbY + header}" stroke="#e5e7eb" stroke-width="1"/>`;

  const sourceBand = annotations.source
    ? `
  <rect x="${vbX}" y="${vbY + header + vbH}" width="${vbW}" height="${footer}" fill="#ffffff"/>
  ${text(annotations.source, vbY + header + vbH + SOURCE_BAND / 2 + 4, 11, 400, MUTED)}`
    : '';

  // Strip the outer <svg> wrapper so we can re-wrap with new dimensions
  const innerContent = svgStr.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${origW}"
     height="${origH + header + footer}"
     viewBox="${vbX} ${vbY} ${vbW} ${vbH + header + footer}">
  ${band}
  <g transform="translate(0, ${header})">
    ${innerContent}
  </g>${sourceBand}
</svg>`;
}

const exportSVG = (
  chart: echarts.ECharts,
  title: string,
  filename: string,
  annotations: ChartExportAnnotations = {},
) => {
  const svgStr = chartToSvgString(chart);

  const blob = new Blob([composeChartSvg(svgStr, title, annotations)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  download(url, `${filename}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};


/**
 * The chart as real vector SVG. On-screen charts use the canvas renderer, whose
 * getDataURL({type:'svg'}) returns a PNG — so the "SVG" export used to be PNG bytes read as
 * text. Instead the chart's current option is drawn once more by an off-screen SVG-renderer
 * instance of the same size, then disposed.
 */
export function chartToSvgString(chart: echarts.ECharts, backgroundColor = '#ffffff'): string {
  const width = chart.getWidth() || 800;
  const height = chart.getHeight() || 500;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(host);
  const svgChart = echarts.init(host, null, { renderer: 'svg', width, height });
  try {
    const option = chart.getOption() as echarts.EChartsOption;
    svgChart.setOption({ ...option, animation: false, backgroundColor: option.backgroundColor ?? backgroundColor });
    return svgChart.renderToSVGString();
  } finally {
    svgChart.dispose();
    host.remove();
  }
}

/** Save an ECharts instance as png / print-quality png / svg (used outside dashboards too). */
export async function exportChartInstance(
  chart: echarts.ECharts,
  title: string,
  type: ExportType,
  annotations: ChartExportAnnotations = {},
): Promise<void> {
  const filename = sanitizeFilename(title);
  if (type === 'svg') {
    try {
      exportSVG(chart, title || 'Chart', filename, annotations);
      return;
    } catch {
      /* fall through to a print-quality PNG */
    }
  }
  await exportPNG(chart, title || 'Chart', type === 'png' ? filename : `${filename}_print`, annotations,
    type === 'png' ? 2 : 4);
}

// ─── public API ─────────────────────────────────────────────────────────────

export const exportChartByWidget = async (
  widgetId: string,
  widgetTitle?: string,
  type: ExportType = 'png',
  annotations: ChartExportAnnotations = {},
) => {
  const chart = getChartInstance(widgetId);
  if (!chart) throw new Error('Chart instance not found');
  await exportChartInstance(chart, widgetTitle || 'Chart', type, annotations);
};
