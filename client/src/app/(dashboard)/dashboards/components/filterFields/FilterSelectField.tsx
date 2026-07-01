'use client';

import React from 'react';
import { Select, Button } from 'antd';
import { FilterControlShell } from '../FilterControlShell';

type Option = { label: string; value: string };
const EMPTY_OPTION_VALUE = '__dashboard_filter_all__';

type Props = {
  label: string;
  placeholder?: string;
  options: Option[];
  loading?: boolean;
  emptyLabel?: string;
  value?: string | string[];
  mode?: 'single' | 'multi';
  maxTagCount?: number;
  disabled?: boolean;
  onChange: (value: string | string[] | null) => void;
  variant?: 'report' | 'slicer';
  showSearch?: boolean;
  emptyOptionLabel?: string;
  showSelectAll?: boolean;
  selectAllLabel?: string;
  clearAllLabel?: string;
};

export function FilterSelectField({
  label,
  placeholder,
  options,
  loading = false,
  emptyLabel,
  value,
  mode = 'single',
  maxTagCount,
  disabled = false,
  onChange,
  variant = 'report',
  showSearch = true,
  emptyOptionLabel,
  showSelectAll = false,
  selectAllLabel,
  clearAllLabel,
}: Props) {
  const isMulti = mode === 'multi';
  const selectedArr = Array.isArray(value) ? value : value ? [value] : [];
  const allValues = options.map((o) => o.value);
  const allSelected = allValues.length > 0 && allValues.every((v) => selectedArr.includes(v));
  const effectiveOptions =
    emptyOptionLabel && !isMulti
      ? [{ label: emptyOptionLabel, value: EMPTY_OPTION_VALUE }, ...options]
      : options;
  const effectiveValue =
    emptyOptionLabel && !isMulti && (value == null || value === '')
      ? EMPTY_OPTION_VALUE
      : value;

  const select = (
    <Select
      allowClear
      showSearch={showSearch}
      mode={isMulti ? 'multiple' : undefined}
      size="small"
      placeholder={placeholder}
      style={{ width: '100%' }}
      loading={loading}
      disabled={disabled}
      value={effectiveValue as string | string[] | undefined}
      maxTagCount={maxTagCount}
      options={effectiveOptions}
      optionFilterProp="label"
      getPopupContainer={() => document.body}
      notFoundContent={loading ? undefined : emptyLabel}
      onChange={(v) => {
        if (!isMulti && v === EMPTY_OPTION_VALUE) {
          onChange(null);
          return;
        }
        onChange((v as string | string[] | null) ?? (isMulti ? [] : null));
      }}
      dropdownRender={
        isMulti && showSelectAll && !disabled && options.length > 1
          ? (menu) => (
              <>
                <div className="filter-select-all-row">
                  <Button
                    type="link"
                    size="small"
                    onClick={() => onChange(allSelected ? [] : allValues)}
                  >
                    {allSelected ? clearAllLabel : selectAllLabel}
                  </Button>
                </div>
                {menu}
              </>
            )
          : undefined
      }
    />
  );

  if (variant === 'slicer') return select;
  return <FilterControlShell label={label}>{select}</FilterControlShell>;
}
