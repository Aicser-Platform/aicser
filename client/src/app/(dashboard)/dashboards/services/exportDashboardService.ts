const sanitizeFilename = (name: string) =>
  (name || 'dashboard')
    .trim()
    .replace(/[^a-z0-9]/gi, '_')
    .toLowerCase();

const downloadDataUrl = (dataUrl: string, filename: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  link.click();
};

/** Studio chrome that must never appear in dashboard PNG/PDF exports. */
const EXPORT_IGNORE_CLASSES = [
  'dashboard-studio-toolbar',
  'dashboard-tabs-bar',
  'studio-context',
  'studio-context-bar',
  'studio-context-row',
  'studio-sidebar-rail',
  'studio-sidebar-panel',
  'studio-sidebar',
  'studio-panel-collapse-btn',
  'properties-panel',
  'properties-panel-collapse-btn',
  'fullscreen-exit-overlay',
  'studio-multi-select-bar',
  'widget-interaction-hint-wrap',
  'drag-handle-icon',
  'widget-focus-btn',
  'widget-text-floating-actions',
  'text-widget-toolbar',
  'image-widget-replace',
  'add-block-popover-trigger',
  'react-resizable-handle',
  'dashboard-collab-comments-anchor',
  'dashboard-collab-comments-trigger',
  'dashboard-collab-overlay',
  'sidebar-toggle',
  'sidebar-toggle-btn',
  'layout-app-header',
  'app-navigation-sider',
  'mobile-bottom-nav',
  'aiser-watermark-overlay',
  'no-export',
  'no-print',
] as const;

const COLOR_PROPS = [
  'color',
  'background-color',
  'background',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'caret-color',
  'text-decoration-color',
  'column-rule-color',
  'accent-color',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'box-shadow',
  'text-shadow',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'outline',
] as const;

