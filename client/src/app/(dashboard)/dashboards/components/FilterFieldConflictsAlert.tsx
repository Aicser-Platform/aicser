'use client';

import React from 'react';
import { Alert } from 'antd';
import { useTranslations } from 'next-intl';
import type { FilterFieldConflict } from '../utils/filterConflicts';

type Props = {
  conflicts: FilterFieldConflict[];
  compact?: boolean;
};

export function FilterFieldConflictsAlert({ conflicts, compact = false }: Props) {
  const t = useTranslations('dashboards');

  if (!conflicts.length) return null;

  const description = conflicts
    .map((c) => {
      const parts: string[] = [];
      if (c.sources.includes('global')) parts.push(t('filter_conflict_global'));
      if (c.sources.includes('page')) parts.push(t('filter_conflict_page'));
      if (c.sources.includes('slicer')) {
        parts.push(t('filter_conflict_slicer', { count: c.slicerWidgetIds.length }));
      }
      return t('filter_conflict_line', { field: c.field, sources: parts.join(', ') });
    })
    .join(' ');

  return (
    <Alert
      type="warning"
      showIcon
      className={compact ? 'filter-conflicts-alert-compact' : 'filter-conflicts-alert'}
      message={t('filter_conflict_title')}
      description={description}
      style={{ marginBottom: compact ? 8 : 12 }}
    />
  );
}
