/**
 * Annotations drawn on the chart (Datawrapper "annotate"): a note pinned to one category's
 * value, and a shaded highlight between two categories. Stored as chartOptions.annotations.
 */

type AnyOption = Record<string, any>;

export type ChartNote = { kind: 'note'; category: string; text: string };
export type ChartHighlight = { kind: 'highlight'; from: string; to: string; text?: string };
export type ChartAnnotation = ChartNote | ChartHighlight;

const NOTE_COLOR = '#f59e0b';

function categoryAxis(option: AnyOption): { key: 'xAxis' | 'yAxis'; data: string[] } | null {
  for (const key of ['xAxis', 'yAxis'] as const) {
    const ax = Array.isArray(option[key]) ? option[key][0] : option[key];
    if (ax?.type === 'category' && Array.isArray(ax.data)) return { key, data: ax.data.map((v: unknown) => String(v ?? '')) };
  }
  return null;
}

export function applyAnnotations(
  option: AnyOption,
  annotations: ChartAnnotation[] | undefined,
  opts: { dataLabels?: boolean } = {},
): AnyOption {
  if (!annotations?.length || !Array.isArray(option?.series) || !option.series.length) return option;
  const cat = categoryAxis(option);
  if (!cat) return option;
  const horizontal = cat.key === 'yAxis';
  const first = option.series.findIndex((s: AnyOption) => s && Array.isArray(s.data) && !String(s.id || '').startsWith('aiser-'));
  if (first < 0) return option;
  const target = option.series[first];
  const valueAt = (i: number) => {
    const v = target.data[i];
    const n = Number(v && typeof v === 'object' ? (v as AnyOption).value : v);
    return Number.isFinite(n) ? n : 0;
  };

  const notes = annotations
    .filter((a): a is ChartNote => a.kind === 'note' && !!a.text && cat.data.includes(String(a.category)))
    .map((a) => {
      const i = cat.data.indexOf(String(a.category));
      const v = valueAt(i);
      return {
        coord: horizontal ? [v, a.category] : [a.category, v],
        symbol: 'circle',
        symbolSize: 8,
        itemStyle: { color: NOTE_COLOR, borderColor: '#fff', borderWidth: 1.5 },
        label: {
          show: true,
          formatter: a.text,
          position: horizontal ? 'right' : 'top',
          // Above the value label when data labels are on, so the two never overlap.
          distance: opts.dataLabels ? 26 : 10,
          color: '#1f2937',
          backgroundColor: 'rgba(255,255,255,0.95)',
          borderColor: NOTE_COLOR,
          borderWidth: 1,
          borderRadius: 4,
          padding: [3, 6],
          fontSize: 11,
          textBorderWidth: 0,
        },
      };
    });

  const bands = annotations
    .filter((a): a is ChartHighlight => a.kind === 'highlight' && cat.data.includes(String(a.from)) && cat.data.includes(String(a.to)))
    .map((a) => {
      const k = horizontal ? 'yAxis' : 'xAxis';
      return [
        { [k]: a.from, name: a.text || '', label: { color: '#92400e', fontSize: 11, position: horizontal ? 'insideRight' : 'insideTop' } },
        { [k]: a.to },
      ];
    });

  if (!notes.length && !bands.length) return option;
  const series = option.series.map((s: AnyOption, i: number) =>
    i !== first
      ? s
      : {
          ...s,
          ...(notes.length ? { markPoint: { ...(s.markPoint || {}), data: [...(s.markPoint?.data || []), ...notes] } } : {}),
          ...(bands.length
            ? {
                markArea: {
                  ...(s.markArea || {}),
                  silent: true,
                  itemStyle: { color: 'rgba(245,158,11,0.12)' },
                  data: [...(s.markArea?.data || []), ...bands],
                },
              }
            : {}),
        },
  );
  return { ...option, series };
}

/** Axis titles report clicks, so they can be edited in place. */
export function makeAxisTitlesClickable(option: AnyOption): AnyOption {
  const patch = (a: unknown) => (Array.isArray(a) ? a.map((x) => ({ ...x, triggerEvent: true })) : a ? { ...(a as AnyOption), triggerEvent: true } : a);
  return { ...option, xAxis: patch(option.xAxis), yAxis: patch(option.yAxis) };
}
