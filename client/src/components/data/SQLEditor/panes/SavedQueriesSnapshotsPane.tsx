'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Dropdown, Input, Table, Tag, Tabs, Tooltip, Typography, message } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  FolderOutlined,
  HistoryOutlined,
  ImportOutlined,
  PlusOutlined,
  SaveOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import { matchesActiveSavedQuery } from '@/utils/queryTabNaming';
import { LibraryCollectionControls } from '@/components/library/LibraryCollectionControls';
import {
  queryCollectionService,
  type QueryCollection,
} from '@/services/queryCollectionService';
import { formatApiValidationError } from '@/utils/validationErrorMessage';

const { Text } = Typography;

export type SavedQueryRow = {
  id?: number | string;
  name?: string;
  sql?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  collectionId?: number | string | null;
};

export type SnapshotRow = {
  id?: number | string;
  name?: string;
  sql?: string;
  created_at?: string;
};

export interface SavedQueriesSnapshotsPaneProps {
  savedQueries: SavedQueryRow[];
  snapshots: SnapshotRow[];
  activeTab: { key: string; title: string; savedQueryId?: number | string | null } | null;
  saveQueryName: string;
  onSaveQueryNameChange: (value: string) => void;
  onSaveCurrentQuery: () => void;
  savingCurrent?: boolean;
  onLoadToNewTab: (record: SavedQueryRow) => void;
  onLoadHere: (record: SavedQueryRow) => void;
  onShowVersions: (record: SavedQueryRow) => void;
  onDuplicateSaved: (record: SavedQueryRow) => void;
  onDeleteSaved: (record: SavedQueryRow) => void;
  onLoadSnapshotToTab: (record: SnapshotRow) => void;
  onLoadSnapshotResults: (record: SnapshotRow) => void;
  onDeleteSnapshot: (record: SnapshotRow) => void;
  /** When set, enables collection filter/CRUD for saved queries. */
  organizationId?: string | null;
  projectId?: string | null;
  onSavedQueriesChanged?: () => void;
}

function SqlPreview({ text }: { text?: string }) {
  const value = text || '';
  return (
    <Tooltip title={value} placement="topLeft">
      <Text code className="qe-saved-sql-preview">
        {value.length > 100 ? `${value.slice(0, 100)}…` : value}
      </Text>
    </Tooltip>
  );
}

function SavedQueryActions({
  record,
  t,
  collections,
  onLoadToNewTab,
  onLoadHere,
  onShowVersions,
  onDuplicateSaved,
  onDeleteSaved,
  onAssignCollection,
}: {
  record: SavedQueryRow;
  t: (key: string, values?: Record<string, unknown>) => string;
  collections: QueryCollection[];
  onLoadToNewTab: (record: SavedQueryRow) => void;
  onLoadHere: (record: SavedQueryRow) => void;
  onShowVersions: (record: SavedQueryRow) => void;
  onDuplicateSaved: (record: SavedQueryRow) => void;
  onDeleteSaved: (record: SavedQueryRow) => void;
  onAssignCollection?: (record: SavedQueryRow, collectionId: number | string | null) => void;
}) {
  return (
    <div className="qe-saved-actions" onClick={(e) => e.stopPropagation()}>
      <Tooltip title={t('tooltip_load_to_new_tab')}>
        <Button
          type="text"
          size="small"
          className="icon-only-btn qe-saved-action-btn"
          icon={<PlusOutlined />}
          aria-label={t('tooltip_load_to_new_tab')}
          onClick={() => onLoadToNewTab(record)}
        />
      </Tooltip>
      <Tooltip title={t('tooltip_load_here')}>
        <Button
          type="text"
          size="small"
          className="icon-only-btn qe-saved-action-btn"
          icon={<ImportOutlined />}
          aria-label={t('tooltip_load_here')}
          onClick={() => onLoadHere(record)}
        />
      </Tooltip>
      <Tooltip title={t('version_history')}>
        <Button
          type="text"
          size="small"
          className="icon-only-btn qe-saved-action-btn"
          icon={<HistoryOutlined />}
          aria-label={t('version_history')}
          onClick={() => onShowVersions(record)}
        />
      </Tooltip>
      <Tooltip title={t('duplicate_as_new_saved_query')}>
        <Button
          type="text"
          size="small"
          className="icon-only-btn qe-saved-action-btn"
          icon={<CopyOutlined />}
          aria-label={t('duplicate_as_new_saved_query')}
          onClick={() => onDuplicateSaved(record)}
        />
      </Tooltip>
      {onAssignCollection ? (
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              {
                key: 'unfiled',
                label: t('unassigned'),
                onClick: () => onAssignCollection(record, null),
              },
              ...collections.map((c) => ({
                key: String(c.id),
                label: c.name,
                onClick: () => onAssignCollection(record, c.id),
              })),
            ],
          }}
        >
          <Tooltip title={t('move_to_collection')}>
            <Button
              type="text"
              size="small"
              className="icon-only-btn qe-saved-action-btn"
              icon={<FolderOutlined />}
              aria-label={t('move_to_collection')}
            />
          </Tooltip>
        </Dropdown>
      ) : null}
      <Tooltip title={t('tooltip_delete_saved_query')}>
        <Button
          type="text"
          size="small"
          danger
          className="icon-only-btn qe-saved-action-btn"
          icon={<DeleteOutlined />}
          aria-label={t('tooltip_delete_saved_query')}
          onClick={() => onDeleteSaved(record)}
        />
      </Tooltip>
    </div>
  );
}

