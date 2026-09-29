'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, Dropdown, Input, Modal, Space, Tooltip, TreeSelect } from 'antd';
import { DeleteOutlined, EditOutlined, FolderAddOutlined, FolderOutlined, MoreOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { folderAndDescendants, folderService, folderTree, type Folder, type FolderAsset } from '@/services/folderService';

/** What a list shows: every item, the unfiled ones, or one folder (with its subfolders). */
export type FolderView = 'all' | 'unfiled' | string;

const ALL = '__all__';
const UNFILED = '__unfiled__';

/** The current project's folder tree (shared by every asset type), with a reload. */
export function useProjectFolders(projectId?: string | null) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const reload = useCallback(async () => {
    try {
      setFolders(await folderService.list(projectId));
    } catch {
      setFolders([]);
    }
  }, [projectId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { folders, reload };
}

/** Keep the items in view for the chosen folder. */
export function inFolderView<T extends { folder_id?: string | null }>(items: T[], view: FolderView, folders: Folder[]): T[] {
  if (view === 'all') return items;
  if (view === 'unfiled') return items.filter((it) => !it.folder_id);
  const ids = folderAndDescendants(folders, view);
  return items.filter((it) => it.folder_id && ids.has(it.folder_id));
}

async function askName(modal: ReturnType<typeof App.useApp>['modal'], title: string, placeholder: string, initial = ''): Promise<string | null> {
  let value = initial;
  return new Promise((resolve) => {
    modal.confirm({
      title,
      icon: <FolderOutlined />,
      content: (
        <Input autoFocus defaultValue={initial} maxLength={120} placeholder={placeholder}
          onChange={(e) => { value = e.target.value; }} onPressEnter={() => undefined} />
      ),
      onOk: () => resolve(value.trim() || null),
      onCancel: () => resolve(null),
    });
  });
}

/**
 * Folder filter for a project library, with New folder and (for the chosen folder) Rename and
 * Delete. Folders are the project's, so a folder made here also appears for its other assets.
 */
export function FolderFilter({
  folders, value, onChange, projectId, onFoldersChanged, canEdit = true,
}: {
  folders: Folder[];
  value: FolderView;
  onChange: (v: FolderView) => void;
  projectId?: string | null;
  onFoldersChanged: () => void | Promise<void>;
  canEdit?: boolean;
}) {
  const t = useTranslations('folders');
  const { message, modal } = App.useApp();
  const tree = useMemo(() => folderTree(folders), [folders]);
  const current = value !== 'all' && value !== 'unfiled' ? folders.find((f) => f.id === value) : undefined;

  const create = async () => {
    const name = await askName(modal, current ? t('new_subfolder_in', { name: current.name }) : t('new_folder'), t('folder_name'));
    if (!name) return;
    try {
      const f = await folderService.create(name, projectId, current?.id ?? null);
      await onFoldersChanged();
      onChange(f.id);
      message.success(t('created', { name: f.name }));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('failed'));
    }
  };
  const rename = async () => {
    if (!current) return;
    const name = await askName(modal, t('rename_folder'), t('folder_name'), current.name);
    if (!name || name === current.name) return;
    try {
      await folderService.rename(current.id, name, projectId);
      await onFoldersChanged();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('failed'));
    }
  };
  const remove = () => {
    if (!current) return;
    modal.confirm({
      title: t('delete_title', { name: current.name }),
      content: t('delete_body'),
      okText: t('delete'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await folderService.remove(current.id, projectId);
          onChange('all');
          await onFoldersChanged();
        } catch (err) {
          message.error(err instanceof Error ? err.message : t('failed'));
        }
      },
    });
  };

  return (
    <Space size={6} wrap>
      <TreeSelect
        value={value === 'all' ? ALL : value === 'unfiled' ? UNFILED : value}
        onChange={(v: string) => onChange(v === ALL ? 'all' : v === UNFILED ? 'unfiled' : v)}
        treeData={[{ value: ALL, title: t('all_items') }, { value: UNFILED, title: t('unfiled') }, ...tree]}
        treeDefaultExpandAll
        style={{ minWidth: 180 }}
        popupMatchSelectWidth={false}
        prefix={<FolderOutlined />}
        aria-label={t('folder')}
      />
      {canEdit ? (
        <Tooltip title={current ? t('new_subfolder_in', { name: current.name }) : t('new_folder')}>
          <Button icon={<FolderAddOutlined />} onClick={() => void create()} aria-label={t('new_folder')} />
        </Tooltip>
      ) : null}
      {canEdit && current ? (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'rename', icon: <EditOutlined />, label: t('rename') },
              { key: 'delete', icon: <DeleteOutlined />, label: t('delete'), danger: true },
            ],
            onClick: ({ key }) => (key === 'rename' ? void rename() : remove()),
          }}
        >
          <Button icon={<MoreOutlined />} aria-label={t('folder_actions')} />
        </Dropdown>
      ) : null}
    </Space>
  );
}

/** "Move to folder" for one asset: pick a folder of its project (or none). */
export function MoveToFolderModal({
  open, onClose, folders, assetType, assetId, currentFolderId, projectId, onMoved,
}: {
  open: boolean;
  onClose: () => void;
  folders: Folder[];
  assetType: FolderAsset;
  assetId: string | null;
  currentFolderId?: string | null;
  projectId?: string | null;
  onMoved: (folderId: string | null) => void;
}) {
  const t = useTranslations('folders');
  const { message } = App.useApp();
  const [target, setTarget] = useState<string>(UNFILED);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setTarget(currentFolderId || UNFILED);
  }, [open, currentFolderId]);
  const tree = useMemo(() => folderTree(folders), [folders]);

  const move = async () => {
    if (!assetId) return;
    setBusy(true);
    try {
      const folderId = target === UNFILED ? null : target;
      await folderService.file(assetType, assetId, folderId, projectId);
      onMoved(folderId);
      message.success(folderId ? t('moved', { name: folders.find((f) => f.id === folderId)?.name ?? '' }) : t('moved_out'));
      onClose();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onCancel={onClose} onOk={() => void move()} okText={t('move')} confirmLoading={busy}
      title={t('move_to_folder')} destroyOnHidden>
      <TreeSelect
        value={target}
        onChange={(v: string) => setTarget(v)}
        treeData={[{ value: UNFILED, title: t('no_folder') }, ...tree]}
        treeDefaultExpandAll
        style={{ width: '100%' }}
        aria-label={t('folder')}
      />
    </Modal>
  );
}
