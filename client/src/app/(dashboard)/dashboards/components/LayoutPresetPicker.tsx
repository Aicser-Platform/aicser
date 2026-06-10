'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { LAYOUT_PRESETS, type LayoutPreset } from './LayoutPresetsMenu';

type Props = {
  onSelect: (preset: LayoutPreset) => void;
};

export function LayoutPresetPicker({ onSelect }: Props) {
  const t = useTranslations('dashboards_page');
  const td = useTranslations('dashboards');

  return (
    <div className="layout-preset-picker">
      <p className="layout-preset-picker-hint">{t('layout_preset_hint')}</p>
      <div className="layout-preset-list">
        {LAYOUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="layout-preset-row"
            onClick={() => onSelect(preset)}
          >
            <span className="layout-preset-name">{td(preset.nameKey as 'preset_executive')}</span>
            <span className="layout-preset-meta">
              {t('layout_preset_slots', { count: preset.layout.length })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default LayoutPresetPicker;
