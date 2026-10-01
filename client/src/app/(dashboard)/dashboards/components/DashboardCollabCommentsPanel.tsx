'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Avatar, Badge, Button, Checkbox, Drawer, Dropdown, Empty, Input, Segmented, Spin, Tag, Typography, message } from 'antd';
import {
  CheckCircleOutlined,
  CommentOutlined,
  EllipsisOutlined,
  RedoOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useFormatter, useTranslations } from 'next-intl';
import { useAuthStore } from '@/stores/useAuthStore';
import { useDashboardComments } from '../hooks/useDashboardComments';
import type { DashboardComment, DashboardCommentThread } from '../utils/collaborationTypes';

const MAX_BODY = 4000;
const UNDO_MS = 6000;

type Props = {
  dashboardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedWidgetId?: string | null;
  /** Title of a widget on this dashboard, to label threads attached to it. */
  widgetTitle?: (widgetId: string) => string | undefined;
  /** Dashboard editors may remove anyone's comment (the server checks this too). */
  canModerate?: boolean;
  /** Called after a new top-level comment is saved (e.g. to mirror it to the linked feed post). */
  onCommentPosted?: (body: string, widgetId: string | null) => void;
  /** Toolbar trigger sits in the dashboard header (scrolls with chrome). */
  variant?: 'toolbar' | 'floating';
  /** Another resource with the same comments API (e.g. '/api/notebooks'); default dashboards. */
  apiRoot?: string;
  /** Wording for what threads attach to, when it isn't a dashboard widget (e.g. a notebook cell). */
  anchorTerms?: { attach: (name: string) => string; on: string; only: string; selected: string };
  /** Match the host toolbar's button size. */
  triggerSize?: 'small' | 'middle';
};

type Filter = 'open' | 'resolved';