function SnapshotActions({
  record,
  t,
  onLoadSnapshotToTab,
  onLoadSnapshotResults,
  onDeleteSnapshot,
}: {
  record: SnapshotRow;
  t: (key: string, values?: Record<string, unknown>) => string;
  onLoadSnapshotToTab: (record: SnapshotRow) => void;
  onLoadSnapshotResults: (record: SnapshotRow) => void;
  onDeleteSnapshot: (record: SnapshotRow) => void;
}) {
  return (
    <div className="qe-saved-actions" onClick={(e) => e.stopPropagation()}>
      <Tooltip title={t('tooltip_load_snapshot_query')}>
        <Button
          type="text"
          size="small"
          className="icon-only-btn qe-saved-action-btn"
          icon={<ImportOutlined />}
          aria-label={t('tooltip_load_snapshot_query')}
          onClick={() => onLoadSnapshotToTab(record)}
        />
      </Tooltip>
      <Tooltip title={t('tooltip_load_snapshot_results')}>
        <Button
          type="text"
          size="small"
          className="icon-only-btn qe-saved-action-btn"
          icon={<TableOutlined />}
          aria-label={t('tooltip_load_snapshot_results')}
          onClick={() => onLoadSnapshotResults(record)}
        />
      </Tooltip>
      <Tooltip title={t('tooltip_delete_snapshot')}>
        <Button
          type="text"
          size="small"
          danger
          className="icon-only-btn qe-saved-action-btn"
          icon={<DeleteOutlined />}
          aria-label={t('tooltip_delete_snapshot')}
          onClick={() => onDeleteSnapshot(record)}
        />
      </Tooltip>
    </div>
  );
}

