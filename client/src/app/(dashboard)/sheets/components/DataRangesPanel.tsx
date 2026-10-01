'use client';

import React from 'react';
import { Button, Dropdown, Space, Tag, Tooltip, Typography } from 'antd';
import { AimOutlined, CloseOutlined, EditOutlined, MoreOutlined, ReloadOutlined } from '@ant-design/icons';
import { useFormatter, useTranslations } from 'next-intl';
import type { DataRange } from '@/services/workbookService';
import { areaRef } from './sheetData';

const { Text } = Typography;

/**
 * The data in this workbook that came from queries: where it is, where it came from, and how
 * fresh it is — "Live" ranges re-run as the viewer; "Snapshot" ranges keep their values.
 */
export function DataRangesPanel({
  ranges, sheetName, refreshing, readOnly, empty, onClose, onGoTo, onRefresh, onEdit, onUnlink,
}: {
  ranges: DataRange[];
  sheetName: (sheet: number) => string;
  refreshing: Set<string>;
  readOnly: boolean;
  empty: React.ReactNode;
  onClose: () => void;
  onGoTo: (r: DataRange) => void;
  onRefresh: (r: DataRange) => void;
  onEdit: (r: DataRange) => void;
  onUnlink: (r: DataRange, clear: boolean) => void;
}) {
  const t = useTranslations('sheets');
  const format = useFormatter();
  return (
    <aside className="wb-panel" aria-label={t('data_ranges')}>
      <div className="wb-panel__head">
        <Text strong>{t('data_ranges')}</Text>
        <Tooltip title={t('close')}>
          <Button size="small" type="text" icon={<CloseOutlined />} aria-label={t('close')} onClick={onClose} />
        </Tooltip>
      </div>
      {!ranges.length ? empty : (
        <div className="wb-panel__list">
          {ranges.map((r) => {
            const live = r.mode === 'live';
            const when = r.refreshed_at ? format.relativeTime(new Date(r.refreshed_at)) : null;
            return (
              <div key={r.id} className="wb-range">
                <div className="wb-range__top">
                  <button type="button" className="wb-range__name" onClick={() => onGoTo(r)} title={t('range_go')}>
                    {r.name || areaRef(sheetName(r.sheet), r)}
                  </button>
                  <Space size={0}>
                    {live && !readOnly ? (
                      <Tooltip title={t('range_refresh')}>
                        <Button size="small" type="text" icon={<ReloadOutlined />} loading={refreshing.has(r.id)}
                          aria-label={t('range_refresh')} onClick={() => onRefresh(r)} />
                      </Tooltip>
                    ) : null}
                    <Tooltip title={t('range_go')}>
                      <Button size="small" type="text" icon={<AimOutlined />} aria-label={t('range_go')} onClick={() => onGoTo(r)} />
                    </Tooltip>
                    {!readOnly ? (
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: [
                            ...(live ? [{ key: 'edit', icon: <EditOutlined />, label: t('range_edit') }] : []),
                            { key: 'unlink', label: live ? t('range_unlink') : t('range_forget') },
                            { key: 'delete', label: t('range_delete'), danger: true },
                          ],
                          onClick: ({ key }) => {
                            if (key === 'edit') onEdit(r);
                            if (key === 'unlink') onUnlink(r, false);
                            if (key === 'delete') onUnlink(r, true);
                          },
                        }}
                      >
                        <Button size="small" type="text" icon={<MoreOutlined />} aria-label={t('more')} />
                      </Dropdown>
                    ) : null}
                  </Space>
                </div>
                <Space size={4} wrap>
                  <Tag bordered={false} color={live ? 'processing' : 'default'}>{live ? t('range_live') : t('range_snapshot')}</Tag>
                  <Text type="secondary" className="wb-range__meta">{areaRef(sheetName(r.sheet), r)}</Text>
                </Space>
                <Text type="secondary" className="wb-range__meta">
                  {[r.source_name, r.row_count != null ? t('range_rows', { n: r.row_count }) : null, when ? t('range_as_of', { when }) : null]
                    .filter(Boolean).join(' · ')}
                </Text>
                {r.truncated ? <Text type="warning" className="wb-range__meta">{t('range_truncated_short')}</Text> : null}
                {r.pending ? <Text type="secondary" className="wb-range__meta">{t('range_pending')}</Text> : null}
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
