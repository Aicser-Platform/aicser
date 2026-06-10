'use client';

import React from 'react';
import { DatePicker } from 'antd';
import dayjs from 'dayjs';
import { getSingleDateValue } from '../../utils/filterOperators';
import { FilterControlShell } from '../FilterControlShell';

type Props = {
  label: string;
  field: string;
  runtimeFilters: Array<{ field: string; operator: string; value: unknown }>;
  placeholder?: string;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  variant?: 'report' | 'slicer';
};

export function FilterSingleDateField({
  label,
  field,
  runtimeFilters,
  placeholder,
  onChange,
  disabled = false,
  variant = 'report',
}: Props) {
  const current = getSingleDateValue(field, runtimeFilters);
  const picker = (
    <DatePicker
      size="small"
      allowClear
      disabled={disabled}
      style={{ width: '100%' }}
      placeholder={placeholder}
      value={current ? dayjs(current) : null}
      onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : null)}
    />
  );

  if (variant === 'slicer') return picker;
  return <FilterControlShell label={label}>{picker}</FilterControlShell>;
}
