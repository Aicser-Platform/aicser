'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { App, Button, Drawer, Empty, List, Space, Spin, Tag, Typography } from 'antd';
import { HistoryOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { notebookService, type NotebookCell, type NotebookVersionSummary } from '@/services/notebookService';

const { Text } = Typography;

type Change = 'same' | 'changed' | 'removed';

/**
 * A notebook's saved points, newest first. Picking one shows its cells marked against the
 * notebook as it is now; the owner can put it back (which is itself recorded, so it can be undone).
 */
export function VersionHistoryDrawer({
  open, notebookId, current, canRestore, onClose, onRestored,
}: {
  open: boolean;
  notebookId: string;
  current: NotebookCell[];
  canRestore: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const t = useTranslations('notebooks');
  const { message } = App.useApp();
  const [items, setItems] = useState<NotebookVersionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cells, setCells] = useState<NotebookCell[] | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    setSelected(null);
    setCells(null);
    notebookService.versions(notebookId).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [open, notebookId]);

  useEffect(() => {
    if (!selected) return;
    setCells(null);
    notebookService.version(notebookId, selected).then((v) => setCells(v.cells)).catch(() => setCells([]));
  }, [selected, notebookId]);

  const byId = useMemo(() => new Map(current.map((c) => [c.id, c])), [current]);
  const change = (c: NotebookCell): Change => {
    const now = byId.get(c.id);
    if (!now) return 'removed';
    return now.source === c.source && now.type === c.type ? 'same' : 'changed';
  };
  const addedSince = cells ? current.filter((c) => !cells.some((v) => v.id === c.id)).length : 0;

  const restore = async () => {
    if (!selected) return;
    setRestoring(true);
    try {
      await notebookService.restoreVersion(notebookId, selected);
      message.success(t('version_restored'));
      onRestored();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('version_restore_failed'));
    } finally {
      setRestoring(false);
    }
  };

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={560}
      title={<Space><HistoryOutlined />{t('version_history')}</Space>}
      extra={selected && canRestore ? (
        <Button type="primary" loading={restoring} onClick={() => void restore()}>{t('version_restore')}</Button>
      ) : null}
    >
      {items === null ? <Spin /> : !items.length ? <Empty description={t('version_none')} /> : (
        <div className="nb-history">
          <List
            size="small"
            className="nb-history__list"
            dataSource={items}
            renderItem={(v) => (
              <List.Item
                className={v.id === selected ? 'nb-history__item nb-history__item--on' : 'nb-history__item'}
                onClick={() => setSelected(v.id)}
              >
                <Space direction="vertical" size={0}>
                  <Text strong>{when(v.updated_at)}</Text>
                  <Space size={6} wrap>
                    <Text type="secondary">{v.is_me ? t('version_by_you') : t('version_by_other')}</Text>
                    <Text type="secondary">· {t('version_cells', { n: v.cell_count })}</Text>
                    {v.reason !== 'save' ? <Tag bordered={false}>{t(`version_reason_${v.reason}`)}</Tag> : null}
                  </Space>
                </Space>
              </List.Item>
            )}
          />
          {selected ? (
            <div className="nb-history__preview">
              {cells === null ? <Spin /> : (
                <>
                  <Text type="secondary">
                    {t('version_compare_note')}
                    {addedSince ? ` ${t('version_added_since', { n: addedSince })}` : ''}
                  </Text>
                  {cells.map((c) => {
                    const k = change(c);
                    return (
                      <div key={c.id} className={`nb-history__cell nb-history__cell--${k}`}>
                        <Space size={6}>
                          <Tag bordered={false}>{t(`type_${c.type}`)}</Tag>
                          {k !== 'same' ? <Tag color={k === 'changed' ? 'gold' : 'red'} bordered={false}>{t(`version_${k}`)}</Tag> : null}
                        </Space>
                        {c.source ? <pre>{c.source}</pre> : null}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          ) : <Text type="secondary">{t('version_pick')}</Text>}
        </div>
      )}
    </Drawer>
  );
}
