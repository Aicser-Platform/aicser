'use client';

import React from 'react';
import { Select, Button } from 'antd';
import { FilterControlShell } from '../FilterControlShell';

type Option = { label: string; value: string };

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
  showSelectAll = false,
  selectAllLabel,
  clearAllLabel,
}: Props) {
  const isMulti = mode === 'multi';
  const selectedArr = Array.isArray(value) ? value : value ? [value] : [];
  const allValues = options.map((o) => o.value);
  const allSelected = allValues.length > 0 && allValues.every((v) => selectedArr.includes(v));

  const select = (
    <Select
      allowClear
      showSearch
      mode={isMulti ? 'multiple' : undefined}
      size="small"
      placeholder={placeholder}
      style={{ width: '100%' }}
      loading={loading}
      disabled={disabled}
      value={value as string | string[] | undefined}
      maxTagCount={maxTagCount}
      options={options}
      notFoundContent={loading ? undefined : emptyLabel}
      onChange={(v) => onChange((v as string | string[] | null) ?? (isMulti ? [] : null))}
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
