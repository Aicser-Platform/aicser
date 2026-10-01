'use client';

import React, { useEffect, useState } from 'react';
import { App, Button, Drawer, Empty, List, Modal, Space, Spin, Tag, Typography } from 'antd';
import { EyeOutlined, HistoryOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { IronCalc, Model } from '@ironcalc/workbook';
import { fromBase64, workbookService, type WorkbookVersionSummary } from '@/services/workbookService';

const { Text } = Typography;

/** A workbook's saved points: preview any of them read-only, and (owner) put one back. */
export function WorkbookHistoryDrawer({
  open, workbookId, canRestore, themeVariables, dark, onClose, onRestored,
}: {
  open: boolean;
  workbookId: string;
  canRestore: boolean;
  themeVariables: Record<string, string>;
  /** The app is in dark mode (the editor's stylesheet covers the preview too). */
  dark: boolean;
  onClose: () => void;
  onRestored: () => void;
}) {
  const t = useTranslations('sheets');
  const { message } = App.useApp();
  const [items, setItems] = useState<WorkbookVersionSummary[] | null>(null);
  const [preview, setPreview] = useState<{ id: string; model: Model; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [previewEl, setPreviewEl] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setItems(null);
    workbookService.versions(workbookId).then((r) => setItems(r.items)).catch(() => setItems([]));
  }, [open, workbookId]);

  const show = async (v: WorkbookVersionSummary) => {
    setBusy(v.id);
    try {
      const full = await workbookService.version(workbookId, v.id);
      setPreview({ id: v.id, title: full.title, model: Model.from_bytes(fromBase64(full.doc), 'en') });
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('load_failed'));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (id: string) => {
    setBusy(id);
    try {
      await workbookService.restoreVersion(workbookId, id);
      message.success(t('version_restored'));
      setPreview(null);
      onRestored();
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('version_restore_failed'));
    } finally {
      setBusy(null);
    }
  };

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

  return (
    <>
      <Drawer open={open} onClose={onClose} width={440} title={<Space><HistoryOutlined />{t('version_history')}</Space>}>
        {items === null ? <Spin /> : !items.length ? <Empty description={t('version_none')} /> : (
          <List
            dataSource={items}
            renderItem={(v) => (
              <List.Item
                actions={[
                  <Button key="p" size="small" icon={<EyeOutlined />} loading={busy === v.id} onClick={() => void show(v)}>{t('version_preview')}</Button>,
                ]}
              >
                <Space direction="vertical" size={0}>
                  <Text strong>{when(v.updated_at)}</Text>
                  <Space size={6} wrap>
                    <Text type="secondary">{v.is_me ? t('version_by_you') : t('version_by_other')}</Text>
                    {v.reason !== 'save' ? <Tag bordered={false}>{t(`version_reason_${v.reason}`)}</Tag> : null}
                  </Space>
                </Space>
              </List.Item>
            )}
          />
        )}
      </Drawer>
      <Modal
        open={preview !== null}
        onCancel={() => setPreview(null)}
        width="min(1200px, 94vw)"
        title={preview?.title}
        destroyOnHidden
        footer={
          <Space>
            <Button onClick={() => setPreview(null)}>{t('close')}</Button>
            {canRestore && preview ? (
              <Button type="primary" loading={busy === preview.id} onClick={() => void restore(preview.id)}>{t('version_restore')}</Button>
            ) : null}
          </Space>
        }
      >
        {preview ? (
          <div ref={setPreviewEl} className={`wb-preview${dark ? ' wb-grid--dark' : ''}`}>
            {previewEl ? (
              <div className="wb-fill">
                <IronCalc key={dark ? 'dark' : 'light'} rootContainer={previewEl} model={preview.model} canEdit={false} themeVariables={themeVariables} />
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
