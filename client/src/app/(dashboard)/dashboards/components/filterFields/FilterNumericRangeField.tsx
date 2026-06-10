'use client';

import React from 'react';
import { Slider, Button } from 'antd';
import { getNumericRangeValue } from '../../utils/filterOperators';
import { FilterControlShell } from '../FilterControlShell';

type Props = {
  label: string;
  field: string;
  runtimeFilters: Array<{ field: string; operator: string; value: unknown }>;
  min: number;
  max: number;
  onChange: (range: [number, number]) => void;
  disabled?: boolean;
  variant?: 'report' | 'slicer';
  resetLabel?: string;
};

export function FilterNumericRangeField({
  label,
  field,
  runtimeFilters,
  min,
  max,
  onChange,
  disabled = false,
  variant = 'report',
  resetLabel,
}: Props) {
  const value = getNumericRangeValue(field, runtimeFilters, min, max);
  const isDefault = value[0] === min && value[1] === max;

  const slider = (
    <>
      <Slider
        range
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(v) => onChange(v as [number, number])}
        tooltip={{ formatter: (v) => v?.toLocaleString() }}
      />
      {variant === 'slicer' && !isDefault && resetLabel ? (
        <Button type="link" size="small" style={{ padding: 0, fontSize: 11 }} onClick={() => onChange([min, max])}>
          {resetLabel}
        </Button>
      ) : null}
    </>
  );

  if (variant === 'slicer') {
    return (
      <div className="filter-field-slicer filter-field-numeric">
        <div className="filter-field-numeric-header">
          <span className="gfb-field-label">{label}</span>
          <span className="gfb-slider-value">
            {value[0]} – {value[1]}
          </span>
        </div>
        {slider}
      </div>
    );
  }

  return (
    <FilterControlShell label={label} trailing={<span className="gfb-slider-value">{value[0]} – {value[1]}</span>}>
      {slider}
    </FilterControlShell>
  );
}
