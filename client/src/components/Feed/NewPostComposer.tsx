'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChartLine, Eye, ImagePlus, Lightbulb, LayoutDashboard, Loader2, Paperclip, Send, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProfileStore } from '@/stores/useProfileStore';
import { useProjectStore } from '@/stores/useProjectStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { socialFeedService, type FeedImage, type FeedScope, type FeedVisibility } from '@/services/socialFeedService';
import { FeedImageView } from './FeedImages';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/aicser-ui/avatar';
import { Button } from '@/components/aicser-ui/button';
import { MentionTextarea } from '@/components/aicser-ui/mention-textarea';
import { NativeSelect, NativeSelectOption } from '@/components/aicser-ui/native-select';
import { AicserUi } from '@/components/aicser-ui/scope';
import { message } from '@/lib/ui/toast';
import { useMentionableMembers, resolveMentionedUserIds } from '@/hooks/feed/useMentionableMembers';
import { AttachmentPicker, type PickedAttachment } from './AttachmentPicker';
import { consumePendingFeedAttachment } from './pendingFeedAttachment';

const MAX_POST_IMAGES = 4;

const isEnterpriseEdition = ['enterprise', 'ee'].includes((process.env.NEXT_PUBLIC_EDITION || '').toLowerCase());

export interface NewPostComposerProps {
  /** Called with the newly-created post's id after a successful post, so the caller can prepend it to the feed. */
  onPosted: (postId: string) => void;
  /**
   * Active feed scope — keeps the composer's default audience aligned with what
   * the reader is currently browsing (avoids "posted to Only me while viewing
   * My company" trust gaps). Ignored once the user manually picks visibility.
   */
  feedScope?: FeedScope;
  /** The composer's audience and the feed tab stay in step: picking an audience here shows
   * that audience's feed, so what you're looking at is where the post lands. */
  onAudienceChange?: (scope: FeedScope) => void;
}

/** Post-only visibility: no "public" - see publish_asset's own guard for why
 * (an internal collaboration tool, not public-facing content). */
type PostVisibility = Extract<FeedVisibility, 'private' | 'project' | 'organization'>;

function visibilityFromFeedScope(scope: FeedScope | undefined, hasOrg: boolean, hasProject: boolean): PostVisibility {
  if (scope === 'private') return 'private';
  if (scope === 'project' && hasProject) return 'project';
  if (scope === 'organization' && hasOrg) return 'organization';
  if (scope === 'public' && hasOrg) return 'organization';
  if (hasOrg) return 'organization';
  if (hasProject) return 'project';
  return 'private';
}

