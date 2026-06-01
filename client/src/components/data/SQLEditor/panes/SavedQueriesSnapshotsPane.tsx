'use client';

import React, { useMemo } from 'react';
import { Badge, Button, Input, Table, Tag, Tabs, Tooltip, Typography } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  HistoryOutlined,
  ImportOutlined,
  PlusOutlined,
  SaveOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { ColumnsType } from 'antd/es/table';
import { matchesActiveSavedQuery } from '@/utils/queryTabNaming';

const { Text } = Typography;

export type SavedQueryRow = {
  id?: number | string;
  name?: string;
  sql?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
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
  onLoadToNewTab,
  onLoadHere,
  onShowVersions,
  onDuplicateSaved,
  onDeleteSaved,
}: {
  record: SavedQueryRow;
  t: (key: string, values?: Record<string, unknown>) => string;
  onLoadToNewTab: (record: SavedQueryRow) => void;
  onLoadHere: (record: SavedQueryRow) => void;
  onShowVersions: (record: SavedQueryRow) => void;
  onDuplicateSaved: (record: SavedQueryRow) => void;
  onDeleteSaved: (record: SavedQueryRow) => void;
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
}: SavedQueriesSnapshotsPaneProps) {
  const t = useTranslations('monaco_sql_editor');

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
        width: 140,
        fixed: 'right',
        align: 'center',
        render: (_: unknown, record) => (
          <SavedQueryActions
            record={record}
            t={t}
            onLoadToNewTab={onLoadToNewTab}
            onLoadHere={onLoadHere}
            onShowVersions={onShowVersions}
            onDuplicateSaved={onDuplicateSaved}
            onDeleteSaved={onDeleteSaved}
          />
        ),
      },
    ],
    [
      activeTab,
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
            {activeTab && isSameSnapshotName(name, activeTab.title) ? (
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
            label: t('saved_queries_tab_count', { count: savedQueries.length }),
            children: (
              <div className="qe-saved-tab-body">
                <p className="qe-saved-help">{t('saved_queries_help')}</p>
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
                  dataSource={savedQueries.filter(Boolean)}
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
