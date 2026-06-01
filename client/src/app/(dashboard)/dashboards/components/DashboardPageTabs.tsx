'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Button, Input, Modal, message, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import {
  PlusOutlined,
  MoreOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  ArrowLeftOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import './DashboardPageTabs.css';

export type DashboardPageItem = {
  id: string;
  name: string;
  page_order?: number;
  filters?: import('@/types/dashboard').DashboardFilter[];
};

type Props = {
  pages: DashboardPageItem[];
  activePageId: string | null;
  defaultPageId?: string | null;
  onSelect: (pageId: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (pageId: string, name: string) => Promise<void>;
  onDelete: (pageId: string, moveWidgetsToPageId?: string) => Promise<void>;
  onReorder?: (pageIds: string[]) => Promise<void>;
  onSetDefault?: (pageId: string) => Promise<void>;
  readOnly?: boolean;
  showEmptyPlaceholder?: boolean;
  embedded?: boolean;
};

export function DashboardPageTabs({
  pages,
  activePageId,
  defaultPageId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onReorder,
  onSetDefault,
  readOnly = false,
  showEmptyPlaceholder = false,
  embedded = false,
}: Props) {
  const t = useTranslations('dashboards');
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState('');
  const [deletingPage, setDeletingPage] = useState<DashboardPageItem | null>(null);
  const [moveWidgetsTo, setMoveWidgetsTo] = useState<string | undefined>();
  const addInputRef = useRef<HTMLInputElement>(null);

  const displayPages =
    pages.length > 0
      ? pages
      : showEmptyPlaceholder
        ? [{ id: '__placeholder__', name: t('new_page_default') }]
        : [];

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  const pageActions = (page: DashboardPageItem): MenuProps['items'] => {
    if (readOnly || page.id === '__placeholder__') return [];
    const idx = pages.findIndex((p) => p.id === page.id);
    return [
      ...(onSetDefault
        ? [
            {
              key: 'default',
              icon: defaultPageId === page.id ? <StarFilled /> : <StarOutlined />,
              label: defaultPageId === page.id ? t('default_page') : t('set_default_page'),
              disabled: defaultPageId === page.id,
              onClick: () => void onSetDefault(page.id),
            },
          ]
        : []),
      ...(onReorder && idx > 0
        ? [
            {
              key: 'move-left',
              icon: <ArrowLeftOutlined />,
              label: t('move_page_left'),
              onClick: () => {
                const ids = pages.map((p) => p.id);
                [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
                void onReorder(ids);
              },
            },
          ]
        : []),
      ...(onReorder && idx >= 0 && idx < pages.length - 1
        ? [
            {
              key: 'move-right',
              icon: <ArrowRightOutlined />,
              label: t('move_page_right'),
              onClick: () => {
                const ids = pages.map((p) => p.id);
                [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
                void onReorder(ids);
              },
            },
          ]
        : []),
      { type: 'divider' as const },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: t('delete_page_title'),
        danger: true,
        disabled: pages.length <= 1,
        onClick: () => {
          setDeletingPage(page);
          const other = pages.find((p) => p.id !== page.id);
          setMoveWidgetsTo(other?.id);
        },
      },
    ];
  };

  const commitInlineRename = async (pageId: string) => {
    const name = inlineEditValue.trim();
    setInlineEditId(null);
    if (!name) return;
    const page = pages.find((p) => p.id === pageId);
    if (page && page.name !== name) {
      await onRename(pageId, name);
      message.success(t('page_renamed'));
    }
  };

  const handleQuickAdd = async () => {
    const name = newName.trim() || t('new_page_default');
    await onCreate(name);
    setNewName('');
    setAdding(false);
    message.success(t('page_created'));
  };

  const handleDelete = async () => {
    if (!deletingPage) return;
    if (pages.length <= 1) {
      message.warning(t('cannot_delete_last_page'));
      setDeletingPage(null);
      return;
    }
    await onDelete(deletingPage.id, moveWidgetsTo);
    setDeletingPage(null);
  };

  if (!readOnly && !showEmptyPlaceholder && pages.length === 0) return null;

  const activeKey = activePageId || displayPages[0]?.id;

  return (
    <div className={`dashboard-page-tabs-bar ${embedded ? 'embedded' : ''}`}>
      <div className="dashboard-page-tabs-row">
        {displayPages.map((page) => {
          const isActive = page.id === activeKey;
          const isPlaceholder = page.id === '__placeholder__';
          const isEditing = inlineEditId === page.id;

          return (
            <div
              key={page.id}
              className={`dashboard-page-tab ${isActive ? 'active' : ''} ${isPlaceholder ? 'placeholder' : ''}`}
            >
              {defaultPageId === page.id && !isPlaceholder ? (
                <StarFilled className="dashboard-page-default-star" />
              ) : null}

              {isEditing ? (
                <Input
                  size="small"
                  className="dashboard-page-inline-input"
                  value={inlineEditValue}
                  autoFocus
                  onChange={(e) => setInlineEditValue(e.target.value)}
                  onBlur={() => void commitInlineRename(page.id)}
                  onPressEnter={() => void commitInlineRename(page.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setInlineEditId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <button
                  type="button"
                  className="dashboard-page-tab-label"
                  onClick={() => {
                    if (!isPlaceholder) onSelect(page.id);
                  }}
                  onDoubleClick={(e) => {
                    e.preventDefault();
                    if (readOnly || isPlaceholder) return;
                    setInlineEditId(page.id);
                    setInlineEditValue(page.name);
                  }}
                  title={readOnly ? page.name : t('page_rename_hint')}
                >
                  {page.name}
                </button>
              )}

              {!readOnly && !isPlaceholder && !isEditing ? (
                <Dropdown menu={{ items: pageActions(page) }} trigger={['click']}>
                  <Button
                    type="text"
                    size="small"
                    className="dashboard-page-tab-menu"
                    icon={<MoreOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Dropdown>
              ) : null}
            </div>
          );
        })}

        {!readOnly && (
          <>
            {adding ? (
              <Input
                ref={addInputRef}
                size="small"
                className="dashboard-page-add-input"
                placeholder={t('page_name_placeholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={() => {
                  if (newName.trim()) void handleQuickAdd();
                  else setAdding(false);
                }}
                onPressEnter={() => void handleQuickAdd()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAdding(false);
                    setNewName('');
                  }
                }}
              />
            ) : (
              <Button
                type="text"
                size="small"
                className="dashboard-page-add-btn"
                icon={<PlusOutlined />}
                aria-label={t('add_page')}
                onClick={() => setAdding(true)}
              />
            )}
          </>
        )}
      </div>

      <Modal
        title={t('delete_page_title')}
        open={!!deletingPage}
        onOk={() => void handleDelete()}
        onCancel={() => setDeletingPage(null)}
        okButtonProps={{ danger: true }}
        okText={t('remove')}
      >
        <p>{t('delete_page_confirm', { name: deletingPage?.name || '' })}</p>
        {pages.length > 2 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 6, fontSize: 12, color: 'var(--studio-text-muted)' }}>
              {t('move_widgets_to_page')}
            </div>
            <select
              className="dashboard-page-move-select"
              value={moveWidgetsTo || ''}
              onChange={(e) => setMoveWidgetsTo(e.target.value)}
            >
              {pages
                .filter((p) => p.id !== deletingPage?.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </div>
        )}
      </Modal>
    </div>
  );
}

export default DashboardPageTabs;
