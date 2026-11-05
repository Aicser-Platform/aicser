'use client';

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { App, Drawer } from 'antd';
import { HistoryList } from './HistoryList';
import { fetchApi } from '@/utils/api';

type Revision = { id: string; at: string | null; changed: string[] };

/** Earlier versions of a chart or alert. Putting one back is itself saved, so it can be undone the same way. */
export function AssetHistoryDrawer({ assetType, assetId, onClose, onRestored }: {
  assetType: 'chart' | 'alert';
  assetId: string | null;
  onClose: () => void;
  onRestored?: () => void;
}) {
  const t = useTranslations('asset_history');
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const key = ['revisions', assetType, assetId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => fetchApi<{ revisions: Revision[] }>(`/api/revisions/${assetType}/${assetId}`),
    enabled: !!assetId,
  });

  const restore = async (revisionId: string) => {
    try {
      await fetchApi(`/api/revisions/${assetType}/${assetId}/${revisionId}/restore`, { method: 'POST' });
      message.success(t('restored'));
      await queryClient.invalidateQueries({ queryKey: key });
      onRestored?.();
    } catch (e) {
      message.error(e instanceof Error ? e.message : t('restore_failed'));
    }
  };

  const revisions = data?.revisions ?? [];
  return (
    <Drawer open={!!assetId} onClose={onClose} title={t('title')} width={380} destroyOnHidden>
      <HistoryList
        loading={isLoading}
        restoreLabel={t('restore')}
        emptyLabel={t('empty')}
        onRestore={(id) => void restore(id)}
        entries={revisions.map((r) => ({
          id: r.id,
          title: r.at ? new Date(r.at).toLocaleString() : '',
          disabled: r.changed.length === 0,
          detail: r.changed.length ? t('differs', { fields: r.changed.join(', ') }) : t('same'),
        }))}
      />
    </Drawer>
  );
}
