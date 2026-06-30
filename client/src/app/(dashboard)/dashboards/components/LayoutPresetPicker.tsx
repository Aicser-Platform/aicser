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
    <div>
      <p className="text-xs text-text-secondary mb-3">{t('layout_preset_hint')}</p>
      <div className="flex flex-col gap-1.5">
        {LAYOUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className="flex items-center justify-between w-full px-3 py-2.5 rounded-md border border-border-light bg-bg-container text-left transition-colors hover:border-brand"
            onClick={() => onSelect(preset)}
          >
            <span className="text-[13px] font-semibold text-text">{td(preset.nameKey as 'preset_executive')}</span>
            <span className="text-[11px] text-text-tertiary">
              {t('layout_preset_slots', { count: preset.layout.length })}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default LayoutPresetPicker;
