'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { App, Button, Card, Col, Dropdown, Empty, Row, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { BookOutlined, CopyOutlined, DeleteOutlined, FolderOutlined, PlusOutlined, TeamOutlined, UploadOutlined } from '@ant-design/icons';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useProjectStore } from '@/stores/useProjectStore';
import { AssetFilterBar, filterAssets, type AssetScope } from '@/components/assets/AssetFilterBar';
import { FolderFilter, MoveToFolderModal, inFolderView, useProjectFolders, type FolderView } from '@/components/assets/Folders';
import { notebookService, type NotebookSummary } from '@/services/notebookService';
import { templateCells } from './templates';
import './notebooks.css';

const { Paragraph, Text } = Typography;

function NotebooksList() {
  const t = useTranslations('notebooks');
  const tf = useTranslations('folders');
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [items, setItems] = useState<NotebookSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<AssetScope>('all');
  // The project's folders (shared with its other assets) and the one in view.
  const { folders, reload: reloadFolders } = useProjectFolders(projectId ? String(projectId) : null);
  const [folderView, setFolderView] = useState<FolderView>('all');
  const [moving, setMoving] = useState<NotebookSummary | null>(null);
  const shown = useMemo(
    () => (items ? inFolderView(filterAssets(items, query, scope), folderView, folders) : []),
    [items, query, scope, folderView, folders],
  );

  const load = useCallback(async () => {
    try {
      const res = await notebookService.list(projectId ? String(projectId) : null);
      setItems(res.items);
    } catch (err) {
      setItems([]);
      message.error(err instanceof Error ? err.message : t('load_failed'));
    }
  }, [projectId, message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const undoDelete = useCallback(
    (id: string) => {
      message.open({
        type: 'info',
        key: 'nb-deleted',
        duration: 8,
        content: (
          <span>
            {t('notebook_deleted')}{' '}
            <Button size="small" type="link" onClick={async () => { await notebookService.restore(id); message.destroy('nb-deleted'); void load(); }}>
              {t('undo')}
            </Button>
          </span>
        ),
      });
    },
    [message, t, load],
  );

  // Deleting from inside a notebook comes back here with ?deleted= so it can be undone.
  useEffect(() => {
    const deleted = searchParams?.get('deleted');
    if (deleted) {
      undoDelete(deleted);
      router.replace('/notebooks');
    }
  }, [searchParams, undoDelete, router]);

  const create = async (key: 'blank' | 'explore' | 'python') => {
    setBusy(true);
    try {
      const nb = await notebookService.create({
        title: t(`tpl_${key}_title`),
        cells: templateCells(key, t),
        project_id: projectId ? String(projectId) : null,
      });
      router.push(`/notebooks/${nb.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('create_failed'));
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      message.error(t('import_too_large'));
      return;
    }
    setBusy(true);
    try {
      const doc = JSON.parse(await file.text());
      const nb = await notebookService.importIpynb(doc, file.name.replace(/\.ipynb$/i, ''), projectId ? String(projectId) : null);
      router.push(`/notebooks/${nb.id}`);
    } catch (err) {
      message.error(err instanceof SyntaxError ? t('import_not_json') : err instanceof Error ? err.message : t('import_failed'));
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await notebookService.remove(id);
    setItems((prev) => (prev ?? []).filter((n) => n.id !== id));
    undoDelete(id);
  };

  return (
    <DashboardPageShell className="notebooks-page">
      <DashboardPageHeader
        icon={<BookOutlined />}
        title={t('title')}
        description={t('subtitle')}
        extra={
          <Space wrap>
            <input
              ref={fileRef}
              type="file"
              accept=".ipynb,application/x-ipynb+json,application/json"
              hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }}
            />
            <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} disabled={busy}>{t('import')}</Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: (['blank', 'explore', 'python'] as const).map((k) => ({
                  key: k,
                  label: <div><div>{t(`tpl_${k}_title`)}</div><Text type="secondary" style={{ fontSize: 12 }}>{t(`tpl_${k}_desc`)}</Text></div>,
                })),
                onClick: ({ key }) => void create(key as 'blank' | 'explore' | 'python'),
              }}
            >
              <Button type="primary" icon={<PlusOutlined />} loading={busy}>{t('new')}</Button>
            </Dropdown>
          </Space>
        }
      />
      {items === null ? (
        <div className="nb-loading"><Spin /></div>
      ) : items.length === 0 ? (
        <Card>
          <Empty description={<Paragraph type="secondary" style={{ maxWidth: 520, margin: '0 auto' }}>{t('empty')}</Paragraph>}>
            <Space wrap>
              {(['explore', 'python', 'blank'] as const).map((k) => (
                <Button key={k} type={k === 'explore' ? 'primary' : 'default'} onClick={() => void create(k)} disabled={busy}>{t(`tpl_${k}_title`)}</Button>
              ))}
            </Space>
          </Empty>
        </Card>
      ) : (
        <>
        <AssetFilterBar
          query={query} onQuery={setQuery} scope={scope} onScope={setScope} placeholder={t('search_placeholder')}
          leading={<FolderFilter folders={folders} value={folderView} onChange={setFolderView}
            projectId={projectId ? String(projectId) : null} onFoldersChanged={reloadFolders} />}
        />
        {shown.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('no_match')} />
        ) : (
        <Row gutter={[12, 12]}>
          {shown.map((nb) => (
            <Col key={nb.id} xs={24} sm={12} md={8} lg={8} xl={6}>
              <Card
                size="small"
                className="nb-card"
                title={<Link href={`/notebooks/${nb.id}`} className="nb-card__title">{nb.title}</Link>}
                extra={
                  <Space size={0}>
                    <Tooltip title={t('duplicate')}>
                      <Button size="small" type="text" icon={<CopyOutlined />} aria-label={t('duplicate')}
                        onClick={async () => { const c = await notebookService.duplicate(nb.id); router.push(`/notebooks/${c.id}`); }} />
                    </Tooltip>
                    {nb.is_owner ? (
                      <Tooltip title={tf('move_to_folder')}>
                        <Button size="small" type="text" icon={<FolderOutlined />} aria-label={tf('move_to_folder')} onClick={() => setMoving(nb)} />
                      </Tooltip>
                    ) : null}
                    {nb.is_owner ? (
                      <Tooltip title={t('delete')}>
                        <Button size="small" type="text" icon={<DeleteOutlined />} aria-label={t('delete')} onClick={() => void remove(nb.id)} />
                      </Tooltip>
                    ) : null}
                  </Space>
                }
              >
                <Space size={6} wrap>
                  <Text type="secondary">{t('cells_count', { count: nb.cell_count })}</Text>
                  {nb.updated_at ? <Text type="secondary">· {new Date(nb.updated_at).toLocaleDateString()}</Text> : null}
                  {nb.visibility === 'project' ? <Tag icon={<TeamOutlined />} bordered={false}>{t('shared')}</Tag> : null}
                  {!nb.is_owner ? <Tag bordered={false}>{t('view_only')}</Tag> : null}
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
        )}
        </>
      )}
      <MoveToFolderModal
        open={moving !== null}
        onClose={() => setMoving(null)}
        folders={folders}
        assetType="notebook"
        assetId={moving?.id ?? null}
        currentFolderId={moving?.folder_id}
        projectId={projectId ? String(projectId) : null}
        onMoved={(folderId) => setItems((prev) => (prev ?? []).map((x) => (x.id === moving?.id ? { ...x, folder_id: folderId } : x)))}
      />
    </DashboardPageShell>
  );
}

export default function NotebooksPage() {
  return (
    <Suspense fallback={<div className="nb-loading"><Spin /></div>}>
      <NotebooksList />
    </Suspense>
  );
}
