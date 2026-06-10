'use client';

import React, { useMemo, useState } from 'react';
import { Button, Drawer, Input, List, Typography } from 'antd';
import { CommentOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import type { CollabComment } from '../utils/collaborationTypes';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  comments: CollabComment[];
  selectedWidgetId?: string | null;
  onAddComment: (text: string, widgetId?: string | null) => void;
  connected: boolean;
};

export function DashboardCollabCommentsPanel({
  open,
  onOpenChange,
  comments,
  selectedWidgetId,
  onAddComment,
  connected,
}: Props) {
  const t = useTranslations('dashboards');
  const [draft, setDraft] = useState('');

  const visibleComments = useMemo(() => {
    const sorted = [...comments].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    if (!selectedWidgetId) return sorted;
    return sorted.filter((c) => !c.widget_id || c.widget_id === selectedWidgetId);
  }, [comments, selectedWidgetId]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAddComment(text, selectedWidgetId ?? null);
    setDraft('');
  };

  return (
    <>
      <Button
        type="default"
        size="small"
        icon={<CommentOutlined />}
        className="dashboard-collab-comments-trigger"
        disabled={!connected}
        onClick={() => onOpenChange(true)}
        aria-label={t('collab_comments_open')}
      >
        {comments.length > 0 ? comments.length : null}
      </Button>

      <Drawer
        title={t('collab_comments_title')}
        placement="right"
        width={320}
        open={open}
        onClose={() => onOpenChange(false)}
        className="dashboard-collab-comments-drawer"
      >
        {selectedWidgetId ? (
          <Typography.Text type="secondary" className="dashboard-collab-comments-scope">
            {t('collab_comments_widget_scope')}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary" className="dashboard-collab-comments-scope">
            {t('collab_comments_dashboard_scope')}
          </Typography.Text>
        )}

        <List
          size="small"
          locale={{ emptyText: t('collab_comments_empty') }}
          dataSource={visibleComments}
          renderItem={(item) => (
            <List.Item className="dashboard-collab-comment-item">
              <div>
                <Typography.Text strong className="dashboard-collab-comment-author">
                  {item.user?.username || item.user?.name || item.user?.email || t('collab_comments_anonymous')}
                </Typography.Text>
                <Typography.Paragraph className="dashboard-collab-comment-text" style={{ marginBottom: 0 }}>
                  {item.text}
                </Typography.Paragraph>
              </div>
            </List.Item>
          )}
          style={{ marginTop: 12, marginBottom: 12 }}
        />

        <Input.TextArea
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('collab_comments_placeholder')}
          onPressEnter={(e) => {
            if (!e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          block
          style={{ marginTop: 8 }}
          disabled={!draft.trim()}
          onClick={submit}
        >
          {t('collab_comments_send')}
        </Button>
      </Drawer>
    </>
  );
}

export default DashboardCollabCommentsPanel;
