import * as echarts from 'echarts';

type ExportType = 'png' | 'svg';

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

// ─── PNG export ─────────────────────────────────────────────────────────────

/**
 * Composes: white background → title text → thin divider → chart image.
 * No widget card chrome (no borders, shadows, or ⋮ button).
 */
const exportPNG = async (chart: echarts.ECharts, title: string, filename: string) => {
  const PIXEL_RATIO  = 2;
  const TITLE_HEIGHT = 48;    // logical px reserved for the title band
  const FONT_SIZE    = 16;
  const PADDING_X    = 16;
  const BG           = '#ffffff';
  const TEXT_COLOR   = '#111827'; // near-black
  const DIVIDER      = '#e5e7eb'; // subtle gray line

  // 1. Get the ECharts chart as a hi-dpi PNG data-URL
  const chartDataUrl = chart.getDataURL({
    type: 'png',
    backgroundColor: BG,
    pixelRatio: PIXEL_RATIO,
  });

  // 2. Load the chart image so we know its pixel dimensions
  const chartImg = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = chartDataUrl;
  });

  const chartW   = chartImg.naturalWidth;              // already hi-dpi
  const chartH   = chartImg.naturalHeight;
  const titleH   = TITLE_HEIGHT * PIXEL_RATIO;        // hi-dpi title band
  const dividerH = 1 * PIXEL_RATIO;                   // 1px logical divider

  // 3. New canvas = title band + 1px divider + chart
  const canvas   = document.createElement('canvas');
  canvas.width   = chartW;
  canvas.height  = titleH + dividerH + chartH;

  const ctx = canvas.getContext('2d')!;

  // 4. White background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 5. Draw title text (scaled for hi-dpi)
  ctx.save();
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
  ctx.fillStyle  = TEXT_COLOR;
  ctx.font       = `600 ${FONT_SIZE}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(title, PADDING_X, TITLE_HEIGHT / 2);
  ctx.restore();

  // 6. Thin divider line
  ctx.fillStyle = DIVIDER;
  ctx.fillRect(0, titleH, chartW, dividerH);

  // 7. Chart below the divider
  ctx.drawImage(chartImg, 0, titleH + dividerH);

  download(canvas.toDataURL('image/png'), `${filename}.png`);
};

// ─── SVG export ─────────────────────────────────────────────────────────────

/**
 * Builds a composite SVG: title band (white rect + text + divider line) then
 * the ECharts SVG body shifted down.  No widget chrome included.
 */
const exportSVG = (chart: echarts.ECharts, title: string, filename: string) => {
  const rawDataUrl = chart.getDataURL({ type: 'svg', backgroundColor: '#ffffff' });

  const prefix = 'data:image/svg+xml;charset=UTF-8,';
  const svgStr = rawDataUrl.startsWith(prefix)
    ? decodeURIComponent(rawDataUrl.slice(prefix.length))
    : atob(rawDataUrl.split(',')[1] ?? '');

  if (!svgStr) throw new Error('Could not decode SVG');

  const TITLE_HEIGHT = 48;
  const PADDING_X    = 16;

  const vbMatch = svgStr.match(/viewBox="([^"]+)"/);
  const wMatch  = svgStr.match(/\bwidth="([^"]+)"/);
  const hMatch  = svgStr.match(/\bheight="([^"]+)"/);

  const origW = wMatch ? parseFloat(wMatch[1]) : 800;
  const origH = hMatch ? parseFloat(hMatch[1]) : 600;
  const [vbX, vbY, vbW, vbH] = vbMatch
    ? vbMatch[1].split(/\s+/).map(Number)
    : [0, 0, origW, origH];

  const escapedTitle = (title || 'Chart')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Title band: background + text + divider
  const titleBanner = `
  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${TITLE_HEIGHT}" fill="#ffffff"/>
  <text
    x="${vbX + PADDING_X}"
    y="${vbY + TITLE_HEIGHT / 2 + 6}"
    font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    font-size="16"
    font-weight="600"
    fill="#111827"
  >${escapedTitle}</text>
  <line
    x1="${vbX}" y1="${vbY + TITLE_HEIGHT}"
    x2="${vbX + vbW}" y2="${vbY + TITLE_HEIGHT}"
    stroke="#e5e7eb" stroke-width="1"
  />`;

  // Strip the outer <svg> wrapper so we can re-wrap with new dimensions
  const innerContent = svgStr
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '');

  const compositeSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${origW}"
     height="${origH + TITLE_HEIGHT}"
     viewBox="${vbX} ${vbY} ${vbW} ${vbH + TITLE_HEIGHT}">
  ${titleBanner}
  <g transform="translate(0, ${TITLE_HEIGHT})">
    ${innerContent}
  </g>
</svg>`;

  const blob = new Blob([compositeSvg], { type: 'image/svg+xml;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  download(url, `${filename}.svg`);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

// ─── public API ─────────────────────────────────────────────────────────────

export const exportChartByWidget = async (
  widgetId: string,
  widgetTitle?: string,
  type: ExportType = 'png'
) => {
  const chart = getChartInstance(widgetId);
  if (!chart) throw new Error('Chart instance not found');

  const filename = sanitizeFilename(widgetTitle!);
  const title    = widgetTitle || 'Chart';

  if (type === 'svg') {
    try {
      exportSVG(chart, title, filename);
    } catch {
      await exportPNG(chart, title, filename);
    }
  } else {
    await exportPNG(chart, title, filename);
  }
};
