'use client';

/**
 * Compact SQL editor for Properties — single card, icon actions.
 * Clearing SQL is intentionally hard (confirm) so chat/QE-bound charts are not wiped by accident.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Button, Dropdown, Input, Modal, Tooltip, message } from 'antd';
import {
  SaveOutlined,
  CodeOutlined,
  MoreOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { createSavedQuery } from '@/services/savedQueryBindService';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useProjectStore } from '@/stores/useProjectStore';

const { TextArea } = Input;

type Props = {
  savedQueryId?: string | number | null;
  sampleSql?: string | null;
  dataSourceId?: string | null;
  chartTitle?: string;
  onSavedQueryBound: (
    queryId: string,
    snapshot?: { id?: string | number; name?: string; sql?: string; metadata?: Record<string, unknown> },
  ) => void | Promise<void>;
  onSampleSqlChange?: (sql: string) => void;
  onAfterSave?: () => void | Promise<void>;
  /** Switch back to table mapping — only after user confirms. */
  onSwitchToTable?: () => void;
  forceShow?: boolean;
};

function scopeQs(): string {
  const orgId = useOrganizationStore.getState().currentOrganization?.id;
  const projectId = useProjectStore.getState().currentProjectId;
  const params = new URLSearchParams();
  if (orgId) params.set('organization_id', String(orgId));
  if (projectId != null && String(projectId).trim() !== '') {
    params.set('project_id', String(projectId));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

function resolveQueryName(chartTitle?: string): string {
  return (chartTitle || '').trim() || 'Chart SQL';
}

export function SavedQuerySqlEditor({
  savedQueryId,
  sampleSql,
  dataSourceId,
  chartTitle,
  onSavedQueryBound,
  onSampleSqlChange,
  onAfterSave,
  onSwitchToTable,
  forceShow = false,
}: Props) {
  const t = useTranslations('dashboards');
  const router = useRouter();
  const [sql, setSql] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    if (savedQueryId == null || savedQueryId === '') {
      setSql(typeof sampleSql === 'string' ? sampleSql : '');
      setDirty(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetchApi<{ items?: Array<{ id?: string | number; name?: string; sql?: string }> }>(
        `queries/saved-queries${scopeQs()}`,
      );
      const list = res?.items || [];
      const found = list.find((q) => String(q.id) === String(savedQueryId));
      if (found) {
        setSql(found.sql || '');
      } else if (typeof sampleSql === 'string') {
        setSql(sampleSql);
      }
      setDirty(false);
    } catch {
      if (typeof sampleSql === 'string') setSql(sampleSql);
    } finally {
      setLoading(false);
    }
  }, [savedQueryId, sampleSql]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (savedQueryId != null && String(savedQueryId).trim() !== '') return;
    if (typeof sampleSql === 'string' && sampleSql !== sql && !dirty) {
      setSql(sampleSql);
    }
  }, [sampleSql, savedQueryId, dirty, sql]);

  const handleSave = async () => {
    const trimmed = sql.trim();
    if (!trimmed) {
      message.warning(t('sql_editor_empty'));
      return;
    }
    const name = resolveQueryName(chartTitle);
    setSaving(true);
    try {
      if (savedQueryId != null && String(savedQueryId).trim() !== '') {
        await fetchApi(`queries/saved-queries/${savedQueryId}${scopeQs()}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            sql: trimmed,
            metadata: {
              data_source_id: dataSourceId ? String(dataSourceId) : undefined,
              dataSourceId: dataSourceId ? String(dataSourceId) : undefined,
            },
          }),
        });
        await onSavedQueryBound(String(savedQueryId), {
          id: savedQueryId,
          name,
          sql: trimmed,
        });
        onSampleSqlChange?.(trimmed);
        message.success(t('sql_editor_saved'));
      } else {
        const id = await createSavedQuery({
          name,
          sql: trimmed,
          metadata: {
            source: 'properties_sql_editor',
            data_source_id: dataSourceId ? String(dataSourceId) : undefined,
            dataSourceId: dataSourceId ? String(dataSourceId) : undefined,
          },
        });
        if (!id) {
          message.error(t('sql_editor_save_failed'));
          return;
        }
        await onSavedQueryBound(id, { id, name, sql: trimmed });
        onSampleSqlChange?.(trimmed);
        message.success(t('sql_editor_promoted'));
      }
      setDirty(false);
      await onAfterSave?.();
    } catch (err) {
      console.error('[SavedQuerySqlEditor]', err);
      message.error(t('sql_editor_save_failed'));
    } finally {
      setSaving(false);
    }
  };

  const openQueryEditor = () => {
    if (savedQueryId != null && String(savedQueryId).trim() !== '') {
      router.push(`/query-editor?queryId=${encodeURIComponent(String(savedQueryId))}`);
      return;
    }
    router.push('/query-editor');
  };

  const confirmSwitchToTable = () => {
    if (!onSwitchToTable) return;
    Modal.confirm({
      title: t('switch_to_table_title'),
      content: t('switch_to_table_body'),
      okText: t('switch_to_table_ok'),
      okButtonProps: { danger: true },
      cancelText: t('switch_to_table_cancel'),
      onOk: () => onSwitchToTable(),
    });
  };

  const hasExistingSql = Boolean(
    (savedQueryId != null && String(savedQueryId).trim() !== '') ||
      (typeof sampleSql === 'string' && sampleSql.trim()),
  );

  if (!forceShow && !hasExistingSql && !dirty && !sql.trim()) {
    return null;
  }

  const moreItems = [
    {
      key: 'open-qe',
      icon: <CodeOutlined />,
      label: savedQueryId ? t('sql_editor_open_bound') : t('sql_editor_open_editor'),
      onClick: openQueryEditor,
    },
    ...(onSwitchToTable
      ? [
          { type: 'divider' as const },
          {
            key: 'switch-table',
            icon: <TableOutlined />,
            danger: true,
            label: t('switch_to_table_menu'),
            onClick: confirmSwitchToTable,
          },
        ]
      : []),
  ];

  const bound = Boolean(savedQueryId != null && String(savedQueryId).trim() !== '');

  return (
    <div className="pp-sql-block">
      <div className="pp-sql-toolbar">
        <div className="pp-sql-toolbar-left">
          <span className="pp-sql-title">{t('sql_editor_label')}</span>
          {bound ? <span className="pp-sql-badge">{t('sql_bound_badge')}</span> : null}
          {dirty ? <span className="pp-sql-dirty" title={t('sql_editor_unsaved')} /> : null}
        </div>
        <div className="pp-sql-toolbar-actions">
          <Tooltip title={bound ? t('sql_editor_save') : t('sql_editor_save_as_query')}>
            <Button
              type="text"
              size="small"
              className="pp-sql-icon-btn"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!dirty && bound}
              onClick={() => void handleSave()}
              aria-label={t('sql_editor_save')}
            />
          </Tooltip>
          <Dropdown menu={{ items: moreItems }} trigger={['click']} placement="bottomRight">
            <Tooltip title={t('sql_more_actions')}>
              <Button
                type="text"
                size="small"
                className="pp-sql-icon-btn"
                icon={<MoreOutlined />}
                aria-label={t('sql_more_actions')}
              />
            </Tooltip>
          </Dropdown>
        </div>
      </div>
      <TextArea
        className="pp-sql-textarea"
        value={sql}
        onChange={(e) => {
          setSql(e.target.value);
          setDirty(true);
          if (!savedQueryId) onSampleSqlChange?.(e.target.value);
        }}
        autoSize={{ minRows: 2, maxRows: 8 }}
        disabled={loading}
        placeholder={t('sql_editor_placeholder')}
        spellCheck={false}
      />
    </div>
  );
}

export default SavedQuerySqlEditor;
