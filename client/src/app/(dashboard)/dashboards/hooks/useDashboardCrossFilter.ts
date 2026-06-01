'use client';

import { useCallback } from 'react';
import type { RuntimeFilter } from '../stores/useDashboardStore';

function valuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function useDashboardCrossFilter(
  runtimeFilters: RuntimeFilter[],
  onChange: (filters: RuntimeFilter[]) => void
) {
  return useCallback(
    (field: string, value: unknown) => {
      if (!field) return;

      // Clear filter for this field
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
        onChange(runtimeFilters.filter((f) => f.field !== field));
        return;
      }

      // Handle date range value from enhanced slicer { __range, from, to }
      if (typeof value === 'object' && !Array.isArray(value) && (value as any).__range) {
        const { from, to } = value as { from: string; to: string };
        const next = runtimeFilters.filter((f) => f.field !== field);
        if (from) next.push({ field, operator: '>=', value: from, type: 'date' });
        if (to) next.push({ field, operator: '<=', value: to, type: 'date' });
        onChange(next);
        return;
      }

      // Handle numeric range { __numericRange, min, max }
      if (typeof value === 'object' && !Array.isArray(value) && (value as any).__numericRange) {
        const { min, max } = value as { min: number; max: number };
        const next = runtimeFilters.filter((f) => f.field !== field);
        next.push({ field, operator: '>=', value: min, type: 'simple' });
        next.push({ field, operator: '<=', value: max, type: 'simple' });
        onChange(next);
        return;
      }

      const existing = runtimeFilters.find((f) => f.field === field && (f.operator === '=' || f.operator === 'in'));
      if (existing && valuesEqual(existing.value, value)) {
        // Toggle off when clicking the same value (industry-standard cross-filter UX)
        onChange(runtimeFilters.filter((f) => f.field !== field));
        return;
      }

      const next = runtimeFilters.filter((f) => f.field !== field);
      if (Array.isArray(value)) {
        next.push({ field, operator: 'in', value, type: 'simple' });
      } else {
        next.push({ field, operator: '=', value, type: 'simple' });
      }
      onChange(next);
    },
    [runtimeFilters, onChange]
  );
}