export function NewPostComposer({ onPosted, feedScope, onAudienceChange }: NewPostComposerProps) {
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
  // Clicking a feed tab re-aligns the audience, even after an earlier manual pick.
  useEffect(() => {
    setVisibilityTouched(false);
  }, [feedScope]);
  useEffect(() => {
    if (visibilityTouched) return;
    setVisibility(visibilityFromFeedScope(feedScope, Boolean(organizationId), Boolean(projectId)));
  }, [feedScope, organizationId, projectId, visibilityTouched]);
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Uploaded as soon as they're picked (object storage, private until the post is published).
  const [images, setImages] = useState<FeedImage[]>([]);
  const [uploading, setUploading] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFiles = async (files: File[]) => {
    const room = MAX_POST_IMAGES - images.length - uploading;
    const picked = files.filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (files.length && !picked.length) {
      message.warning(room <= 0 ? t('image_limit', { max: MAX_POST_IMAGES }) : t('image_type_hint'));
      return;
    }
    setUploading((n) => n + picked.length);
    await Promise.all(
      picked.map(async (file) => {
        try {
          const img = await socialFeedService.uploadImage(file);
          setImages((prev) => (prev.length >= MAX_POST_IMAGES ? prev : [...prev, img]));
        } catch (e) {
          message.error((e as Error)?.message || t('image_upload_failed'));
        } finally {
          setUploading((n) => n - 1);
        }
      })
    );
  };
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
  const mentionTargetId =
    mentionScope === 'organization' ? organizationId : mentionScope === 'project' ? projectId : undefined;
  const { members, options: mentionOptions } = useMentionableMembers(mentionScope, mentionTargetId, user?.id);

  const visibilityOptions: { value: PostVisibility; label: string; disabled?: boolean }[] = isEnterpriseEdition
    ? [
        { value: 'private', label: t('scope_private') },
        {
          value: 'project',
          label: currentProject?.name ? `${t('scope_project')} · ${currentProject.name}` : t('scope_project'),
          disabled: !projectId,
        },
        { value: 'organization', label: t('scope_organization'), disabled: !organizationId },
      ]
    : [{ value: 'private', label: t('scope_private') }];

  const canPost =
    (text.trim().length > 0 || attachments.length > 0 || images.length > 0) && !posting && uploading === 0;

  const handlePost = async () => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0 && images.length === 0) return;
    // An image-only post needs no filler text; an attachment-only post keeps its title line.
    const body =
      trimmed ||
      (attachments[0]
        ? t('post_attachment_only_fallback', { title: attachments[0].title || t('attachment_untitled') })
        : '');
    if (!body && images.length === 0) return;
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
        images: images.length ? images.map((img) => img.id) : undefined,
        mentioned_users: mentionedUsers.length ? mentionedUsers : undefined,
      });
      setText('');
      setAttachments([]);
      setImages([]);
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
    const full =
      (typeof meta?.full_name === 'string' && meta.full_name) || (typeof meta?.name === 'string' && meta.name) || '';
    return full.trim() || profile?.username || user?.username || user?.email || '';
  }, [user, profile]);

  const audienceHint =
    visibility === 'private'
      ? t('post_audience_private')
      : visibility === 'project'
        ? t('post_audience_project', { name: currentProject?.name || t('scope_project') })
        : t('post_audience_organization', { name: organizationName || t('scope_organization') });

  // The tab and the audience move together; the one gap is Community, which shows content
  // published publicly — posts themselves never go public, so say where this one goes.
  const scopeMismatchHint = useMemo(() => {
    if (feedScope === 'public' && visibility !== 'private') {
      return t('post_audience_scope_note_public', {
        audience: visibility === 'project' ? t('scope_project') : t('scope_organization'),
      });
    }
    return null;
  }, [feedScope, visibility, t]);

  if (!isEnterpriseEdition) return null;

  const attachmentIcon = (type: PickedAttachment['asset_type']) =>
    type === 'chart' ? <ChartLine /> : type === 'insight' ? <Lightbulb /> : <LayoutDashboard />;

  return (
    <AicserUi>
      <div className="flex gap-3 rounded-xl border bg-card p-4">
        <Avatar className="size-9">
          {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt="" /> : null}
          <AvatarFallback className="bg-secondary text-sm font-medium text-secondary-foreground">
            {authorName.slice(0, 1).toUpperCase() || '?'}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <MentionTextarea
            value={text}
            onChange={setText}
            options={mentionOptions}
            placeholder={t('post_placeholder')}
            aria-label={t('post_placeholder')}
            minRows={2}
            maxRows={8}
            autoFocus={focusOnMount}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
              if (files.length) {
                e.preventDefault();
                void addImageFiles(files);
              }
            }}
          />

          {images.length > 0 || uploading > 0 ? (
            <div className="flex flex-wrap gap-2">
              {images.map((img) => (
                <div key={img.id} className="relative w-28 overflow-hidden rounded-lg border">
                  <FeedImageView image={img} height={88} />
                  <Button
                    size="icon-xs"
                    variant="secondary"
                    aria-label={t('image_remove')}
                    className="absolute right-1 top-1 rounded-full"
                    onClick={() => setImages((prev) => prev.filter((x) => x.id !== img.id))}
                  >
                    <X />
                  </Button>
                </div>
              ))}
              {Array.from({ length: uploading }).map((_, i) => (
                <div
                  key={`up-${i}`}
                  className="flex h-[88px] w-28 items-center justify-center rounded-lg border bg-muted"
                >
                  <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                </div>
              ))}
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a) => (
                <span
                  key={a.publication_id || a.asset_id}
                  className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border bg-secondary pl-2 pr-0.5 text-xs [&>svg]:size-3.5 [&>svg]:shrink-0"
                >
                  {attachmentIcon(a.asset_type)}
                  <span className="truncate">{a.title}</span>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('image_remove')}
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((x) => (x.publication_id || x.asset_id) !== (a.publication_id || a.asset_id))
                      )
                    }
                  >
                    <X />
                  </Button>
                </span>
              ))}
            </div>
          ) : null}

          {scopeMismatchHint ? <p className="m-0 text-xs text-muted-foreground">{scopeMismatchHint}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            {/* Who sees this post: defaults to the feed being read (a compact choice, not a second scope filter). */}
            <div className="relative" title={audienceHint}>
              <Eye
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <NativeSelect
                aria-label={audienceHint}
                className="[&_select]:pl-7"
                value={visibility}
                onChange={(e) => {
                  const v = e.target.value as PostVisibility;
                  setVisibilityTouched(true);
                  setVisibility(v);
                  onAudienceChange?.(v as FeedScope);
                }}
              >
                {visibilityOptions.map((o) => (
                  <NativeSelectOption key={o.value} value={o.value} disabled={o.disabled}>
                    {o.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
            <Button variant="outline" disabled={attachments.length >= 5} onClick={() => setPickerOpen(true)}>
              <Paperclip />
              {attachments.length > 0
                ? t('attach_insight_button_more', { count: attachments.length })
                : t('attach_insight_button')}
            </Button>
            <Button
              variant="outline"
              disabled={images.length + uploading >= MAX_POST_IMAGES}
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus />
              {t('image_add')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = '';
                void addImageFiles(files);
              }}
            />
            <Button className="ml-auto" disabled={!canPost} onClick={() => void handlePost()}>
              {posting ? <Loader2 className="animate-spin" /> : <Send />}
              {attachments.length > 0 && !text.trim() ? t('post_insight_button') : t('post_button')}
            </Button>
          </div>
        </div>
      </div>

      <AttachmentPicker
        open={pickerOpen}
        excludeIds={attachments.flatMap((a) => [a.asset_id, a.publication_id].filter(Boolean) as string[])}
        organizationId={organizationId}
        onPick={(a) => setAttachments((prev) => [...prev, a])}
        onPickImages={(files) => {
          setPickerOpen(false);
          void addImageFiles(files);
        }}
        onClose={() => setPickerOpen(false)}
      />
    </AicserUi>
  );
}

export default NewPostComposer;