/** Matches modern CSS color functions html2canvas cannot parse. */
const UNSUPPORTED_COLOR_RE =
  /(?:color-mix|oklch|oklab|lab|lch)\(|(?:^|[^\w-])color\s*\(/i;

let canvasColorCtx: CanvasRenderingContext2D | null = null;
let colorProbeEl: HTMLDivElement | null = null;

function getColorProbe(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (canvasColorCtx) return canvasColorCtx;
  try {
    canvasColorCtx = document.createElement('canvas').getContext('2d');
  } catch {
    canvasColorCtx = null;
  }
  return canvasColorCtx;
}

function channelToByte(channel: string): number {
  const c = channel.trim();
  if (c.endsWith('%')) return Math.max(0, Math.min(255, Math.round(parseFloat(c) * 2.55)));
  const n = parseFloat(c);
  if (Number.isNaN(n)) return 0;
  return n <= 1 ? Math.round(n * 255) : Math.round(Math.min(255, n));
}

/** Convert `color(srgb …)` / `color(srgb-linear …)` to rgb/rgba. */
function parseModernCssColor(value: string): string | null {
  const srgb = value.match(
    /color\(\s*srgb(?:-linear)?\s+([^\s\/]+)\s+([^\s\/]+)\s+([^\s\/]+)(?:\s*\/\s*([^\s\)]+))?\s*\)/i,
  );
  if (srgb) {
    const r = channelToByte(srgb[1]!);
    const g = channelToByte(srgb[2]!);
    const b = channelToByte(srgb[3]!);
    const a = srgb[4] !== undefined ? parseFloat(srgb[4]) : 1;
    if (Number.isNaN(a) || a >= 1) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, a))})`;
  }
  return null;
}

/**
 * Resolve any CSS color (including color()/color-mix()/oklch) to rgb/rgba
 * that html2canvas can parse. Never returns a modern color() function.
 */
export function toCanvasSafeColor(cssColor: string, fallback = 'rgba(0,0,0,0)'): string {
  const value = (cssColor || '').trim();
  if (!value || value === 'transparent' || value === 'none') return 'rgba(0,0,0,0)';
  if (!UNSUPPORTED_COLOR_RE.test(value) && !/^color\s*\(/i.test(value)) {
    // Still normalize legacy values; leave hex/rgb/hsl alone
    return value;
  }

  const parsed = parseModernCssColor(value);
  if (parsed) return parsed;

  // Probe via a live element — browsers resolve color-mix/oklch to color(srgb…) or rgb()
  if (typeof document !== 'undefined') {
    try {
      if (!colorProbeEl) {
        colorProbeEl = document.createElement('div');
        colorProbeEl.style.cssText =
          'position:absolute;left:-99999px;top:0;width:1px;height:1px;pointer-events:none;opacity:0;';
        document.body.appendChild(colorProbeEl);
      }
      colorProbeEl.style.color = '';
      colorProbeEl.style.color = value;
      const resolved = window.getComputedStyle(colorProbeEl).color;
      const fromResolved = parseModernCssColor(resolved);
      if (fromResolved) return fromResolved;
      if (resolved && !UNSUPPORTED_COLOR_RE.test(resolved) && !/^color\s*\(/i.test(resolved)) {
        return resolved;
      }
    } catch {
      /* fall through */
    }
  }

  const ctx = getColorProbe();
  if (ctx) {
    try {
      ctx.fillStyle = '#000000';
      ctx.fillStyle = value;
      const normalized = String(ctx.fillStyle);
      if (normalized && !UNSUPPORTED_COLOR_RE.test(normalized) && !/^color\s*\(/i.test(normalized)) {
        return normalized;
      }
    } catch {
      /* fall through */
    }
  }
  return fallback;
}

function isDarkTheme(): boolean {
  const root = document.documentElement;
  return (
    root.getAttribute('data-theme') === 'dark' ||
    root.classList.contains('dark-mode') ||
    root.classList.contains('dark')
  );
}

function sanitizeCloneForHtml2Canvas(clonedRoot: HTMLElement, sourceRoot: HTMLElement) {
  const sourceNodes: Element[] = [sourceRoot, ...Array.from(sourceRoot.querySelectorAll('*'))];
  const cloneNodes: Element[] = [clonedRoot, ...Array.from(clonedRoot.querySelectorAll('*'))];
  const len = Math.min(sourceNodes.length, cloneNodes.length);
  const dark = isDarkTheme();
  const surface = dark ? '#161b22' : '#ffffff';
  const ink = dark ? '#e6edf3' : '#24292f';
  const border = dark ? '#30363d' : '#d0d7de';

  for (let i = 0; i < len; i++) {
    const src = sourceNodes[i];
    const clone = cloneNodes[i];
    if (!(src instanceof HTMLElement) || !(clone instanceof HTMLElement)) continue;

    const computed = window.getComputedStyle(src);
    for (const prop of COLOR_PROPS) {
      const raw = computed.getPropertyValue(prop);
      if (!raw) continue;
      if (!UNSUPPORTED_COLOR_RE.test(raw) && !/^color\s*\(/i.test(raw.trim())) continue;

      // Shadows / shorthands with modern colors → simplify
      if (prop === 'box-shadow' || prop === 'text-shadow') {
        clone.style.setProperty(prop, 'none', 'important');
        continue;
      }
      if (prop.startsWith('border') || prop === 'outline') {
        // Keep width/style; force a safe border color
        if (prop === 'border' || prop.startsWith('border-')) {
          clone.style.setProperty('border-color', border, 'important');
        }
        if (prop === 'outline') {
          clone.style.setProperty('outline-color', border, 'important');
        }
        continue;
      }
      if (prop === 'background' || prop === 'background-color') {
        clone.style.setProperty('background-color', toCanvasSafeColor(raw, surface), 'important');
        clone.style.setProperty('background-image', 'none', 'important');
        continue;
      }
      if (prop === 'color') {
        clone.style.setProperty('color', toCanvasSafeColor(raw, ink), 'important');
        continue;
      }
      clone.style.setProperty(prop, toCanvasSafeColor(raw, border), 'important');
    }

    const bgImage = computed.backgroundImage;
    if (bgImage && bgImage !== 'none' && UNSUPPORTED_COLOR_RE.test(bgImage)) {
      clone.style.setProperty('background-image', 'none', 'important');
    }
  }

  // Also walk clone computed styles (post-mutation) and scrub anything still modern
  const cloneWin = clonedRoot.ownerDocument?.defaultView;
  if (cloneWin) {
    const all = [clonedRoot, ...Array.from(clonedRoot.querySelectorAll('*'))];
    all.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      const cs = cloneWin.getComputedStyle(node);
      for (const prop of ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'fill', 'stroke'] as const) {
        const raw = cs.getPropertyValue(prop);
        if (raw && (UNSUPPORTED_COLOR_RE.test(raw) || /^color\s*\(/i.test(raw.trim()))) {
          const fb = prop === 'color' || prop === 'fill' || prop === 'stroke' ? ink : prop.includes('border') ? border : surface;
          node.style.setProperty(prop, toCanvasSafeColor(raw, fb), 'important');
        }
      }
      if (UNSUPPORTED_COLOR_RE.test(cs.boxShadow || '')) {
        node.style.setProperty('box-shadow', 'none', 'important');
      }
    });
  }

  // Prevent titles / narrative from being clipped — do NOT change grid item heights
  // (changing RGL heights shifts absolute-positioned siblings and creates blank pages).
  clonedRoot.querySelectorAll<HTMLElement>(
    [
      '.widget-card-title',
      '.widget-card-subtitle',
      '.widget-card-header-titles',
      '.text-widget-wrapper',
      '.text-widget-editor',
      '.text-widget-heading',
      '.studio-stat-label',
      '.studio-stat-value',
      '.studio-stat-root',
    ].join(', '),
  ).forEach((el) => {
    el.style.setProperty('overflow', 'visible', 'important');
    el.style.setProperty('text-overflow', 'clip', 'important');
    el.style.setProperty('white-space', 'normal', 'important');
    el.style.setProperty('-webkit-line-clamp', 'unset', 'important');
  });
  clonedRoot.querySelectorAll<HTMLElement>(
    '.widget-card.widget-type-text, .widget-card.widget-type-stat .widget-card-body',
  ).forEach((el) => {
    el.style.setProperty('overflow', 'visible', 'important');
  });
  clonedRoot.querySelectorAll<HTMLElement>(
    '.text-widget-toolbar, .ant-divider, .ant-divider-vertical, .drag-handle-icon, .widget-text-floating-actions, .image-widget-replace',
  ).forEach((el) => {
    el.style.setProperty('display', 'none', 'important');
  });
  clonedRoot.querySelectorAll<HTMLElement>('.widget-card.widget-type-text').forEach((el) => {
    el.style.setProperty('border', 'none', 'important');
    el.style.setProperty('border-top', 'none', 'important');
    el.style.setProperty('border-bottom', 'none', 'important');
    el.style.setProperty('box-shadow', 'none', 'important');
    el.style.setProperty('background', 'transparent', 'important');
  });
}

function shouldIgnoreExportElement(el: Element): boolean {
  if (!(el instanceof HTMLElement) || !el.classList) return false;
  if (el.classList.contains('aiser-watermark-overlay')) return true;
  if (el.classList.contains('ant-divider') || el.classList.contains('ant-divider-vertical')) return true;
  if (el.classList.contains('text-widget-toolbar')) return true;
  return EXPORT_IGNORE_CLASSES.some((name) => el.classList.contains(name));
}

/**
 * Content bbox for capture. Prefer layout box + grid-item bottoms (RGL uses transforms,
 * so clientHeight alone often under-reports and html2canvas crops mid-widget).
 */
function measureDashboardContentBox(root: HTMLElement): { width: number; height: number } {
  const layout = root.querySelector('.react-grid-layout, .layout') as HTMLElement | null;
  const rootRect = root.getBoundingClientRect();
  const zoom = readCssZoom(root);

  let maxBottom = 0;
  let maxRight = 0;
  root.querySelectorAll<HTMLElement>('.react-grid-item').forEach((el) => {
    // offsetTop/Height ignore CSS zoom & are relative to offsetParent; prefer un-zoomed
    // getBoundingClientRect divided by zoom so capture pixels match layout space.
    const r = el.getBoundingClientRect();
    const bottom = (r.bottom - rootRect.top) / zoom + root.scrollTop;
    const right = (r.right - rootRect.left) / zoom + root.scrollLeft;
    maxBottom = Math.max(maxBottom, bottom);
    maxRight = Math.max(maxRight, right);
  });

  const layoutH = Math.max(
    layout?.offsetHeight || 0,
    layout?.scrollHeight || 0,
    parseFloat(layout?.style.height || '') || 0,
  );
  const layoutW = Math.max(layout?.offsetWidth || 0, layout?.scrollWidth || 0, root.clientWidth || 0);

  const width = Math.ceil(Math.max(maxRight + 12, layoutW, root.scrollWidth || 0, 960));
  const height = Math.ceil(Math.max(maxBottom + 24, layoutH + 8, root.scrollHeight || 0, 480));
  return { width, height };
}

function readCssZoom(el: HTMLElement): number {
  let node: HTMLElement | null = el;
  while (node) {
    const z = (node.style as CSSStyleDeclaration & { zoom?: string }).zoom;
    if (z && z !== 'normal') {
      const n = parseFloat(z);
      if (!Number.isNaN(n) && n > 0) return n > 2 ? n / 100 : n;
    }
    node = node.parentElement;
  }
  return 1;
}

type StyleSnapshot = { el: HTMLElement; props: Array<[string, string]> };

function pushImportant(el: HTMLElement, prop: string, value: string, bag: StyleSnapshot['props']) {
  bag.push([prop, el.style.getPropertyValue(prop)]);
  el.style.setProperty(prop, value, 'important');
}

/** Expand scroll/clip ancestors so html2canvas sees the full grid, not the viewport slice. */
function prepareExportLayout(root: HTMLElement): () => void {
  const snapshots: StyleSnapshot[] = [];
  const touch = (el: HTMLElement | null, props: Record<string, string>) => {
    if (!el) return;
    const bag: StyleSnapshot['props'] = [];
    Object.entries(props).forEach(([k, v]) => pushImportant(el, k, v, bag));
    snapshots.push({ el, props: bag });
  };

  // Reset canvas zoom for accurate pixel capture
  touch(root, { zoom: '1' });

  let node: HTMLElement | null = root;
  while (node && node !== document.body) {
    if (
      node.classList.contains('studio-canvas-scroll') ||
      node.classList.contains('studio-canvas-area') ||
      node.classList.contains('dashboard-workspace') ||
      node.classList.contains('dashboard-workspace-main') ||
      node.classList.contains('studio-body') ||
      node.classList.contains('studio-wrapper')
    ) {
      touch(node, {
        overflow: 'visible',
        overflowX: 'visible',
        overflowY: 'visible',
        height: 'auto',
        maxHeight: 'none',
        minHeight: '0',
      });
    }
    node = node.parentElement;
  }

  const scrollParent = root.closest('.studio-canvas-scroll') as HTMLElement | null;
  const prevScrollTop = scrollParent?.scrollTop ?? 0;
  const prevScrollLeft = scrollParent?.scrollLeft ?? 0;
  if (scrollParent) {
    scrollParent.scrollTop = 0;
    scrollParent.scrollLeft = 0;
  }
  root.scrollTop = 0;
  root.scrollLeft = 0;

  return () => {
    if (scrollParent) {
      scrollParent.scrollTop = prevScrollTop;
      scrollParent.scrollLeft = prevScrollLeft;
    }
    for (let i = snapshots.length - 1; i >= 0; i--) {
      const { el, props } = snapshots[i];
      props.forEach(([prop, prev]) => {
        if (prev) el.style.setProperty(prop, prev);
        else el.style.removeProperty(prop);
      });
    }
  };
}

function wrapCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const words = (text || 'Dashboard').trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : ['Dashboard'];
}

async function loadLogoImage(): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = '/aiser-logo.png';
  });
}

/**
 * Compose industry-style export: title header + dashboard capture + optional Powered-by footer.
 * Page chrome uses the same background as the board (full-bleed light or dark — no white frame
 * around a dark dashboard).
 */
async function composeBrandedExportCanvas(
  capture: HTMLCanvasElement,
  opts: {
    title: string;
    subtitle?: string;
    branding: boolean;
    dark: boolean;
    backgroundColor: string;
  },
): Promise<{ canvas: HTMLCanvasElement; captureOriginY: number; captureOriginX: number }> {
  // Compact same-color inset (industry report density)
  const pageMargin = Math.max(16, Math.round(capture.width * 0.012));
  const contentW = capture.width;
  const padX = Math.round(contentW * 0.012);
  const titleFontSize = Math.max(22, Math.round(contentW * 0.022));
  const subtitleFontSize = Math.max(14, Math.round(contentW * 0.013));
  const lineHeight = Math.round(titleFontSize * 1.35);
  const subtitleLineHeight = Math.round(subtitleFontSize * 1.4);
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) {
    return { canvas: capture, captureOriginY: 0, captureOriginX: 0 };
  }

  const textMaxW = contentW - padX * 2 - 48;
  measure.font = `600 ${titleFontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const titleLines = wrapCanvasText(measure, opts.title || 'Dashboard', textMaxW);
  const subtitle = (opts.subtitle || '').trim();
  measure.font = `400 ${subtitleFontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const subtitleLines = subtitle ? wrapCanvasText(measure, subtitle, textMaxW) : [];
  const subtitleBlockH = subtitleLines.length
    ? Math.round(subtitleFontSize * 0.35) + subtitleLines.length * subtitleLineHeight
    : 0;
  const headerH =
    Math.round(padX * 0.6) +
    titleLines.length * lineHeight +
    subtitleBlockH +
    Math.round(padX * 0.5);
  const footerH = opts.branding ? Math.round(padX * 1.1) : Math.round(padX * 0.45);

  const out = document.createElement('canvas');
  out.width = contentW + pageMargin * 2;
  out.height = capture.height + headerH + footerH + pageMargin * 2;
  const ctx = out.getContext('2d');
  if (!ctx) {
    return { canvas: capture, captureOriginY: 0, captureOriginX: 0 };
  }

  ctx.fillStyle = opts.backgroundColor;
  ctx.fillRect(0, 0, out.width, out.height);

  const originX = pageMargin;
  const originY = pageMargin;
  const logo = await loadLogoImage();
  const logoSize = Math.round(titleFontSize * 1.35);
  let titleLeft = originX + padX;
  if (logo) {
    ctx.globalAlpha = opts.dark ? 0.9 : 1;
    ctx.drawImage(
      logo,
      originX + padX,
      originY + Math.round((headerH - logoSize) / 2) - 2,
      logoSize,
      logoSize,
    );
    ctx.globalAlpha = 1;
    titleLeft = originX + padX + logoSize + Math.round(padX * 0.35);
  }

  const textBlockH = titleLines.length * lineHeight + subtitleBlockH;
  const titleTop = originY + Math.round((headerH - textBlockH) / 2);
  ctx.fillStyle = opts.dark ? '#e6edf3' : '#1f2328';
  ctx.font = `600 ${titleFontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'top';
  titleLines.forEach((line, i) => {
    ctx.fillText(line, titleLeft, titleTop + i * lineHeight, originX + contentW - titleLeft - padX);
  });

  if (subtitleLines.length) {
    const subTop = titleTop + titleLines.length * lineHeight + Math.round(subtitleFontSize * 0.35);
    ctx.fillStyle = opts.dark ? 'rgba(230,237,243,0.72)' : 'rgba(36,41,47,0.62)';
    ctx.font = `400 ${subtitleFontSize}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    subtitleLines.forEach((line, i) => {
      ctx.fillText(line, titleLeft, subTop + i * subtitleLineHeight, originX + contentW - titleLeft - padX);
    });
  }

  ctx.strokeStyle = opts.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.moveTo(originX + padX, originY + headerH - 1);
  ctx.lineTo(originX + contentW - padX, originY + headerH - 1);
  ctx.stroke();

  const captureOriginY = originY + headerH;
  ctx.drawImage(capture, originX, captureOriginY);

  if (opts.branding) {
    const footerTop = captureOriginY + capture.height;
    ctx.strokeStyle = opts.dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    ctx.beginPath();
    ctx.moveTo(originX + padX, footerTop + 1);
    ctx.lineTo(originX + contentW - padX, footerTop + 1);
    ctx.stroke();

    const footFont = Math.max(14, Math.round(contentW * 0.012));
    const footLogo = Math.round(footFont * 1.4);
    const label = 'Powered by Aicser';
    ctx.font = `500 ${footFont}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    const textW = ctx.measureText(label).width;
    const blockW = (logo ? footLogo + 8 : 0) + textW;
    let x = originX + Math.round((contentW - blockW) / 2);
    const y = footerTop + Math.round((footerH - footLogo) / 2);

    if (logo) {
      ctx.globalAlpha = 0.55;
      ctx.drawImage(logo, x, y, footLogo, footLogo);
      ctx.globalAlpha = 1;
      x += footLogo + 8;
    }
    ctx.fillStyle = opts.dark ? 'rgba(230,237,243,0.65)' : 'rgba(36,41,47,0.55)';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y + footLogo / 2);
  }

  return { canvas: out, captureOriginY, captureOriginX: originX };
}

