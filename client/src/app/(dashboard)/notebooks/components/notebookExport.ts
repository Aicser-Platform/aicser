/**
 * A notebook as a standalone report: HTML to share, or PDF through the browser's print dialog.
 * With code it reads like a notebook; without it, like a report of the text, tables and charts.
 */
import type { NotebookCell } from '@/services/notebookService';

export type ExportOptions = {
  title: string;
  includeCode: boolean;
  /** Chart images captured from the page, by cell id, in the report's light and dark palettes. */
  charts: Record<string, { light: string; dark?: string }>;
  /** Pivot tables as plain grids, by cell id. */
  pivots?: Record<string, { columns: string[]; rows: unknown[][] }>;
  /** Figures from Python cells in this session, by cell id. */
  images: Record<string, string[]>;
  labels: { exportedOn: string; rowsShown: (shown: number, total: number) => string };
};

const MAX_ROWS = 200;

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cellValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 6 });
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function markdownHtml(source: string): Promise<string> {
  const [{ renderToStaticMarkup }, { default: ReactMarkdown }, { default: remarkGfm }, React] = await Promise.all([
    import('react-dom/server'),
    import('react-markdown'),
    import('remark-gfm'),
    import('react'),
  ]);
  // react-markdown escapes raw HTML by default, so notebook text can't inject markup here.
  return renderToStaticMarkup(React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, source));
}

