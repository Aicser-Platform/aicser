'use client';

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { StarFilled } from '@ant-design/icons';
import { LAYOUT_PRESETS, type LayoutPreset } from './LayoutPresetsMenu';
import { suggestLayoutPreset } from '../utils/layoutScaffolds';
import type { WidgetInstance } from '../stores/dashboardStoreTypes';

type Props = {
  onSelect: (preset: LayoutPreset) => void;
  widgets?: WidgetInstance[];
};

export function LayoutPresetPicker({ onSelect, widgets = [] }: Props) {
  const t = useTranslations('dashboards_page');
  const td = useTranslations('dashboards');

  // Auto-detected best fit for the dashboard's current widget mix (KPI/chart/
  // table counts) — surfaced as a badge on the manual list rather than an
  // auto-apply, so the recommendation is visible but the user still picks.
  const recommendedId = useMemo(() => suggestLayoutPreset(widgets)?.id ?? null, [widgets]);

  return (
    <div>
      <p className="text-xs text-text-secondary mb-3">{t('layout_preset_hint')}</p>
      <div className="flex flex-col gap-1.5">
        {LAYOUT_PRESETS.map((preset) => {
          const isRecommended = preset.id === recommendedId;
          return (
            <button
              key={preset.id}
              type="button"
              className={`flex items-center justify-between w-full px-3 py-2.5 rounded-md border text-left transition-colors hover:border-brand ${
                isRecommended ? 'border-brand bg-brand-subtle' : 'border-border-light bg-bg-container'
              }`}
              onClick={() => onSelect(preset)}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
                {td(preset.nameKey as 'preset_executive')}
                {isRecommended && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-brand">
                    <StarFilled className="text-[10px]" /> {t('layout_preset_recommended')}
                  </span>
                )}
              </span>
              <span className="text-[11px] text-text-tertiary">
                {t('layout_preset_slots', { count: preset.layout.length })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default LayoutPresetPicker;
