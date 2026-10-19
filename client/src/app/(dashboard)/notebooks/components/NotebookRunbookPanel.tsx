'use client';

import React, { useEffect, useState } from 'react';
import { Button, Spin, Typography } from 'antd';
import { FieldTimeOutlined, HistoryOutlined, SafetyCertificateOutlined, DatabaseOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { isEnterpriseEdition } from '@/utils/appPaths';
import { notebookRuns } from './ScheduleDialog';

const { Text } = Typography;

export function NotebookRunbookPanel({
  notebookId,
  dataSourceId,
  dataSourceName,
  rowPreviewLimit,
  onOpenHistory,
  onOpenSchedule,
}: {
  notebookId: string;
  dataSourceId: string | null;
  dataSourceName?: string | null;
  rowPreviewLimit: number;
  onOpenHistory: () => void;
  onOpenSchedule: () => void;
}) {
  const t = useTranslations('notebooks');
  const ee = isEnterpriseEdition();
  const [scheduleLabel, setScheduleLabel] = useState<string | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  useEffect(() => {
    if (!ee || !notebookId) return;
    let live = true;
    setLoadingSchedule(true);
    void notebookRuns.schedule(notebookId)
      .then((res) => {
        if (!live) return;
        if (!res.schedule?.enabled) {
          setScheduleLabel(t('runbook_schedule_off'));
          return;
        }
        const f = res.schedule.frequency;
        setScheduleLabel(t(`schedule_${f}` as 'schedule_daily'));
      })
      .catch(() => { if (live) setScheduleLabel(null); })
      .finally(() => { if (live) setLoadingSchedule(false); });
    return () => { live = false; };
  }, [ee, notebookId, t]);

  return (
    <div className="nb-side__body nb-runbook">
      <Text type="secondary" className="nb-side__hint">{t('runbook_intro')}</Text>
      <ul className="nb-runbook__actions">
        <li>
          <Button type="text" block className="nb-runbook__btn" icon={<HistoryOutlined />} onClick={onOpenHistory}>
            {t('version_history')}
          </Button>
        </li>
        {ee ? (
          <li>
            <Button type="text" block className="nb-runbook__btn" icon={<FieldTimeOutlined />} onClick={onOpenSchedule}>
              {t('schedule_menu')}
              {loadingSchedule ? <Spin size="small" className="nb-runbook__spin" /> : scheduleLabel ? (
                <Text type="secondary" className="nb-runbook__meta">{scheduleLabel}</Text>
              ) : null}
            </Button>
          </li>
        ) : null}
      </ul>
      {dataSourceId ? (
        <div className="nb-runbook__section">
          <Text className="nb-runbook__section-title">{t('runbook_governance')}</Text>
          <Text type="secondary" className="nb-side__hint">{dataSourceName ?? t('runbook_source')}</Text>
          <Link href={`/data/sources/${encodeURIComponent(dataSourceId)}`} className="nb-runbook__link">
            <DatabaseOutlined /> {t('runbook_open_source')}
          </Link>
          <Link href={`/semantic-layer/sources/${encodeURIComponent(dataSourceId)}`} className="nb-runbook__link">
            <SafetyCertificateOutlined /> {t('runbook_semantic')}
          </Link>
        </div>
      ) : (
        <Text type="secondary" className="nb-side__hint">{t('runbook_pick_source')}</Text>
      )}
      <div className="nb-runbook__section">
        <Text className="nb-runbook__section-title">{t('runbook_execution')}</Text>
        <Text type="secondary" className="nb-side__hint">{t('runbook_row_limit', { n: rowPreviewLimit })}</Text>
        <Text type="secondary" className="nb-side__hint">{t('runbook_python_note')}</Text>
      </div>
    </div>
  );
}
