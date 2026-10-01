'use client';

import React from 'react';
import { Button, Tag } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { RuntimeFilter } from '../../utils/filterOperators';
import { inferFilterLabel } from '../../utils/filterInference';

/**
 * The filters set by clicking a chart, shown above the dashboard with a way back. Without it,
 * clicking a slice changed every number with nothing on screen saying why (Power BI shows the
 * same with its "filtered by" indicator).
 */
export function CrossFilterChips({
  runtimeFilters,
  onRemove,
}: {
  runtimeFilters: RuntimeFilter[];
  onRemove: (field: string) => void;
}) {
  const active = runtimeFilters.filter((f) => f.crossFilter);
  return active.length ? <ActiveCrossFilters active={active} onRemove={onRemove} /> : null;
}

function ActiveCrossFilters({ active, onRemove }: { active: RuntimeFilter[]; onRemove: (field: string) => void }) {
  const t = useTranslations('dashboard_viewer');
  const tCommon = useTranslations('common');

  const show = (v: unknown): string => {
    if (Array.isArray(v)) return v.map(show).join(', ');
    if (v === true || v === 'true') return tCommon('yes');
    if (v === false || v === 'false') return tCommon('no');
    return String(v ?? '');
  };

  return (
    <div className="cross-filter-chips" role="status">
      <FilterOutlined aria-hidden />
      <span className="cross-filter-chips-label">{t('cross_filter_active')}</span>
      {active.map((f) => (
        <Tag key={`${f.field}-${f.operator}`} closable onClose={() => onRemove(f.field)}>
          {inferFilterLabel(f.field.split('.').pop() || f.field)}: {show(f.value)}
        </Tag>
      ))}
      {active.length > 1 ? (
        <Button type="link" size="small" onClick={() => active.forEach((f) => onRemove(f.field))}>
          {t('cross_filter_clear')}
        </Button>
      ) : null}
    </div>
  );
}