export function DashboardCollabCommentsPanel({
  dashboardId,
  open,
  onOpenChange,
  selectedWidgetId,
  widgetTitle,
  canModerate = false,
  onCommentPosted,
  variant = 'toolbar',
  apiRoot,
  anchorTerms,
  triggerSize = 'small',
}: Props) {
  const t = useTranslations('dashboards');
  const format = useFormatter();
  const selfId = useAuthStore((s) => s.user?.id ?? null);
  const { threads, loading, error, openCount, reload, add, edit, setResolved, remove } = useDashboardComments(dashboardId, true, apiRoot);

  const [filter, setFilter] = useState<Filter>('open');
  const [onlyWidget, setOnlyWidget] = useState(true);
  const [draft, setDraft] = useState('');
  const [attachToWidget, setAttachToWidget] = useState(true);
  // Which action is saving: 'new', 'edit', or a thread id (reply / resolve).
  const [busy, setBusy] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  // Deletes wait a few seconds with Undo (instead of a confirmation dialog) before reaching the server.
  const [pendingDelete, setPendingDelete] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (open) void reload(); // catch up on anything missed while closed without a live socket
  }, [open, reload]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const fail = (e: unknown) => message.error(e instanceof Error && e.message ? e.message : t('collab_comments_error'));

  const visible = useMemo(() => {
    const scoped = selectedWidgetId && onlyWidget ? threads.filter((c) => c.widget_id === selectedWidgetId) : threads;
    return scoped
      .map((c) => ({ ...c, replies: c.replies.filter((r) => !pendingDelete.has(r.id)) }))
      .filter((c) => !pendingDelete.has(c.id) && (filter === 'resolved' ? !!c.resolved_at : !c.resolved_at));
  }, [threads, selectedWidgetId, onlyWidget, filter, pendingDelete]);

  const resolvedCount = threads.filter((c) => c.resolved_at && !c.deleted).length;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      return true;
    } catch (e) {
      fail(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    const body = draft.trim();
    if (!body) return;
    const widgetId = selectedWidgetId && attachToWidget ? selectedWidgetId : null;
    if (await run('new', () => add(body, { widgetId }))) {
      setDraft('');
      setFilter('open');
      onCommentPosted?.(body, widgetId);
    }
  };

  const submitReply = async (threadId: string) => {
    const body = replyDraft.trim();
    if (!body) return;
    if (await run(threadId, () => add(body, { parentId: threadId }))) {
      setReplyDraft('');
      setReplyTo(null);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const body = editing.body.trim();
    if (!body) return;
    if (await run('edit', () => edit(editing.id, body))) setEditing(null);
  };

  const scheduleDelete = (id: string) => {
    setPendingDelete((prev) => new Set(prev).add(id));
    const undo = () => {
      clearTimeout(timers.current.get(id));
      timers.current.delete(id);
      setPendingDelete((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      message.destroy(`comment-deleted-${id}`);
    };
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        remove(id)
          .catch(fail)
          .finally(() =>
            setPendingDelete((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            }),
          );
      }, UNDO_MS),
    );
    message.open({
      key: `comment-deleted-${id}`,
      type: 'info',
      duration: UNDO_MS / 1000,
      content: (
        <span>
          {t('collab_comments_deleted')}{' '}
          <Button type="link" size="small" onClick={undo}>
            {t('collab_comments_undo')}
          </Button>
        </span>
      ),
    });
  };

  const when = (c: DashboardComment) => (c.created_at ? format.relativeTime(new Date(c.created_at)) : '');

  const renderComment = (c: DashboardComment, thread: DashboardCommentThread, isReply: boolean) => {
    const mine = !!selfId && c.author.id === selfId;
    const name = c.author.name || t('collab_comments_anonymous');
    if (c.deleted) {
      return (
        <Typography.Text type="secondary" italic className="dashboard-comment-deleted">
          {t('collab_comments_removed')}
        </Typography.Text>
      );
    }
    const menuItems = [
      ...(mine ? [{ key: 'edit', label: t('collab_comments_edit') }] : []),
      ...(mine || canModerate ? [{ key: 'delete', label: t('collab_comments_delete'), danger: true }] : []),
    ];
    return (
      <div className={`dashboard-comment${isReply ? ' dashboard-comment--reply' : ''}`}>
        <Avatar size={isReply ? 22 : 26} className="dashboard-comment-avatar">
          {name.slice(0, 1).toUpperCase()}
        </Avatar>
        <div className="dashboard-comment-main">
          <div className="dashboard-comment-meta">
            <Typography.Text strong className="dashboard-comment-author">
              {name}
            </Typography.Text>
            <Typography.Text type="secondary" className="dashboard-comment-time">
              {when(c)}
              {c.edited_at ? ` · ${t('collab_comments_edited')}` : ''}
            </Typography.Text>
            {menuItems.length ? (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: menuItems,
                  onClick: ({ key }) =>
                    key === 'edit' ? setEditing({ id: c.id, body: c.body }) : scheduleDelete(c.id),
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<EllipsisOutlined />}
                  className="dashboard-comment-more"
                  aria-label={t('collab_comments_more')}
                />
              </Dropdown>
            ) : null}
          </div>
          {editing?.id === c.id ? (
            <div className="dashboard-comment-editor">
              <Input.TextArea
                autoSize={{ minRows: 2, maxRows: 8 }}
                maxLength={MAX_BODY}
                value={editing.body}
                autoFocus
                onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                onPressEnter={(e) => {
                  if (!e.shiftKey) {
                    e.preventDefault();
                    void saveEdit();
                  }
                }}
              />
              <div className="dashboard-comment-actions">
                <Button size="small" onClick={() => setEditing(null)}>
                  {t('collab_comments_cancel')}
                </Button>
                <Button size="small" type="primary" loading={busy === 'edit'} disabled={!editing.body.trim()} onClick={() => void saveEdit()}>
                  {t('collab_comments_save')}
                </Button>
              </div>
            </div>
          ) : (
            <Typography.Paragraph className="dashboard-comment-body">{c.body}</Typography.Paragraph>
          )}
          {!isReply && thread.widget_id && !(selectedWidgetId && onlyWidget) ? (
            <Tag className="dashboard-comment-widget">
              {widgetTitle?.(thread.widget_id) || anchorTerms?.on || t('collab_comments_on_widget')}
            </Tag>
          ) : null}
        </div>
      </div>
    );
  };

  const trigger = (
    <Badge count={openCount} size="small" offset={[-4, 4]}>
      <Button
        type="default"
        size={triggerSize}
        icon={<CommentOutlined />}
        className={`dashboard-collab-comments-trigger no-print no-export${
          variant === 'toolbar' ? ' dashboard-collab-comments-trigger--toolbar' : ''
        }`}
        onClick={() => onOpenChange(true)}
        aria-label={t('collab_comments_open')}
      />
    </Badge>
  );

  return (
    <>
      {variant === 'floating' ? (
        <div className="dashboard-collab-comments-anchor no-print no-export">{trigger}</div>
      ) : (
        trigger
      )}

      <Drawer
        title={t('collab_comments_title')}
        placement="right"
        size={380}
        open={open}
        onClose={() => onOpenChange(false)}
        className="dashboard-collab-comments-drawer no-print"
        rootClassName="no-print"
        styles={{ body: { display: 'flex', flexDirection: 'column', gap: 12 } }}
      >
        <div className="dashboard-comments-toolbar">
          <Segmented<Filter>
            size="small"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'open', label: `${t('collab_comments_filter_open')} (${openCount})` },
              { value: 'resolved', label: `${t('collab_comments_filter_resolved')} (${resolvedCount})` },
            ]}
          />
          {selectedWidgetId ? (
            <Checkbox checked={onlyWidget} onChange={(e) => setOnlyWidget(e.target.checked)}>
              {anchorTerms?.only ?? t('collab_comments_only_widget')}
            </Checkbox>
          ) : null}
        </div>

        {error ? <Alert type="warning" showIcon message={t('collab_comments_load_failed')} /> : null}

        <div className="dashboard-comments-list">
          {loading && threads.length === 0 ? (
            <Spin />
          ) : visible.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={filter === 'resolved' ? t('collab_comments_empty_resolved') : t('collab_comments_empty')}
            />
          ) : (
            visible.map((thread) => (
              <div
                key={thread.id}
                className={`dashboard-comment-thread${thread.resolved_at ? ' dashboard-comment-thread--resolved' : ''}${
                  thread.widget_id && thread.widget_id === selectedWidgetId ? ' dashboard-comment-thread--selected' : ''
                }`}
              >
                {renderComment(thread, thread, false)}
                {thread.replies.map((r) => (
                  <React.Fragment key={r.id}>{renderComment(r, thread, true)}</React.Fragment>
                ))}
                {replyTo === thread.id ? (
                  <div className="dashboard-comment-editor dashboard-comment--reply">
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 6 }}
                      maxLength={MAX_BODY}
                      value={replyDraft}
                      autoFocus
                      placeholder={t('collab_comments_reply_placeholder')}
                      onChange={(e) => setReplyDraft(e.target.value)}
                      onPressEnter={(e) => {
                        if (!e.shiftKey) {
                          e.preventDefault();
                          void submitReply(thread.id);
                        }
                      }}
                    />
                    <div className="dashboard-comment-actions">
                      <Button size="small" onClick={() => setReplyTo(null)}>
                        {t('collab_comments_cancel')}
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        loading={busy === thread.id}
                        disabled={!replyDraft.trim()}
                        onClick={() => void submitReply(thread.id)}
                      >
                        {t('collab_comments_reply')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="dashboard-comment-thread-actions">
                    <Button
                      type="link"
                      size="small"
                      onClick={() => {
                        setReplyTo(thread.id);
                        setReplyDraft('');
                      }}
                    >
                      {t('collab_comments_reply')}
                    </Button>
                    {!thread.deleted ? (
                      <Button
                        type="link"
                        size="small"
                        icon={thread.resolved_at ? <RedoOutlined /> : <CheckCircleOutlined />}
                        loading={busy === thread.id}
                        onClick={() => void run(thread.id, () => setResolved(thread.id, !thread.resolved_at))}
                      >
                        {thread.resolved_at ? t('collab_comments_reopen') : t('collab_comments_resolve')}
                      </Button>
                    ) : null}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        <div className="dashboard-comments-composer">
          {selectedWidgetId ? (
            <Checkbox checked={attachToWidget} onChange={(e) => setAttachToWidget(e.target.checked)}>
              {anchorTerms
                ? anchorTerms.attach(widgetTitle?.(selectedWidgetId) || anchorTerms.selected)
                : t('collab_comments_attach_widget', {
                  widget: widgetTitle?.(selectedWidgetId) || t('collab_comments_selected_widget'),
                })}
            </Checkbox>
          ) : null}
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 8 }}
            maxLength={MAX_BODY}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('collab_comments_placeholder')}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
          />
          <Button type="primary" icon={<SendOutlined />} block loading={busy === 'new'} disabled={!draft.trim()} onClick={() => void submit()}>
            {t('collab_comments_send')}
          </Button>
        </div>
      </Drawer>
    </>
  );
}

export default DashboardCollabCommentsPanel;
