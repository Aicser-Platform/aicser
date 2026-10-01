'use client';

// Tells people *what data* a query hits. Once an enabled pipeline serves a
// source, charts, the SQL editor and AI read its Silver/Gold tables in the
// lakehouse, not the original source (see server query_routing.py).

import React from 'react';
import { Alert, Tag, Tooltip } from 'antd';
import { ClockCircleOutlined, DeploymentUnitOutlined } from '@ant-design/icons';
import { useLocale, useTranslations } from 'next-intl';
import type { SchemaInfo } from '@/stores/useDataSourceStore';

type ServedFrom = SchemaInfo['served_from'];

function relativeTime(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const secs = Math.round((then - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(secs) >= size || unit === 'second') return rtf.format(Math.round(secs / size), unit);
  }
  return null;
}

/** Source-level notice: a banner (data panels) or a compact tag (toolbars). */
export function LakehouseServingNotice({
  servedFrom,
  variant = 'banner',
}: {
  servedFrom?: ServedFrom;
  variant?: 'banner' | 'tag';
}) {
  const t = useTranslations('lakehouse_serving');
  if (!servedFrom) return null;
  const pending = servedFrom === 'lakehouse_pending';

  if (variant === 'tag') {
    return (
      <Tooltip title={pending ? t('pending_desc') : t('served_desc')}>
        <Tag
          color={pending ? 'warning' : 'processing'}
          icon={pending ? <ClockCircleOutlined /> : <DeploymentUnitOutlined />}
          style={{ margin: 0 }}
        >
          {pending ? t('pending_short') : t('served_short')}
        </Tag>
      </Tooltip>
    );
  }
  return (
    <Alert
      type={pending ? 'warning' : 'info'}
      showIcon
      icon={pending ? <ClockCircleOutlined /> : <DeploymentUnitOutlined />}
      message={pending ? t('pending_title') : t('served_title')}
      description={pending ? t('pending_desc') : t('served_desc')}
      style={{ marginTop: 8 }}
    />
  );
}

/** Per-table: which medallion layer answers it, and how fresh it is. */
export function LakehouseLayerTag({
  layer,
  refreshedAt,
  showFreshness = false,
}: {
  layer?: 'silver' | 'gold' | null;
  refreshedAt?: string | null;
  showFreshness?: boolean;
}) {
  const t = useTranslations('lakehouse_serving');
  const locale = useLocale();
  if (!layer) return null;
  const ago = relativeTime(refreshedAt, locale);
  const label = layer === 'gold' ? t('layer_gold') : t('layer_silver');
  return (
    <Tooltip title={ago ? t('refreshed', { when: ago }) : undefined}>
      <Tag color={layer === 'gold' ? 'gold' : 'default'} style={{ margin: 0, fontSize: 11 }}>
        {label}
        {showFreshness && ago ? ` · ${ago}` : ''}
      </Tag>
    </Tooltip>
  );
}
