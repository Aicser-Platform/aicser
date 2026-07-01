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
    <div className={className ?? 'flex flex-wrap gap-1.5'}>
      {presets.map((preset) => (
        <button
          key={preset.key}
          type="button"
          disabled={disabled}
          className={`h-6 px-2.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            activeKey === preset.key
              ? 'bg-brand border-brand text-white'
              : 'bg-bg-container border-border-light text-text-secondary hover:border-brand hover:text-brand'
          }`}
          onClick={() => onSelect(preset.key)}
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
}

export default FilterDatePresetChips;
