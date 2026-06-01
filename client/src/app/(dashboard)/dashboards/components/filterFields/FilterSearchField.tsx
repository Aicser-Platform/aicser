'use client';

import React, { useEffect, useRef } from 'react';
import { Input } from 'antd';
import { FilterControlShell } from '../FilterControlShell';

type Props = {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  disabled?: boolean;
  debounceMs?: number;
  minLength?: number;
};

export function FilterSearchField({
  label,
  placeholder,
  value,
  onChange,
  onCommit,
  disabled = false,
  debounceMs = 350,
  minLength = 2,
}: Props) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const scheduleCommit = (raw: string) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const trimmed = raw.trim();
      if (trimmed.length === 0 || trimmed.length >= minLength) {
        onCommit(raw);
      }
    }, debounceMs);
  };

  return (
    <FilterControlShell label={label}>
      <Input
        size="small"
        allowClear
        disabled={disabled}
        placeholder={placeholder}
        style={{ width: '100%' }}
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw);
          scheduleCommit(raw);
        }}
        onBlur={() => onCommit(value)}
      />
    </FilterControlShell>
  );
}