function tableHtml(columns: string[], rows: unknown[][], total: number | undefined, label: ExportOptions['labels']['rowsShown']): string {
  const shown = rows.slice(0, MAX_ROWS);
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = shown.map((r) => `<tr>${columns.map((_, i) => `<td>${esc(cellValue(r[i]))}</td>`).join('')}</tr>`).join('');
  return `<div class="table"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
    + (label(shown.length, total ?? rows.length) ? `<p class="meta">${esc(label(shown.length, total ?? rows.length))}</p>` : '');
}

const STYLE = `
  :root {
    color-scheme: light;
    --bg: #ffffff; --ink: #1b2430; --ink-2: #33404d; --muted: #66717d; --line: #e3e7ec; --line-2: #edf0f3;
    --code-bg: #f5f7f9; --th-bg: #f7f9fb; --th-ink: #4a5561; --error: #b42318; --figure-bg: #ffffff;
  }
  /* Follows the reader's system setting; printing (and PDF) always uses the light palette. */
  @media screen and (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #141a21; --ink: #e3e9ee; --ink-2: #c7d0d8; --muted: #95a1ac; --line: #2c343d; --line-2: #232a32;
      --code-bg: #1b222b; --th-bg: #1b222b; --th-ink: #b5c0ca; --error: #ff8a80; --figure-bg: #ffffff;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans", sans-serif; color: var(--ink); background: var(--bg); }
  main { max-width: 920px; margin: 0 auto; padding: 40px 24px 64px; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 16px; margin-bottom: 24px; }
  h1.title { font-size: 28px; line-height: 1.25; margin: 0 0 4px; text-wrap: balance; }
  a { color: inherit; }
  .exported { color: var(--muted); font-size: 12px; }
  section { margin: 0 0 20px; break-inside: avoid-page; }
  .md > :first-child { margin-top: 0; }
  .md table { border-collapse: collapse; }
  .md th, .md td { border: 1px solid var(--line); padding: 4px 8px; }
  .md code { background: var(--code-bg); padding: 1px 4px; border-radius: 4px; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  .code { background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
  .code .lang { display: block; color: var(--muted); font: 600 11px/1 system-ui, sans-serif; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 6px; }
  .out { margin-top: 8px; }
  .out pre { color: var(--ink-2); }
  .error pre { color: var(--error); }
  .table { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; }
  table { border-collapse: collapse; width: 100%; font-size: 12.5px; font-variant-numeric: tabular-nums; }
  th { text-align: left; font-weight: 600; color: var(--th-ink); background: var(--th-bg); }
  th, td { padding: 6px 10px; border-bottom: 1px solid var(--line-2); white-space: nowrap; }
  tr:last-child td { border-bottom: 0; }
  .meta { color: var(--muted); font-size: 12px; margin: 6px 0 0; }
  img { max-width: 100%; height: auto; display: block; border-radius: 6px; }
  /* Python figures are drawn on white; they sit on a white card in either theme. */
  .figure { background: var(--figure-bg); padding: 8px; border-radius: 8px; }
  @page { margin: 16mm 14mm; }
  @media print { main { padding: 0; max-width: none; } .table { overflow: visible; } thead { display: table-header-group; } tr { break-inside: avoid; } }
`;

export async function notebookHtml(cells: NotebookCell[], opts: ExportOptions): Promise<string> {
  const parts: string[] = [];
  for (const cell of cells) {
    const blocks: string[] = [];
    if (cell.type === 'markdown') {
      if (!cell.source.trim()) continue;
      blocks.push(`<div class="md">${await markdownHtml(cell.source)}</div>`);
    } else if (cell.type === 'pivot') {
      const grid = opts.pivots?.[cell.id];
      if (!grid) continue;
      blocks.push(tableHtml(grid.columns, grid.rows, grid.rows.length, () => ''));
    } else if (cell.type === 'chart') {
      const img = opts.charts[cell.id];
      if (!img) continue;
      const alt = esc(cell.chart?.from ? `Chart of ${cell.chart.from}` : 'Chart');
      // The dark image only on screens in dark mode; print always takes the light one.
      blocks.push(img.dark
        ? `<picture><source media="screen and (prefers-color-scheme: dark)" srcset="${img.dark}"><img src="${img.light}" alt="${alt}"></picture>`
        : `<img src="${img.light}" alt="${alt}">`);
    } else {
      if (opts.includeCode && cell.source.trim()) {
        blocks.push(`<div class="code"><span class="lang">${cell.type === 'sql' ? 'SQL' : 'Python'}${cell.name ? ` · ${esc(cell.name)}` : ''}</span><pre>${esc(cell.source)}</pre></div>`);
      }
      const out = cell.output;
      const outBlocks: string[] = [];
      if (out?.kind === 'error') {
        if (opts.includeCode) outBlocks.push(`<div class="error"><pre>${esc(out.text || '')}</pre></div>`);
      } else if (out) {
        if (out.text) outBlocks.push(`<pre>${esc(out.text)}</pre>`);
        if (out.kind === 'table' && out.columns) outBlocks.push(tableHtml(out.columns, (out.rows ?? []) as unknown[][], out.row_count, opts.labels.rowsShown));
        for (const src of opts.images[cell.id] ?? (out.image ? [out.image] : [])) outBlocks.push(`<div class="figure"><img src="${src}" alt="Figure"></div>`);
      }
      if (outBlocks.length) blocks.push(`<div class="out">${outBlocks.join('')}</div>`);
    }
    if (blocks.length) parts.push(`<section>${blocks.join('')}</section>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${esc(opts.title)}</title><style>${STYLE}</style></head><body><main>`
    + `<header><h1 class="title">${esc(opts.title)}</h1><div class="exported">${esc(opts.labels.exportedOn)}</div></header>`
    + parts.join('') + `</main></body></html>`;
}

/** Print the report from a hidden frame, so "Save as PDF" gets the report, not the app. */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    document.body.appendChild(frame);
    const done = () => {
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return done();
      // Wait for images (charts, figures) before opening the dialog.
      const imgs = Array.from(win.document.images);
      Promise.all(imgs.map((img) => (img.complete ? Promise.resolve() : new Promise((r) => { img.onload = r; img.onerror = r; }))))
        .then(() => {
          win.addEventListener('afterprint', done, { once: true });
          win.focus();
          win.print();
          setTimeout(done, 60000);
        });
    };
    frame.srcdoc = html;
  });
}
