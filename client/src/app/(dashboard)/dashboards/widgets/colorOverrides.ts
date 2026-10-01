/**
 * Colours the author picked for single items (Datawrapper "customize colors"): a series by its
 * name on multi-series charts, or a category by its name when each bar / slice has its own
 * colour. Everything else keeps the palette.
 */

export type ColorOverrides = Record<string, string>;

type AnyOption = Record<string, any>;

const PER_CATEGORY_TYPES = new Set(['pie', 'funnel']);

function categoryNames(option: AnyOption): string[] {
  const axes = [option.xAxis, option.yAxis].flatMap((a) => (Array.isArray(a) ? a : a ? [a] : []));
  const cat = axes.find((a) => a?.type === 'category' && Array.isArray(a.data));
  return cat ? cat.data.map((v: unknown) => String(v ?? '')) : [];
}

export function applyColorOverrides(option: AnyOption, overrides: ColorOverrides | undefined): AnyOption {
  if (!overrides || !Object.keys(overrides).length || !Array.isArray(option?.series)) return option;
  const series: AnyOption[] = option.series;
  const cats = categoryNames(option);
  const primary = series.filter((s) => s && !String(s.id || '').startsWith('aiser-'));
  const perCategory = (s: AnyOption) =>
    PER_CATEGORY_TYPES.has(s.type) || (s.type === 'bar' && s.colorBy === 'data' && primary.length === 1);

  const next = series.map((s) => {
    if (!s || !Array.isArray(s.data)) return s;
    if (perCategory(s)) {
      return {
        ...s,
        data: s.data.map((item: unknown, i: number) => {
          const obj = item && typeof item === 'object' && !Array.isArray(item) ? (item as AnyOption) : null;
          // Pie / funnel items carry their category; bars take it from the axis. Slices shown with a
          // formatted name ("Jun 2024") keep the raw value in `raw`.
          const names = obj ? [obj.raw, obj.name].filter((n) => n != null).map(String) : [cats[i]];
          const color = names.map((n) => overrides[n]).find(Boolean);
          if (!color) return item;
          return obj
            ? { ...obj, itemStyle: { ...(obj.itemStyle || {}), color } }
            : { value: item, itemStyle: { color } };
        }),
      };
    }
    const color = s.name != null ? overrides[String(s.name)] : undefined;
    if (!color) return s;
    return {
      ...s,
      itemStyle: { ...(s.itemStyle || {}), color },
      ...(s.type === 'line' ? { lineStyle: { ...(s.lineStyle || {}), color } } : {}),
      ...(s.areaStyle ? { areaStyle: { ...s.areaStyle, color } } : {}),
    };
  });
  return { ...option, series: next };
}