export function SavedQueriesSnapshotsPane({
  savedQueries,
  snapshots,
  activeTab,
  saveQueryName,
  onSaveQueryNameChange,
  onSaveCurrentQuery,
  savingCurrent,
  onLoadToNewTab,
  onLoadHere,
  onShowVersions,
  onDuplicateSaved,
  onDeleteSaved,
  onLoadSnapshotToTab,
  onLoadSnapshotResults,
  onDeleteSnapshot,
  organizationId,
  projectId,
  onSavedQueriesChanged,
}: SavedQueriesSnapshotsPaneProps) {
  const t = useTranslations('monaco_sql_editor');
  const [collections, setCollections] = useState<QueryCollection[]>([]);
  const [collectionId, setCollectionId] = useState<string | null>(null);

  const refreshCollections = async () => {
    try {
      const rows = await queryCollectionService.list(organizationId, projectId);
      setCollections(rows);
    } catch {
      setCollections([]);
    }
  };

  useEffect(() => {
    void refreshCollections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, projectId]);

  const filteredQueries = useMemo(() => {
    const rows = savedQueries.filter(Boolean);
    if (!collectionId) return rows;
    return rows.filter((q) => String(q.collectionId ?? '') === String(collectionId));
  }, [savedQueries, collectionId]);

  const assignCollection = useCallback(
    async (record: SavedQueryRow, nextCollectionId: number | string | null) => {
      if (record.id == null) return;
      try {
        await queryCollectionService.assign(
          record.id,
          nextCollectionId,
          organizationId,
          projectId,
        );
        message.success(t('collection_moved'));
        onSavedQueriesChanged?.();
      } catch (err) {
        message.error(formatApiValidationError(err));
      }
    },
    [organizationId, projectId, onSavedQueriesChanged, t],
  );

  const savedColumns: ColumnsType<SavedQueryRow> = useMemo(
    () => [
      {
        title: t('name'),
        dataIndex: 'name',
        key: 'name',
        width: 200,
        ellipsis: true,
        render: (name: string, record) => (
          <span className="qe-saved-name-cell">
            <span className="qe-saved-name">{name}</span>
            {matchesActiveSavedQuery(record, activeTab) ? (
              <Badge status="processing" text={<span className="qe-saved-active-tag">{t('active_tab_query')}</span>} />
            ) : null}
          </span>
        ),
      },
      {
        title: t('query'),
        dataIndex: 'sql',
        key: 'sql',
        ellipsis: true,
        render: (text: string) => <SqlPreview text={text} />,
      },
      {
        title: t('col_language'),
        key: 'language',
        width: 88,
        render: (_: unknown, record) => {
          const lang = String((record.metadata as { language?: string } | undefined)?.language || 'sql');
          return <Tag className="qe-saved-lang-tag">{lang.toUpperCase()}</Tag>;
        },
      },
      {
        title: t('created'),
        dataIndex: 'created_at',
        key: 'created_at',
        width: 148,
        ellipsis: true,
        render: (v: string) => (
          <span className="qe-saved-meta">{v ? new Date(v).toLocaleString() : '—'}</span>
        ),
      },
      {
        title: t('col_actions'),
        key: 'actions',
        width: 168,
        fixed: 'right',
        align: 'center',
        render: (_: unknown, record) => (
          <SavedQueryActions
            record={record}
            t={t}
            collections={collections}
            onLoadToNewTab={onLoadToNewTab}
            onLoadHere={onLoadHere}
            onShowVersions={onShowVersions}
            onDuplicateSaved={onDuplicateSaved}
            onDeleteSaved={onDeleteSaved}
            onAssignCollection={assignCollection}
          />
        ),
      },
    ],
    [
      activeTab,
      assignCollection,
      collections,
      onDeleteSaved,
      onDuplicateSaved,
      onLoadHere,
      onLoadToNewTab,
      onShowVersions,
      t,
    ],
  );

  const snapshotColumns: ColumnsType<SnapshotRow> = useMemo(
    () => [
      {
        title: t('name'),
        dataIndex: 'name',
        key: 'name',
        width: 200,
        ellipsis: true,
        render: (name: string, record) => (
          <span className="qe-saved-name-cell">
            <span className="qe-saved-name">{name}</span>
            {isSameSnapshotName(name, activeTab?.title || '') ? (
              <Badge status="processing" text={<span className="qe-saved-active-tag">{t('active_tab_query')}</span>} />
            ) : null}
          </span>
        ),
      },
      {
        title: t('query'),
        dataIndex: 'sql',
        key: 'sql',
        ellipsis: true,
        render: (text: string) => <SqlPreview text={text} />,
      },
      {
        title: t('created'),
        dataIndex: 'created_at',
        key: 'created_at',
        width: 148,
        ellipsis: true,
        render: (v: string) => (
          <span className="qe-saved-meta">{v ? new Date(v).toLocaleString() : '—'}</span>
        ),
      },
      {
        title: t('col_actions'),
        key: 'actions',
        width: 96,
        fixed: 'right',
        align: 'center',
        render: (_: unknown, record) => (
          <SnapshotActions
            record={record}
            t={t}
            onLoadSnapshotToTab={onLoadSnapshotToTab}
            onLoadSnapshotResults={onLoadSnapshotResults}
            onDeleteSnapshot={onDeleteSnapshot}
          />
        ),
      },
    ],
    [activeTab, onDeleteSnapshot, onLoadSnapshotResults, onLoadSnapshotToTab, t],
  );

  return (
    <>
      <Text type="secondary" className="qe-saved-modal-scope">
        {t('saved_modal_scope_hint')}
      </Text>
      <Tabs
        defaultActiveKey="saved"
        items={[
          {
            key: 'saved',
            label: t('saved_queries_tab_count', { count: filteredQueries.length }),
            children: (
              <div className="qe-saved-tab-body">
                <p className="qe-saved-help">{t('saved_queries_help')}</p>
                <LibraryCollectionControls
                  className="qe-saved-collections"
                  collections={collections.map((c) => ({ id: String(c.id), name: c.name }))}
                  value={collectionId}
                  onChange={setCollectionId}
                  onCollectionsChange={(next) =>
                    setCollections(next.map((c) => ({ id: c.id, name: c.name })))
                  }
                  createCollection={async (name) => {
                    const created = await queryCollectionService.create(
                      name,
                      organizationId,
                      projectId,
                    );
                    return { id: String(created.id), name: created.name };
                  }}
                  renameCollection={async (id, name) => {
                    const updated = await queryCollectionService.rename(
                      id,
                      name,
                      organizationId,
                      projectId,
                    );
                    return { id: String(updated.id), name: updated.name };
                  }}
                  deleteCollection={async (id) => {
                    await queryCollectionService.delete(id, organizationId, projectId);
                    onSavedQueriesChanged?.();
                  }}
                  labels={{
                    allCollections: t('all_collections'),
                    newCollection: t('new_collection'),
                    renameCollection: t('rename_collection'),
                    deleteCollection: t('delete_collection'),
                    deleteConfirmTitle: t('delete_collection_title'),
                    deleteConfirmBody: t('delete_collection_body'),
                    create: t('create'),
                    save: t('save'),
                    namePlaceholder: t('collection_name_placeholder'),
                    created: t('collection_created'),
                    renamed: t('collection_renamed'),
                    deleted: t('collection_deleted'),
                    manageCollection: t('manage_collection'),
                    manageCollections: t('manage_collections'),
                    noCollections: t('no_collections_yet'),
                    filterByCollection: t('filter_by_collection'),
                  }}
                />
                <div className="qe-saved-save-row">
                  <Input
                    placeholder={t('save_query_name_placeholder')}
                    value={saveQueryName}
                    onChange={(e) => onSaveQueryNameChange(e.target.value)}
                    style={{ width: 280 }}
                    size="small"
                  />
                  <Button
                    type="primary"
                    size="small"
                    icon={<SaveOutlined />}
                    loading={savingCurrent}
                    onClick={() => void onSaveCurrentQuery()}
                  >
                    {t('save_current_query')}
                  </Button>
                </div>
                <Table
                  dataSource={filteredQueries}
                  rowKey={(r) => String(r?.id ?? r?.name ?? Math.random())}
                  size="small"
                  className="qe-saved-table"
                  scroll={{ x: 720 }}
                  pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                  locale={{
                    emptyText: (
                      <div className="qe-saved-empty">
                        <p>{t('no_saved_queries_yet')}</p>
                        <p className="qe-saved-empty-sub">{t('saved_queries_empty_help')}</p>
                      </div>
                    ),
                  }}
                  columns={savedColumns}
                />
              </div>
            ),
          },
          {
            key: 'snapshots',
            label: t('snapshots_count', { count: snapshots.length }),
            children: (
              <div className="qe-saved-tab-body">
                <p className="qe-saved-help">{t('snapshots_include_desc')}</p>
                <Table
                  dataSource={snapshots.filter(Boolean)}
                  rowKey={(r) => String(r?.id ?? Math.random())}
                  size="small"
                  className="qe-saved-table"
                  scroll={{ x: 640 }}
                  pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
                  locale={{
                    emptyText: (
                      <div className="qe-saved-empty">
                        <p>{t('no_snapshots_yet')}</p>
                        <p className="qe-saved-empty-sub">{t('snapshots_empty_help')}</p>
                      </div>
                    ),
                  }}
                  columns={snapshotColumns}
                />
              </div>
            ),
          },
        ]}
      />
    </>
  );
}

function isSameSnapshotName(snapshotName: string, tabTitle: string): boolean {
  const a = (snapshotName || '').trim().toLowerCase();
  const b = (tabTitle || '').trim().toLowerCase();
  if (!a || !b) return false;
  if (a === b) return true;
  return a === `snapshot: ${b}` || a.startsWith(`${b} —`);
}
