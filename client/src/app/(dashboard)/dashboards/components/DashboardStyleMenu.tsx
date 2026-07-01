'use client';

import React from 'react';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { BgColorsOutlined, DownOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { LAYOUT_PRESETS, type LayoutPreset } from './LayoutPresetsMenu';
import {
  CHART_PALETTE_CATALOG,
  DEFAULT_CHART_PALETTE_ID,
  type ChartPaletteId,
} from '../utils/chartPaletteCatalog';

type Props = {
  currentPalette?: ChartPaletteId | string;
  onApplyLayoutPreset?: (preset: LayoutPreset) => void;
  onResetLayout?: () => void;
  hideLayout?: boolean;
  widgetCount?: number;
  onPaletteChange?: (paletteId: ChartPaletteId) => void;
};

function PaletteSwatch({ colors }: { colors: readonly string[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 2, marginLeft: 8, verticalAlign: 'middle' }}>
      {colors.map((color) => (
        <span
          key={color}
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            backgroundColor: color,
            border: '1px solid var(--ant-color-border-secondary, #e8e8e8)',
          }}
        />
      ))}
    </span>
  );
}

export function DashboardStyleMenu({
  currentPalette = DEFAULT_CHART_PALETTE_ID,
  onApplyLayoutPreset,
  onResetLayout,
  hideLayout = false,
  widgetCount = 0,
  onPaletteChange,
}: Props) {
  const t = useTranslations('dashboards');

  const paletteItems: MenuProps['items'] = CHART_PALETTE_CATALOG.map((palette) => ({
    key: `palette-${palette.id}`,
    label: (
      <span>
        {t(palette.labelKey as 'palette_default')}
        <PaletteSwatch colors={palette.colors} />
      </span>
    ),
    onClick: () => onPaletteChange?.(palette.id),
  }));

  const layoutItems: MenuProps['items'] =
    hideLayout || !onApplyLayoutPreset
      ? []
      : [
          ...LAYOUT_PRESETS.map((preset) => ({
            key: `layout-${preset.id}`,
            label: t(preset.nameKey as 'preset_executive'),
            onClick: () => onApplyLayoutPreset(preset),
          })),
          ...(onResetLayout && widgetCount > 0
            ? [
                { type: 'divider' as const },
                {
                  key: 'layout-reset',
                  label: t('reset_page_layout'),
                  onClick: onResetLayout,
                },
              ]
            : []),
        ];

  const menuItems: MenuProps['items'] = [
    { type: 'group', label: t('style_colors_group'), children: paletteItems },
    ...(layoutItems.length
      ? [{ type: 'group' as const, label: t('style_layout_group'), children: layoutItems }]
      : []),
  ];

  const activePalette =
    CHART_PALETTE_CATALOG.find((p) => p.id === currentPalette) ??
    CHART_PALETTE_CATALOG.find((p) => p.id === DEFAULT_CHART_PALETTE_ID)!;

  return (
    <Dropdown
      menu={{
        items: menuItems,
        selectedKeys: [`palette-${currentPalette}`],
      }}
      trigger={['click']}
    >
      <Button type="text" block icon={<BgColorsOutlined />} className="!justify-start !text-left text-text-secondary">
        <span className="flex-1 text-left">{t('style_menu_label')}</span>
        <PaletteSwatch colors={activePalette.colors.slice(0, 4)} />
        <DownOutlined style={{ fontSize: 10, marginLeft: 4 }} />
      </Button>
    </Dropdown>
  );
}