type WidgetBand = { top: number; bottom: number };

/** Page slices that pack content densely and avoid cutting through widgets. */
function buildWidgetAwareSlices(
  totalHeight: number,
  maxSliceHeight: number,
  bands: WidgetBand[],
): Array<{ y: number; h: number }> {
  if (totalHeight <= 0) return [];
  if (maxSliceHeight <= 0 || totalHeight <= maxSliceHeight + 2) {
    return [{ y: 0, h: totalHeight }];
  }

  const sorted = [...bands]
    .filter((b) => b.bottom > b.top + 1)
    .sort((a, b) => a.top - b.top || a.bottom - b.bottom);

  const slices: Array<{ y: number; h: number }> = [];
  let y = 0;
  // Require a mostly-full page before allowing a soft break (industry: pack dense)
  const minKeep = Math.max(80, maxSliceHeight * 0.55);
  let guard = 0;

  while (y < totalHeight - 1 && guard < 60) {
    guard += 1;
    const limit = Math.min(y + maxSliceHeight, totalHeight);
    if (limit >= totalHeight - 1) {
      slices.push({ y, h: totalHeight - y });
      break;
    }

    // Prefer the *latest* gap that still fits — maximizes widgets per page
    let breakAt = limit;
    let latestGap: number | null = null;
    for (let i = 0; i < sorted.length - 1; i++) {
      const gapStart = sorted[i]!.bottom + 2;
      if (gapStart <= y + minKeep) continue;
      if (gapStart > limit) continue;
      latestGap = gapStart;
    }
    if (latestGap != null) {
      breakAt = latestGap;
    } else {
      // No gap: if a widget straddles the limit, break before it when the page stays useful
      for (const band of sorted) {
        if (band.bottom <= y || band.top >= limit) continue;
        if (band.top < limit && band.bottom > limit) {
          if (band.top - y >= minKeep) {
            breakAt = Math.max(band.top - 2, y + minKeep);
          }
          break;
        }
      }
    }

    breakAt = Math.min(Math.max(breakAt, y + 48), limit, totalHeight);
    const h = breakAt - y;
    if (h < 32) {
      const forced = Math.min(maxSliceHeight, totalHeight - y);
      slices.push({ y, h: forced });
      y += forced;
      continue;
    }
    slices.push({ y, h });
    y = breakAt;
  }

  // Drop a tiny trailing leftover page by merging into previous when it still fits
  if (slices.length >= 2) {
    const last = slices[slices.length - 1]!;
    const prev = slices[slices.length - 2]!;
    if (last.h < maxSliceHeight * 0.18 && prev.h + last.h <= maxSliceHeight * 1.02) {
      prev.h += last.h;
      slices.pop();
    }
  }

  return slices;
}

