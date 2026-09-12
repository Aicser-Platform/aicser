'use client';

import './NewPostComposer.css';
import React, { useEffect, useMemo, useState } from 'react';
import { Avatar, Button, Mentions, Radio, Tag, message } from 'antd';
import { BulbOutlined, DashboardOutlined, LineChartOutlined, PaperClipOutlined, SendOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProfileStore } from '@/stores/useProfileStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { socialFeedService, type FeedScope, type FeedVisibility } from '@/services/socialFeedService';
import { useMentionableMembers, resolveMentionedUserIds } from '@/hooks/feed/useMentionableMembers';
import { AttachmentPicker, type PickedAttachment } from './AttachmentPicker';
import { consumePendingFeedAttachment } from './pendingFeedAttachment';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

export interface NewPostComposerProps {
  /** Called with the newly-created post's id after a successful post, so the caller can prepend it to the feed. */
  onPosted: (postId: string) => void;
  /**
   * Active feed scope — keeps the composer's default audience aligned with what
   * the reader is currently browsing (avoids "posted to Only me while viewing
   * My company" trust gaps). Ignored once the user manually picks visibility.
   */
  feedScope?: FeedScope;
}

/** Post-only visibility: no "public" - see publish_asset's own guard for why
 * (an internal collaboration tool, not public-facing content). */
type PostVisibility = Extract<FeedVisibility, 'private' | 'project' | 'organization'>;

function visibilityFromFeedScope(
  scope: FeedScope | undefined,
  hasOrg: boolean,
  hasProject: boolean,
): PostVisibility {
  if (scope === 'private') return 'private';
  if (scope === 'project' && hasProject) return 'project';
  if (scope === 'organization' && hasOrg) return 'organization';
  if (scope === 'public' && hasOrg) return 'organization';
  if (hasOrg) return 'organization';
  if (hasProject) return 'project';
  return 'private';
}

export function NewPostComposer({ onPosted, feedScope }: NewPostComposerProps) {
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
  // Default audience tracks the feed scope the user is reading — a collaboration
  // feed whose posts silently default to an audience of one (while browsing the
  // company feed) defeats its purpose. Organization/project ids can still be
  // hydrating on first render, so this keeps tracking until the user picks.
  const [visibility, setVisibility] = useState<PostVisibility>('private');
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  useEffect(() => {
    if (visibilityTouched) return;
    setVisibility(visibilityFromFeedScope(feedScope, Boolean(organizationId), Boolean(projectId)));
  }, [feedScope, organizationId, projectId, visibilityTouched]);
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [focusOnMount, setFocusOnMount] = useState(false);

  // Picks up a chart/dashboard handed here from Share to Feed → "Add a note
  // on Feed" (or AttachmentPicker). Snapshot was already captured there.
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

  const canPost = (text.trim().length > 0 || attachments.length > 0) && !posting;

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    const body =
      trimmed ||
      (attachments[0]
        ? t('post_attachment_only_fallback', { title: attachments[0].title || t('attachment_untitled') })
        : '');
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
          ? attachments.map(({ asset_type, asset_id, snapshot_payload, publication_id }) => ({
              asset_type,
              asset_id,
              snapshot_payload,
              publication_id: publication_id || undefined,
            }))
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
    const fromProfile = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
    if (fromProfile) return fromProfile;
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    const full = (typeof meta?.full_name === 'string' && meta.full_name) || (typeof meta?.name === 'string' && meta.name) || '';
    return full.trim() || profile?.username || user?.username || user?.email || '';
  }, [user, profile]);

  const audienceHint =
    visibility === 'private'
      ? t('post_audience_private')
      : visibility === 'project'
        ? t('post_audience_project', { name: currentProject?.name || t('scope_project') })
        : t('post_audience_organization', { name: organizationName || t('scope_organization') });

  const scopeMismatchHint = useMemo(() => {
    if (!feedScope || visibilityTouched) return null;
    if (feedScope === 'private' && visibility !== 'private') return null;
    if (feedScope === 'project' && visibility !== 'project') {
      return t('post_audience_scope_note_project');
    }
    if (feedScope === 'organization' && visibility === 'private') {
      return t('post_audience_scope_note_company');
    }
    return null;
  }, [feedScope, visibility, visibilityTouched, t]);

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
                key={a.publication_id || a.asset_id}
                icon={
                  a.asset_type === 'chart' ? (
                    <LineChartOutlined />
                  ) : a.asset_type === 'insight' ? (
                    <BulbOutlined />
                  ) : (
                    <DashboardOutlined />
                  )
                }
                closable
                onClose={() =>
                  setAttachments((prev) =>
                    prev.filter((x) => (x.publication_id || x.asset_id) !== (a.publication_id || a.asset_id)),
                  )
                }
              >
                {a.title}
              </Tag>
            ))}
          </div>
        )}

        <div className="new-post-composer-audience-hint">
          <span>{audienceHint}</span>
          {scopeMismatchHint ? <span className="new-post-composer-audience-note"> · {scopeMismatchHint}</span> : null}
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
              type={attachments.length > 0 ? 'default' : 'primary'}
              ghost={attachments.length === 0}
              icon={<PaperClipOutlined />}
              disabled={attachments.length >= 5}
              onClick={() => setPickerOpen(true)}
              className="new-post-composer-attach"
            >
              {attachments.length > 0
                ? t('attach_insight_button_more', { count: attachments.length })
                : t('attach_insight_button')}
            </Button>
          </div>
          <Button type="primary" icon={<SendOutlined />} disabled={!canPost} loading={posting} onClick={() => void handlePost()}>
            {attachments.length > 0 && !text.trim() ? t('post_insight_button') : t('post_button')}
          </Button>
        </div>
      </div>

      <AttachmentPicker
        open={pickerOpen}
        excludeIds={attachments.flatMap((a) => [a.asset_id, a.publication_id].filter(Boolean) as string[])}
        organizationId={organizationId}
        onPick={(a) => setAttachments((prev) => [...prev, a])}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}

export default NewPostComposer;
