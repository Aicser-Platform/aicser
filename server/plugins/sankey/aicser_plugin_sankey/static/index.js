// Prebuilt ESM bundle for Aicser Sankey Visual Plug-in (Visual API v1)
const MAX_SANKEY_LINKS = 120;

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );

const shownName = (name) => String(name || '').replace(/\u200b+$/, '');

function extractLinks(ctx) {
  const { data, options = {} } = ctx || {};
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const cols = Array.isArray(data?.columns) ? data.columns : [];

  const sourceCol = options.sourceField || cols[0]?.name || 'source';
  const targetCol = options.targetField || cols[1]?.name || 'target';
  const valueCol = options.valueField || cols[2]?.name || 'value';

  const rawPairs = [];
  for (const row of rows) {
    const s = String(row?.[sourceCol] ?? '').trim();
    const t = String(row?.[targetCol] ?? '').trim();
    const v = Number(row?.[valueCol] ?? 0);
    if (s && t && Number.isFinite(v) && v > 0) {
      rawPairs.push({ s, t, v });
    }
  }

  const sourceSet = new Set(rawPairs.map((p) => p.s));
  const targetId = (t) => (sourceSet.has(t) ? `${t}\u200b` : t);

  const merged = new Map();
  for (const { s, t, v } of rawPairs) {
    const key = `${s}\u0000${t}`;
    const existing = merged.get(key);
    if (existing) {
      existing.value += v;
    } else {
      merged.set(key, { source: s, target: targetId(t), value: v });
    }
  }

  return [...merged.values()].sort((a, b) => b.value - a.value).slice(0, MAX_SANKEY_LINKS);
}

const plugin = {
  mount(el, ctx) {
    if (!ctx?.echarts?.init) {
      throw new Error('Host ECharts instance (ctx.echarts) is required for Sankey visual');
    }

    const chart = ctx.echarts.init(el, undefined, { renderer: 'canvas' });

    function render(currentCtx) {
      const { options = {}, theme = {}, format } = currentCtx || {};
      const palette =
        Array.isArray(theme.palette) && theme.palette.length
          ? theme.palette
          : ['#2563eb', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#16a34a'];
      const fmt = (n) =>
        typeof format?.number === 'function' ? format.number(n) : Number(n).toLocaleString();

      const links = extractLinks(currentCtx);
      const totals = new Map();
      for (const l of links) {
        totals.set(l.source, (totals.get(l.source) || 0) + l.value);
        totals.set(l.target, (totals.get(l.target) || 0) + l.value);
      }

      const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
      const nodes = names.map((name, i) => ({
        name,
        itemStyle: { color: palette[i % palette.length] },
      }));
      const grand = links.reduce((sum, l) => sum + l.value, 0);
      const isDark =
        theme.mode === 'dark' ||
        (typeof document !== 'undefined' &&
          (document.documentElement.classList.contains('dark') ||
            document.documentElement.getAttribute('data-theme') === 'dark' ||
            document.body?.classList.contains('dark') ||
            document.body?.getAttribute('data-theme') === 'dark'));
      const textColor = isDark ? '#cbd5e1' : '#475569';
      const tooltipBg = isDark ? 'rgba(22, 27, 34, 0.97)' : 'rgba(255, 255, 255, 0.98)';
      const tooltipBorder = isDark ? '#30363d' : '#d0d7de';
      const tooltipTextColor = isDark ? '#e6edf3' : '#24292f';
      const tooltipSubColor = isDark ? '#8b949e' : '#57606a';

      try {
        chart.setOption(
          {
            backgroundColor: 'transparent',
            color: palette,
            tooltip: {
              trigger: 'item',
              confine: true,
              className: 'dashboard-chart-tooltip',
              backgroundColor: tooltipBg,
              borderColor: tooltipBorder,
              borderWidth: 1,
              borderRadius: 8,
              padding: [8, 12],
              textStyle: {
                color: tooltipTextColor,
                fontSize: 12,
                lineHeight: 18,
              },
              extraCssText: `background-color: ${tooltipBg} !important; border-color: ${tooltipBorder} !important; color: ${tooltipTextColor} !important; box-shadow: 0 8px 24px rgba(0,0,0,${isDark ? '0.45' : '0.14'}); z-index: 99999 !important; pointer-events: none;`,
              formatter: (p) => {
                if (p?.dataType === 'edge' && p?.data) {
                  const val = Number(p.data.value || 0);
                  const pct = grand > 0 ? `${((val / grand) * 100).toFixed(1)}%` : '–';
                  return `<div style="color:${tooltipTextColor};">${esc(shownName(p.data.source))} &rarr; ${esc(shownName(p.data.target))}<br/><strong style="color:${tooltipTextColor};">${esc(fmt(val))}</strong> <span style="color:${tooltipSubColor};">&middot; ${pct} of total</span></div>`;
                }
                const total = totals.get(p?.name || '') || 0;
                return `<div style="color:${tooltipTextColor};">${esc(shownName(p?.name || ''))}<br/><strong style="color:${tooltipTextColor};">${esc(fmt(total))}</strong></div>`;
              },
            },
            series: [
              {
                type: 'sankey',
                left: 8,
                right: 130,
                top: 8,
                bottom: 8,
                nodeGap: 10,
                nodeWidth: 14,
                draggable: false,
                orient: options.orient || 'horizontal',
                nodeAlign: options.nodeAlign || 'justify',
                emphasis: { focus: 'adjacency' },
                lineStyle: { color: 'gradient', curveness: 0.5, opacity: isDark ? 0.45 : 0.35 },
                label: {
                  color: textColor,
                  textBorderWidth: 0,
                  fontSize: 11,
                  width: 120,
                  overflow: 'truncate',
                  formatter: (p) => shownName(p?.name || ''),
                },
                data: nodes,
                links,
              },
            ],
            legend: { show: false },
          },
          true,
        );
        chart.resize();
      } catch (err) {
        throw new Error(
          err instanceof Error
            ? `Sankey diagrams require directed acyclic data flows: ${err.message}`
            : 'Sankey diagrams require directed acyclic data flows.',
        );
      }
    }

    render(ctx);

    return {
      update(newCtx) {
        render(newCtx);
      },
      destroy() {
        chart.dispose();
      },
    };
  },
};

export default plugin;

