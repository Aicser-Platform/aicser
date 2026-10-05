'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { App, Button, Card, Col, Empty, Row, Space, Spin, Tag, Tooltip, Typography } from 'antd';
import { CopyOutlined, DeleteOutlined, FolderOutlined, PlusOutlined, TableOutlined, TeamOutlined, UploadOutlined } from '@ant-design/icons';
import { DashboardPageHeader, DashboardPageShell } from '@/components/layout/DashboardPageShell';
import { useProjectStore } from '@/stores/useProjectStore';
import { AssetFilterBar, filterAssets, type AssetScope } from '@/components/assets/AssetFilterBar';
import { FolderFilter, MoveToFolderModal, inFolderView, useProjectFolders, type FolderView } from '@/components/assets/Folders';
import { workbookService, type WorkbookSummary } from '@/services/workbookService';
import './sheets.css';

const { Paragraph, Text } = Typography;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function WorkbooksList() {
  const t = useTranslations('sheets');
  const tf = useTranslations('folders');
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = useProjectStore((s) => s.currentProjectId);
  const [items, setItems] = useState<WorkbookSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<AssetScope>('all');
  // The project's folders (shared with its other assets) and the one in view.
  const { folders, reload: reloadFolders } = useProjectFolders(projectId ? String(projectId) : null);
  const [folderView, setFolderView] = useState<FolderView>('all');
  const [moving, setMoving] = useState<WorkbookSummary | null>(null);
  const shown = useMemo(
    () => (items ? inFolderView(filterAssets(items, query, scope), folderView, folders) : []),
    [items, query, scope, folderView, folders],
  );

  const load = useCallback(async () => {
    try {
      setItems((await workbookService.list(projectId ? String(projectId) : null)).items);
    } catch (err) {
      setItems([]);
      message.error(err instanceof Error ? err.message : t('load_failed'));
    }
  }, [projectId, message, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const undoDelete = useCallback((id: string) => {
    message.open({
      type: 'info',
      key: 'wb-deleted',
      duration: 8,
      content: (
        <span>
          {t('sheet_deleted')}{' '}
          <Button size="small" type="link" onClick={async () => { await workbookService.restore(id); message.destroy('wb-deleted'); void load(); }}>
            {t('undo')}
          </Button>
        </span>
      ),
    });
  }, [message, t, load]);

  useEffect(() => {
    const deleted = searchParams?.get('deleted');
    if (deleted) {
      undoDelete(deleted);
      router.replace('/sheets');
    }
  }, [searchParams, undoDelete, router]);

  const create = async () => {
    setBusy(true);
    try {
      const wb = await workbookService.create({ title: t('untitled'), project_id: projectId ? String(projectId) : null, timezone: browserZone() });
      router.push(`/sheets/${wb.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('create_failed'));
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      message.error(t('import_only_xlsx'));
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      message.error(t('import_too_large'));
      return;
    }
    setBusy(true);
    try {
      const wb = await workbookService.importXlsx(file, projectId ? String(projectId) : null, undefined, browserZone());
      if (wb.neutralized) message.warning(t('import_neutralized', { n: wb.neutralized }));
      router.push(`/sheets/${wb.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('import_failed'));
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await workbookService.remove(id);
    setItems((prev) => (prev ?? []).filter((w) => w.id !== id));
    undoDelete(id);
  };

  return (
    <DashboardPageShell className="sheets-page">
      <DashboardPageHeader
        icon={<TableOutlined />}
        title={t('title')}
        description={t('subtitle')}
        extra={
          <Space wrap>
            <input ref={fileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
            <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} disabled={busy}>{t('import_xlsx')}</Button>
            <Button type="primary" icon={<PlusOutlined />} loading={busy} onClick={() => void create()}>{t('new')}</Button>
          </Space>
        }
      />
      {items === null ? (
        <div className="wb-loading"><Spin /></div>
      ) : items.length === 0 ? (
        <Card>
          <Empty description={<Paragraph type="secondary" style={{ maxWidth: 520, margin: '0 auto' }}>{t('empty')}</Paragraph>}>
            <Space wrap>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => void create()} disabled={busy}>{t('new')}</Button>
              <Button icon={<UploadOutlined />} onClick={() => fileRef.current?.click()} disabled={busy}>{t('import_xlsx')}</Button>
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
          {shown.map((wb) => (
            <Col key={wb.id} xs={24} sm={12} md={8} lg={8} xl={6}>
              <Card
                size="small"
                title={<Link href={`/sheets/${wb.id}`} className="wb-card__title">{wb.title}</Link>}
                extra={
                  <Space size={0}>
                    <Tooltip title={t('duplicate')}>
                      <Button size="small" type="text" icon={<CopyOutlined />} aria-label={t('duplicate')}
                        onClick={async () => { const c = await workbookService.duplicate(wb.id); router.push(`/sheets/${c.id}`); }} />
                    </Tooltip>
                    {wb.is_owner ? (
                      <Tooltip title={tf('move_to_folder')}>
                        <Button size="small" type="text" icon={<FolderOutlined />} aria-label={tf('move_to_folder')} onClick={() => setMoving(wb)} />
                      </Tooltip>
                    ) : null}
                    {wb.is_owner ? (
                      <Tooltip title={t('delete')}>
                        <Button size="small" type="text" icon={<DeleteOutlined />} aria-label={t('delete')} onClick={() => void remove(wb.id)} />
                      </Tooltip>
                    ) : null}
                  </Space>
                }
              >
                <Space size={6} wrap>
                  {wb.range_count ? <Text type="secondary">{t('ranges_count', { count: wb.range_count })}</Text> : null}
                  {wb.updated_at ? <Text type="secondary">{new Date(wb.updated_at).toLocaleDateString()}</Text> : null}
                  {wb.visibility === 'project' ? <Tag icon={<TeamOutlined />} bordered={false}>{t('shared')}</Tag> : null}
                  {!wb.is_owner ? <Tag bordered={false}>{t('view_only')}</Tag> : null}
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
        assetType="sheet"
        assetId={moving?.id ?? null}
        currentFolderId={moving?.folder_id}
        projectId={projectId ? String(projectId) : null}
        onMoved={(folderId) => setItems((prev) => (prev ?? []).map((x) => (x.id === moving?.id ? { ...x, folder_id: folderId } : x)))}
      />
    </DashboardPageShell>
  );
}

export default function WorkbooksPage() {
  return (
    <Suspense fallback={<div className="wb-loading"><Spin /></div>}>
      <WorkbooksList />
    </Suspense>
  );
}