function sliceCanvas(
  source: HTMLCanvasElement,
  y: number,
  h: number,
  backgroundColor: string,
): HTMLCanvasElement {
  const slice = document.createElement('canvas');
  slice.width = source.width;
  slice.height = Math.max(1, Math.ceil(h));
  const ctx = slice.getContext('2d');
  if (ctx) {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, slice.width, slice.height);
    ctx.drawImage(source, 0, y, source.width, h, 0, 0, source.width, h);
  }
  return slice;
}

export type ExportOptions = {
  filename?: string;
  /**
   * CSS selector for the region to capture.
   * Default: dashboard grid only (`.dashboard-container`) — never studio chrome.
   */
  selector?: string;
  /**
   * When true (default), the sheet matches the active light/dark UI theme.
   * Set false only to force a light sheet.
   */
  matchTheme?: boolean;
  /** Dashboard title drawn above the capture (full text, wraps — not truncated). */
  title?: string;
  /** Optional dashboard subtitle / description under the title. */
  subtitle?: string;
  /**
   * Free-tier / watermark plans: append centered "Powered by Aicser" footer.
   * Paid plans: title + logo header only.
   */
  branding?: boolean;
};

function waitFrames(n = 2): Promise<void> {
  return new Promise((resolve) => {
    const step = (left: number) => {
      if (left <= 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });
}

/**
 * Render a branded dashboard canvas (theme-matched by default).
 * Shared by PNG/PDF export and print-to-image.
 * Does not mutate widget heights (that shifts RGL absolute layout).
 */
async function renderDashboardExportCanvas(opts: ExportOptions = {}): Promise<{
  canvas: HTMLCanvasElement;
  dark: boolean;
  backgroundColor: string;
  title: string;
  widgetBands: WidgetBand[];
}> {
  const selector = opts.selector ?? '.dashboard-container';
  const root = document.querySelector(selector) as HTMLElement | null;
  if (!root) {
    throw new Error('Dashboard canvas not found');
  }

  const html2canvasMod = await import('html2canvas');
  const html2canvas = html2canvasMod.default ?? html2canvasMod;
  if (typeof html2canvas !== 'function') {
    throw new Error('html2canvas not loaded');
  }

  const matchTheme = opts.matchTheme !== false;
  const dark = matchTheme ? isDarkTheme() : false;
  const themeClass = dark ? 'dashboard-export-dark' : 'dashboard-export-light';
  const backgroundColor = dark ? '#0d1117' : '#ffffff';
  const title = (opts.title || opts.filename || 'Dashboard').trim() || 'Dashboard';
  const subtitle = (opts.subtitle || '').trim() || undefined;
  const branding = opts.branding === true;

  let restoreTheme: (() => void) | null = null;
  if (!matchTheme && isDarkTheme()) {
    const html = document.documentElement;
    const prevTheme = html.getAttribute('data-theme');
    const hadDark = html.classList.contains('dark');
    const hadDarkMode = html.classList.contains('dark-mode');
    html.setAttribute('data-theme', 'light');
    html.classList.remove('dark', 'dark-mode');
    restoreTheme = () => {
      if (prevTheme) html.setAttribute('data-theme', prevTheme);
      else html.removeAttribute('data-theme');
      if (hadDark) html.classList.add('dark');
      if (hadDarkMode) html.classList.add('dark-mode');
    };
    await waitFrames(3);
    await new Promise((r) => setTimeout(r, 350));
  }

  root.classList.add(themeClass);
  const restoreLayout = prepareExportLayout(root);
  const layoutEl = root.querySelector('.layout, .react-grid-layout') as HTMLElement | null;
  const prevLayoutMinHeight = layoutEl?.style.minHeight ?? '';
  const prevLayoutHeight = layoutEl?.style.height ?? '';
  const prevRootHeight = root.style.height;
  const prevRootOverflow = root.style.overflow;
  const prevRootMaxHeight = root.style.maxHeight;
  const prevRootMinHeight = root.style.minHeight;
  const prevRootWidth = root.style.width;

  await waitFrames(2);
  let box = measureDashboardContentBox(root);
  const layoutW = Math.max(
    layoutEl?.scrollWidth || 0,
    layoutEl?.offsetWidth || 0,
    root.scrollWidth || 0,
    box.width,
  );
  box = { width: layoutW, height: box.height };

  if (layoutEl) {
    layoutEl.style.minHeight = '0';
    layoutEl.style.height = `${box.height}px`;
  }
  root.style.width = `${box.width}px`;
  root.style.height = `${box.height}px`;
  root.style.minHeight = `${box.height}px`;
  root.style.maxHeight = 'none';
  root.style.overflow = 'visible';
  root.style.backgroundColor = backgroundColor;

  const rootRect = root.getBoundingClientRect();
  const zoom = readCssZoom(root) || 1;
  const cssBands: WidgetBand[] = [];
  root.querySelectorAll<HTMLElement>('.react-grid-item').forEach((el) => {
    const r = el.getBoundingClientRect();
    cssBands.push({
      top: (r.top - rootRect.top) / zoom + root.scrollTop,
      bottom: (r.bottom - rootRect.top) / zoom + root.scrollTop,
    });
  });

  try {
    const captureScale = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 2 : 2);
    const html2canvasOpts = {
      backgroundColor,
      scale: captureScale,
      useCORS: true,
      logging: false,
      width: box.width,
      height: box.height,
      x: 0,
      y: 0,
      scrollX: -window.scrollX,
      scrollY: -window.scrollY,
      ignoreElements: shouldIgnoreExportElement,
      onclone: (_clonedDoc: Document, clonedElement: HTMLElement) => {
        if (!(clonedElement instanceof HTMLElement)) return;
        sanitizeCloneForHtml2Canvas(clonedElement, root);
        clonedElement.style.width = `${box.width}px`;
        clonedElement.style.height = `${box.height}px`;
        clonedElement.style.minHeight = `${box.height}px`;
        clonedElement.style.maxHeight = 'none';
        clonedElement.style.overflow = 'visible';
        clonedElement.style.zoom = '1';
        clonedElement.style.backgroundColor = backgroundColor;
        clonedElement.querySelectorAll<HTMLElement>('.layout, .react-grid-layout').forEach((el) => {
          el.style.minHeight = '0';
          el.style.height = `${box.height}px`;
          el.style.overflow = 'visible';
          el.style.width = `${box.width}px`;
        });
        clonedElement.querySelectorAll<HTMLElement>('.aiser-watermark-overlay').forEach((el) => {
          el.style.setProperty('display', 'none', 'important');
        });
      },
    };

    let capture: HTMLCanvasElement;
    try {
      capture = await html2canvas(root, html2canvasOpts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unsupported color function|color\(/i.test(msg)) {
        // Last resort: foreignObjectRendering uses the browser compositor (no CSS color parser)
        capture = await html2canvas(root, { ...html2canvasOpts, foreignObjectRendering: true });
      } else {
        throw err;
      }
    }

    const composed = await composeBrandedExportCanvas(capture, {
      title,
      subtitle,
      branding,
      dark,
      backgroundColor,
    });

    const pxPerCss = capture.width / Math.max(box.width, 1);
    const widgetBands = cssBands.map((b) => ({
      top: composed.captureOriginY + b.top * pxPerCss,
      bottom: composed.captureOriginY + b.bottom * pxPerCss,
    }));

    return {
      canvas: composed.canvas,
      dark,
      backgroundColor,
      title,
      widgetBands,
    };
  } finally {
    if (layoutEl) {
      layoutEl.style.minHeight = prevLayoutMinHeight;
      layoutEl.style.height = prevLayoutHeight;
    }
    root.style.height = prevRootHeight;
    root.style.maxHeight = prevRootMaxHeight;
    root.style.minHeight = prevRootMinHeight;
    root.style.width = prevRootWidth;
    root.style.overflow = prevRootOverflow;
    root.style.removeProperty('background-color');
    root.classList.remove(themeClass);
    restoreLayout();
    restoreTheme?.();
  }
}

/**
 * Capture the dashboard grid as PNG or PDF (client-side).
 * Respects the active light/dark theme by default (full-bleed sheet color).
 */
export async function exportDashboardCanvas(format: 'png' | 'pdf', opts: ExportOptions = {}) {
  const { canvas, dark, backgroundColor, title, widgetBands } = await renderDashboardExportCanvas({
    ...opts,
    matchTheme: opts.matchTheme !== false,
  });
  const filename = sanitizeFilename(opts.filename ?? title);

  if (format === 'png') {
    downloadDataUrl(canvas.toDataURL('image/png'), `${filename}.png`);
    return;
  }

  const jsPDFMod = await import('jspdf');
  const jsPDF = jsPDFMod.default ?? jsPDFMod;
  const orientation = canvas.width >= canvas.height * 0.85 ? 'landscape' : 'portrait';
  const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  // Industry-tight margins (~0.4")
  const margin = 6;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const scale = maxW / canvas.width;
  const drawW = maxW;
  const maxSlicePx = maxH / scale;
  const fill = dark ? { r: 13, g: 17, b: 23 } : { r: 255, g: 255, b: 255 };
  const slices = buildWidgetAwareSlices(canvas.height, maxSlicePx, widgetBands);

  slices.forEach((slice, pageIndex) => {
    if (pageIndex > 0) pdf.addPage();
    pdf.setFillColor(fill.r, fill.g, fill.b);
    pdf.rect(0, 0, pageW, pageH, 'F');
    const piece = sliceCanvas(canvas, slice.y, slice.h, backgroundColor);
    pdf.addImage(piece.toDataURL('image/png'), 'PNG', margin, margin, drawW, slice.h * scale);
  });
  pdf.save(`${filename}.pdf`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Print via full-board image slices (widget-aware, densely packed pages).
 */
export async function printDashboardOnly(opts: {
  title?: string;
  subtitle?: string;
  branding?: boolean;
  matchTheme?: boolean;
} = {}) {
  const title = (opts.title || 'Dashboard').trim() || 'Dashboard';
  const { canvas, backgroundColor, widgetBands } = await renderDashboardExportCanvas({
    title,
    subtitle: opts.subtitle,
    branding: opts.branding === true,
    matchTheme: opts.matchTheme !== false,
  });

  const targetW = Math.floor((297 - 12) * (96 / 25.4));
  const scale = targetW / canvas.width;
  const maxSlicePx = Math.floor(((210 - 12) * (96 / 25.4)) / scale);
  const slices = buildWidgetAwareSlices(canvas.height, maxSlicePx, widgetBands);

  const pagesHtml = slices
    .map((slice, i) => {
      const piece = sliceCanvas(canvas, slice.y, slice.h, backgroundColor);
      return `<div class="sheet${i < slices.length - 1 ? ' break' : ''}"><img src="${piece.toDataURL('image/png')}" alt=""/></div>`;
    })
    .join('');

  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    throw new Error('Unable to open print frame');
  }

  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title>
<style>
  @page { size: landscape; margin: 6mm; }
  html, body {
    margin: 0;
    padding: 0;
    background: ${backgroundColor};
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sheet { width: 100%; }
  .sheet.break { page-break-after: always; break-after: page; }
  img { display: block; width: 100%; height: auto; }
</style></head><body>${pagesHtml}</body></html>`);
  doc.close();

  await new Promise<void>((resolve) => {
    const imgs = Array.from(doc.images);
    if (!imgs.length) {
      resolve();
      return;
    }
    let left = imgs.length;
    const done = () => {
      left -= 1;
      if (left <= 0) resolve();
    };
    imgs.forEach((img) => {
      if (img.complete) done();
      else {
        img.onload = done;
        img.onerror = done;
      }
    });
  });

  const win = iframe.contentWindow;
  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 500);
  };
  if (win) {
    win.addEventListener('afterprint', cleanup);
    win.focus();
    win.print();
    window.setTimeout(cleanup, 60_000);
  } else {
    cleanup();
  }
}
