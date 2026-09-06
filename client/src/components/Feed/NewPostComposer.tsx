'use client';

import './NewPostComposer.css';
import React, { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Mentions, Radio, Tag, message } from 'antd';
import { DashboardOutlined, LineChartOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProfileStore } from '@/stores/useProfileStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { socialFeedService, type FeedVisibility } from '@/services/socialFeedService';
import { useMentionableMembers, resolveMentionedUserIds } from '@/hooks/feed/useMentionableMembers';
import { AttachmentPicker, type PickedAttachment } from './AttachmentPicker';
import { consumePendingFeedAttachment } from './pendingFeedAttachment';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

export interface NewPostComposerProps {
  /** Called with the newly-created post's id after a successful post, so the caller can prepend it to the feed. */
  onPosted: (postId: string) => void;
}

/** Post-only visibility: no "public" - see publish_asset's own guard for why
 * (an internal collaboration tool, not public-facing content). */
type PostVisibility = Extract<FeedVisibility, 'private' | 'project' | 'organization'>;

export function NewPostComposer({ onPosted }: NewPostComposerProps) {
  const t = useTranslations('feed_page');
  const { user } = useAuth();
  // Same store the header's own profile menu (UserProfileDropdown) already
  // fetches into - reused here rather than a second avatar-fetching path,
  // and since that dropdown is mounted globally in the dashboard layout this
  // usually resolves from the already-populated store with no extra request.
  const { profile, fetchProfile } = useProfileStore();
  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectId = currentProject?.id != null ? String(currentProject.id) : undefined;
  const organizationId =
    currentProject?.organization_id ||
    (currentProject as { organizationId?: string } | null)?.organizationId ||
    undefined;
  const organizationName = useOrganizationStore((s) => s.currentOrganization?.name);

  const [text, setText] = useState('');
  // Default to the widest audience actually available (org, then project, then
  // just-me) rather than always starting private — a collaboration feed whose
  // posts silently default to an audience of one defeats its own purpose, and
  // most people never think to check/change a visibility control before their
  // first post. organizationId/projectId can still be hydrating from the
  // project store on first render, so this keeps tracking the widest option
  // until the user actively picks one themselves.
  const [visibility, setVisibility] = useState<PostVisibility>('private');
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  useEffect(() => {
    if (visibilityTouched) return;
    setVisibility(organizationId ? 'organization' : projectId ? 'project' : 'private');
  }, [organizationId, projectId, visibilityTouched]);
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [focusOnMount, setFocusOnMount] = useState(false);

  // Picks up a chart/dashboard "sent" here from Chart Designer or a
  // dashboard's own share menu ("Attach to a new post") - the snapshot was
  // already captured there, so this just drops it straight into the
  // composer and nudges focus to the text box for the author's commentary,
  // rather than making them re-find the same chart via the picker's browse
  // list a second time.
  useEffect(() => {
    const pending = consumePendingFeedAttachment();
    if (!pending) return;
    setAttachments((prev) => (prev.some((a) => a.asset_id === pending.asset_id) ? prev : [...prev, pending]));
    setFocusOnMount(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mentionScope = visibility === 'organization' ? 'organization' : visibility === 'project' ? 'project' : null;
  const mentionTargetId = mentionScope === 'organization' ? organizationId : mentionScope === 'project' ? projectId : undefined;
  const { members, options: mentionOptions } = useMentionableMembers(mentionScope, mentionTargetId, user?.id);

  const visibilityOptions: { value: PostVisibility; label: string; disabled?: boolean }[] = isEnterpriseEdition
    ? [
        { value: 'private', label: t('scope_private') },
        { value: 'project', label: t('scope_project'), disabled: !projectId },
        { value: 'organization', label: t('scope_organization'), disabled: !organizationId },
      ]
    : [{ value: 'private', label: t('scope_private') }];

  const canPost = text.trim().length > 0 && !posting;

  const handlePost = async () => {
    const body = text.trim();
    if (!body) return;
    setPosting(true);
    try {
      const mentionedUsers = resolveMentionedUserIds(body, members);
      const result = await socialFeedService.publishAsset({
        asset_type: 'post',
        description: body,
        visibility,
        organization_id: visibility === 'organization' ? organizationId : undefined,
        project_id: visibility === 'project' ? projectId : undefined,
        attachments: attachments.length
          ? attachments.map(({ asset_type, asset_id, snapshot_payload }) => ({ asset_type, asset_id, snapshot_payload }))
          : undefined,
        mentioned_users: mentionedUsers.length ? mentionedUsers : undefined,
      });
      setText('');
      setAttachments([]);
      message.success(t('post_created'));
      onPosted(result.publication_id);
    } catch (error) {
      message.error(t('post_failed'));
    } finally {
      setPosting(false);
    }
  };

  const authorName = useMemo(() => {
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    const full = (typeof meta?.full_name === 'string' && meta.full_name) || (typeof meta?.name === 'string' && meta.name) || '';
    return full.trim() || user?.username || user?.email || '';
  }, [user]);

  if (!isEnterpriseEdition) return null;

  return (
    <div className="new-post-composer">
      <Avatar size={40} src={profile?.avatar_url || undefined}>
        {authorName.slice(0, 1).toUpperCase() || '?'}
      </Avatar>
      <div className="new-post-composer-body">
        <Mentions
          value={text}
          onChange={setText}
          options={mentionOptions}
          placeholder={t('post_placeholder')}
          autoSize={{ minRows: 2, maxRows: 8 }}
          className="new-post-composer-input"
          autoFocus={focusOnMount}
        />

        {attachments.length > 0 && (
          <div className="new-post-composer-attachments">
            {attachments.map((a) => (
              <Tag
                key={a.asset_id}
                icon={a.asset_type === 'chart' ? <LineChartOutlined /> : <DashboardOutlined />}
                closable
                onClose={() => setAttachments((prev) => prev.filter((x) => x.asset_id !== a.asset_id))}
              >
                {a.title}
              </Tag>
            ))}
          </div>
        )}

        <div className="new-post-composer-audience-hint">
          {visibility === 'private'
            ? t('post_audience_private')
            : visibility === 'project'
              ? t('post_audience_project', { name: currentProject?.name || t('scope_project') })
              : t('post_audience_organization', { name: organizationName || t('scope_organization') })}
        </div>

        <div className="new-post-composer-footer">
          <div className="new-post-composer-footer-left">
            <Radio.Group
              size="small"
              optionType="button"
              buttonStyle="solid"
              value={visibility}
              onChange={(e) => {
                setVisibilityTouched(true);
                setVisibility(e.target.value as PostVisibility);
              }}
              options={visibilityOptions}
            />
            <Button
              size="small"
              type="text"
              icon={<PaperClipOutlined />}
              disabled={attachments.length >= 5}
              onClick={() => setPickerOpen(true)}
            >
              {t('attach_insight_button')}
            </Button>
          </div>
          <Button type="primary" icon={<SendOutlined />} disabled={!canPost} loading={posting} onClick={() => void handlePost()}>
            {t('post_button')}
          </Button>
        </div>
      </div>

      <AttachmentPicker
        open={pickerOpen}
        excludeIds={attachments.map((a) => a.asset_id)}
        organizationId={organizationId}
        onPick={(a) => setAttachments((prev) => [...prev, a])}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

export default NewPostComposer;
