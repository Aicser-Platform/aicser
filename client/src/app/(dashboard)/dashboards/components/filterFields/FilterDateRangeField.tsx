'use client';

import React, { useMemo, useState } from 'react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import {
  detectDatePresetKey,
  presetRangeByKey,
  type DatePresetKey,
  type ResolvedDatePreset,
} from '../../utils/dateFilterPresets';
import { getDateRangeValue } from '../../utils/filterOperators';
import { FilterControlShell } from '../FilterControlShell';
import { FilterDatePresetChips } from '../FilterDatePresetChips';

type Props = {
  label: string;
  field: string;
  runtimeFilters: Array<{ field: string; operator: string; value: unknown }>;
  presets: ResolvedDatePreset[];
  onChange: (from: string | null, to: string | null) => void;
  disabled?: boolean;
  /** Slicer passes range object via onFilter — when set, uses compact slicer chrome */
  variant?: 'report' | 'slicer';
  presentation?: 'presets' | 'range';
  displayRange?: [unknown, unknown];
  onClear?: () => void;
  clearLabel?: string;
};

export function FilterDateRangeField({
  label,
  field,
  runtimeFilters,
  presets,
  onChange,
  disabled = false,
  variant = 'report',
  presentation = 'presets',
  displayRange,
  onClear,
  clearLabel,
}: Props) {
  const [activePreset, setActivePreset] = useState<DatePresetKey | null>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [from, to] = getDateRangeValue(field, runtimeFilters);
  const normalizeDate = (value: unknown) => {
    if (value == null || value === '') return null;
    const parsed = dayjs(value as string | number | Date);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
  };
  const displayFrom = from || normalizeDate(displayRange?.[0]);
  const displayTo = to || normalizeDate(displayRange?.[1]);
  const detectedPreset = useMemo(() => detectDatePresetKey(from, to), [from, to]);
  const resolvedPreset = activePreset ?? detectedPreset;

  const handlePreset = (preset: ResolvedDatePreset) => {
    if (preset.key === 'custom') {
      setActivePreset('custom');
      setShowCustom(true);
      return;
    }
    setActivePreset(preset.key);
    setShowCustom(false);
    const range = presetRangeByKey(preset.key);
    onChange(range.from || null, range.to || null);
  };

  const showCustomPicker = showCustom || resolvedPreset === 'custom';

  const rangePicker = (
    <DatePicker.RangePicker
      size="small"
      disabled={disabled}
      allowClear
      className="gfb-date-range-picker"
      style={{ width: '100%' }}
      value={displayFrom && displayTo ? [dayjs(displayFrom), dayjs(displayTo)] : displayFrom ? [dayjs(displayFrom), null] : null}
      onChange={(_, strings) => {
        const [f, end] = strings;
        onChange(f || null, end || null);
      }}
    />
  );

  const body = presentation === 'range' ? (
    rangePicker
  ) : (
    <>
      <FilterDatePresetChips
        presets={presets}
        activeKey={resolvedPreset}
        disabled={disabled}
        onSelect={(key) => {
          const preset = presets.find((p) => p.key === key);
          if (preset) handlePreset(preset);
        }}
      />
      {showCustomPicker && (
        <div style={{ marginTop: 8 }}>{rangePicker}</div>
      )}
      {variant === 'slicer' && (resolvedPreset || from) && onClear && clearLabel ? (
        <button type="button" className="filter-field-clear-link" onClick={onClear} disabled={disabled}>
          {clearLabel}
        </button>
      ) : null}
    </>
  );

  if (variant === 'slicer') {
    return <div className="filter-field-slicer">{body}</div>;
  }

  return <FilterControlShell label={label} className="gfb-daterange-control-wrap">{body}</FilterControlShell>;
}
