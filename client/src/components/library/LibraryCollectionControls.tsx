'use client';

/**
 * Shared library collection CRUD — Chart Designer + Dashboard Studio.
 *
 * Delete impact (industry default): removes the folder only; items become unfiled.
 * Charts/dashboards themselves are never deleted by this control.
 */

import React, { useMemo, useState } from 'react';
import { Button, Dropdown, Input, List, Modal, Select, Space, Tooltip, Typography, message } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOutlined,
  MoreOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { formatApiValidationError } from '@/utils/validationErrorMessage';

export type LibraryCollectionOption = {
  id: string;
  name: string;
};

type Labels = {
  allCollections: string;
  newCollection: string;
  renameCollection: string;
  deleteCollection: string;
  deleteConfirmTitle: string;
  deleteConfirmBody: string;
  create: string;
  save: string;
  namePlaceholder: string;
  created: string;
  renamed: string;
  deleted: string;
  manageCollection: string;
  manageCollections?: string;
  noCollections?: string;
  filterByCollection?: string;
};

type Props = {
  collections: LibraryCollectionOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCollectionsChange: (next: LibraryCollectionOption[]) => void;
  createCollection: (name: string) => Promise<LibraryCollectionOption>;
  renameCollection: (id: string, name: string) => Promise<LibraryCollectionOption>;
  deleteCollection: (id: string) => Promise<void>;
  labels: Labels;
  /** Extra trailing controls (e.g. Chart Designer "Add chart") */
  extra?: React.ReactNode;
  className?: string;
};

export function LibraryCollectionControls({
  collections,
  value,
  onChange,
  onCollectionsChange,
  createCollection,
  renameCollection,
  deleteCollection,
  labels,
  extra,
  className,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [renameTarget, setRenameTarget] = useState<LibraryCollectionOption | null>(null);
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => collections.find((c) => c.id === value) || null,
    [collections, value],
  );

  const manageTitle = labels.manageCollections || labels.manageCollection;

  const openCreate = () => {
    setDraftName('');
    setCreateOpen(true);
  };

  const openRename = (target?: LibraryCollectionOption | null) => {
    const row = target ?? selected;
    if (!row) return;
    setRenameTarget(row);
    setDraftName(row.name);
    setRenameOpen(true);
  };

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const created = await createCollection(name);
      onCollectionsChange([...collections, created]);
      onChange(created.id);
      setCreateOpen(false);
      setDraftName('');
      message.success(labels.created);
    } catch (err) {
      message.error(formatApiValidationError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget) return;
    const name = draftName.trim();
    if (!name) return;
    setBusy(true);
    try {
      const updated = await renameCollection(renameTarget.id, name);
      onCollectionsChange(
        collections.map((c) => (c.id === updated.id ? { ...c, name: updated.name } : c)),
      );
      setRenameOpen(false);
      setRenameTarget(null);
      message.success(labels.renamed);
    } catch (err) {
      message.error(formatApiValidationError(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = (target: LibraryCollectionOption) => {
    Modal.confirm({
      title: labels.deleteConfirmTitle.replace('{name}', target.name),
      content: labels.deleteConfirmBody,
      okText: labels.deleteCollection,
      okType: 'danger',
      onOk: async () => {
        try {
          await deleteCollection(target.id);
          onCollectionsChange(collections.filter((c) => c.id !== target.id));
          if (value === target.id) onChange(null);
          message.success(labels.deleted);
        } catch (err) {
          message.error(formatApiValidationError(err));
          throw err;
        }
      },
    });
  };

  const quickMenuItems = [
    {
      key: 'manage',
      icon: <SettingOutlined />,
      label: manageTitle,
      disabled: collections.length === 0,
      onClick: () => setManageOpen(true),
    },
    {
      key: 'rename',
      icon: <EditOutlined />,
      label: labels.renameCollection,
      disabled: !selected,
      onClick: () => openRename(selected),
    },
    {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: labels.deleteCollection,
      danger: true,
      disabled: !selected,
      onClick: () => selected && confirmDelete(selected),
    },
  ];

  return (
    <>
      <div className={`library-collection-controls ${className || ''}`.trim()}>
        <Select
          size="small"
          allowClear
          className="library-collection-select"
          placeholder={labels.filterByCollection || labels.allCollections}
          value={value ?? undefined}
          onChange={(v) => onChange(v ?? null)}
          options={collections.map((c) => ({ value: c.id, label: c.name }))}
          suffixIcon={<FolderOutlined />}
        />
        <div className="library-collection-actions">
          <Tooltip title={labels.newCollection}>
            <Button
              size="small"
              icon={<FolderAddOutlined />}
              aria-label={labels.newCollection}
              onClick={openCreate}
            />
          </Tooltip>
          <Tooltip title={manageTitle}>
            <Dropdown
              menu={{ items: quickMenuItems }}
              trigger={['click']}
              disabled={collections.length === 0}
            >
              <Button
                size="small"
                icon={<MoreOutlined />}
                aria-label={manageTitle}
                disabled={collections.length === 0}
              />
            </Dropdown>
          </Tooltip>
          {extra ? <div className="library-collection-extra">{extra}</div> : null}
        </div>
      </div>

      <Modal
        title={labels.newCollection}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void handleCreate()}
        okText={labels.create}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={labels.namePlaceholder}
          maxLength={80}
          showCount
          onPressEnter={() => void handleCreate()}
        />
      </Modal>

      <Modal
        title={labels.renameCollection}
        open={renameOpen}
        onCancel={() => {
          setRenameOpen(false);
          setRenameTarget(null);
        }}
        onOk={() => void handleRename()}
        okText={labels.save}
        confirmLoading={busy}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={labels.namePlaceholder}
          maxLength={80}
          showCount
          onPressEnter={() => void handleRename()}
        />
      </Modal>

      <Modal
        title={manageTitle}
        open={manageOpen}
        onCancel={() => setManageOpen(false)}
        footer={null}
        destroyOnHidden
        width={420}
      >
        {collections.length === 0 ? (
          <Typography.Text type="secondary">
            {labels.noCollections || labels.allCollections}
          </Typography.Text>
        ) : (
          <List
            size="small"
            dataSource={collections}
            renderItem={(item) => (
              <List.Item
                actions={[
                  <Tooltip key="rename" title={labels.renameCollection}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      aria-label={labels.renameCollection}
                      onClick={() => openRename(item)}
                    />
                  </Tooltip>,
                  <Tooltip key="delete" title={labels.deleteCollection}>
                    <Button
                      type="text"
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={labels.deleteCollection}
                      onClick={() => confirmDelete(item)}
                    />
                  </Tooltip>,
                ]}
              >
                <Space>
                  <FolderOutlined />
                  <span
                    style={{ cursor: 'pointer' }}
                    title={labels.filterByCollection || labels.allCollections}
                    onClick={() => {
                      onChange(item.id);
                      setManageOpen(false);
                    }}
                  >
                    {item.name}
                  </span>
                </Space>
              </List.Item>
            )}
          />
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          {labels.deleteConfirmBody}
        </Typography.Paragraph>
      </Modal>
    </>
  );
}

export default LibraryCollectionControls;
