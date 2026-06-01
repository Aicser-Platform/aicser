'use client';

import React from 'react';
import type { DatePresetKey, ResolvedDatePreset } from '../utils/dateFilterPresets';

type Props = {
  presets: ResolvedDatePreset[];
  activeKey: DatePresetKey | null;
  onSelect: (key: DatePresetKey) => void;
  disabled?: boolean;
  className?: string;
};

/** Shared date preset chip row for report filters and canvas slicers. */
export function FilterDatePresetChips({
  presets,
  activeKey,
  onSelect,
  disabled = false,
  className,
}: Props) {
  return (
    <div className={className ?? 'gfb-preset-chips'}>
      {presets.map((preset) => (
        <button
          key={preset.key}
          type="button"
          disabled={disabled}
          className={`gfb-preset-chip${activeKey === preset.key ? ' gfb-preset-chip-active' : ''}`}
          onClick={() => onSelect(preset.key)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

export default FilterDatePresetChips;
