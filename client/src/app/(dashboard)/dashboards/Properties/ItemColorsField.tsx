'use client';

import React from 'react';
import { Button, ColorPicker } from 'antd';
import { useTranslations } from 'next-intl';
import { PpLabel } from './PpLabel';
import { getColorsFromPalette } from '../widgets/WidgetRendererConfig';
import { resolveChartPaletteId } from '../utils/chartPaletteCatalog';
import { makeCategoryLabelFormatter } from '../utils/numberFormatter';

const MAX_ITEMS = 24;

type ChartDataLike = { x?: unknown[]; series?: Array<{ name?: string }> } | undefined;

/**
 * Pick the colour of any one series, bar or slice (Datawrapper "customize colors"): each item
 * shows its current colour; clicking it changes just that item. The palette colours the rest.
 */
export function ItemColorsField({
  chartType,
  chartData,
  chartOptions,
  dashboardDefaultPalette,
  onChange,
}: {
  chartType: string;
  chartData: ChartDataLike;
  chartOptions: Record<string, any>;
  dashboardDefaultPalette?: string;
  onChange: (colorOverrides: Record<string, string> | undefined) => void;
}) {
  const t = useTranslations('chart_specific_fields');
  const series = (chartData?.series || []).map((s) => String(s?.name ?? '')).filter(Boolean);
  const perCategory =
    series.length <= 1 &&
    (['pie', 'donut', 'funnel', 'treemap'].includes(chartType) || (chartType === 'bar' && chartOptions?.varyColors === true));
  const raw: string[] = perCategory ? (chartData?.x || []).map((v) => String(v ?? '')) : series.length > 1 ? series : [];
  if (raw.length === 0) return null;

  const label = perCategory ? makeCategoryLabelFormatter(chartData?.x as unknown[]) : (v: unknown) => String(v);
  const paletteId = resolveChartPaletteId(chartOptions?.colorPalette, dashboardDefaultPalette);
  const palette = getColorsFromPalette(paletteId === 'custom' ? 'default' : paletteId, raw.length);
  const overrides: Record<string, string> = chartOptions?.colorOverrides || {};
  const shown = raw.slice(0, MAX_ITEMS);

  const set = (name: string, color: string | null) => {
    const next = { ...overrides };
    if (color) next[name] = color;
    else delete next[name];
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div className="pp-item-colors">
      <div className="pp-item-colors-head">
        <PpLabel tip={t('item_colors_tip')}>{t('item_colors')}</PpLabel>
        {Object.keys(overrides).length ? (
          <Button type="link" size="small" onClick={() => onChange(undefined)}>
            {t('item_colors_reset')}
          </Button>
        ) : null}
      </div>
      <ul className="pp-item-colors-list">
        {shown.map((name, i) => (
          <li key={name}>
            <ColorPicker
              size="small"
              value={overrides[name] || palette[i % palette.length]}
              presets={[{ label: t('item_colors_palette'), colors: palette.slice(0, 20) }]}
              onChangeComplete={(c) => set(name, c.toHexString())}
            />
            <span className="pp-item-colors-name" title={label(name)}>
              {label(name)}
            </span>
            {overrides[name] ? (
              <Button type="text" size="small" className="pp-item-colors-clear" onClick={() => set(name, null)}>
                {t('item_colors_use_palette')}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {raw.length > MAX_ITEMS ? (
        <div className="pp-item-colors-more">{t('item_colors_more', { count: raw.length - MAX_ITEMS })}</div>
      ) : null}
    </div>
  );
}
