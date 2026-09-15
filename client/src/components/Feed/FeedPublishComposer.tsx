'use client';

import './FeedPublishComposer.css';
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Radio, Switch, message } from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  LinkOutlined,
  PaperClipOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { clearChatFeedDraft, defaultFeedVisibility, feedPostDetailUrl, feedPostListUrl } from './chatFeedDraft';
import { FeedPostPreview } from './FeedPostPreview';
import { formatFeedPublishError } from './feedPublishUtils';
import type { FeedPublishDraft } from './feedPublishDraft';
import type { FeedVisibility, PublishAssetResponse } from '@/services/socialFeedService';
import { socialFeedService, uploadFeedThumbnail } from '@/services/socialFeedService';
import { captureElementScreenshot } from '@/utils/captureElementScreenshot';
import { useProjectStore } from '@/stores/useProjectStore';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';
import { useProfileStore } from '@/stores/useProfileStore';
import { writePendingFeedAttachment } from './pendingFeedAttachment';

const isEnterpriseEdition = ['enterprise', 'ee'].includes(
  (process.env.NEXT_PUBLIC_EDITION || '').toLowerCase(),
);

export interface FeedPublishComposerProps {
  draft: FeedPublishDraft;
  layout?: 'page' | 'embedded';
  heading?: string;
  onBack?: () => void;
  onSuccess?: (result: PublishAssetResponse) => void;
  onCancel?: () => void;
}

export function FeedPublishComposer({
  draft,
  layout = 'page',
  heading,
  onBack,
  onSuccess,
  onCancel,
}: FeedPublishComposerProps) {
  const t = useTranslations('feed_publish_page');
  const tf = useTranslations('feed');
  const router = useRouter();
  const { user } = useAuth();
  const profile = useProfileStore((s) => s.profile);
  const currentProject = useProjectStore((s) => s.currentProject);
  const allProjects = useProjectStore((s) => s.projects);
  const projectId = currentProject?.id != null ? String(currentProject.id) : undefined;
  const organizationId =
    currentProject?.organization_id ||
    (currentProject as { organizationId?: string } | null)?.organizationId ||
    undefined;

  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.defaultDescription || '');
  const [showDescription, setShowDescription] = useState(Boolean(draft.defaultDescription?.trim()));
  const [visibility, setVisibility] = useState<FeedVisibility>(() =>
    defaultFeedVisibility(isEnterpriseEdition, projectId, organizationId),
  );
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [publicationMode, setPublicationMode] = useState<'update' | 'create_new'>('update');
  const [existingPublication, setExistingPublication] = useState<{
    id: string;
    title?: string;
  } | null>(
    draft.existingPublicationId
      ? { id: draft.existingPublicationId, title: draft.existingPublicationTitle }
      : null,
  );
  // The asset's REAL project - publish_asset always attributes a dashboard/
  // chart post to the project it actually lives in, never the client-supplied
  // one (security fix: trusting the request body there let a caller bypass
  // the project-role check). Resolved here, before publish, so "Project"
  // visibility shows its true destination instead of only surfacing a
  // mismatch after the post already landed somewhere else.
  const [assetProject, setAssetProject] = useState<{ id: string; name?: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<PublishAssetResponse | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // publish_asset always attributes a dashboard/chart post to the asset's
  // OWN project server-side (see assetProject's declaration comment above) -
  // effectiveProjectId is what will actually be used, so "Project"
  // visibility's availability and the hint shown for it are never wrong,
  // even before the header's active project happens to match.
  const isAssetSourceMode = draft.source.mode === 'asset';
  const effectiveProjectId = isAssetSourceMode && assetProject ? assetProject.id : projectId;
  const effectiveProjectName = isAssetSourceMode
    ? assetProject?.name || allProjects.find((p) => String(p.id) === assetProject?.id)?.name
    : currentProject?.name;
  const projectMismatch = isAssetSourceMode && !!assetProject && assetProject.id !== projectId;

  const authorName = useMemo(() => {
    const fromProfile = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
    if (fromProfile) return fromProfile;
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    const full =
      (typeof meta?.full_name === 'string' && meta.full_name) ||
      (typeof meta?.name === 'string' && meta.name) ||
      '';
    if (full.trim()) return full.trim();
    if (profile?.username?.trim()) return profile.username.trim();
    if (user?.username?.trim()) return user.username.trim();
    if (user?.email?.includes('@')) return user.email.split('@')[0];
    return t('you');
  }, [user, profile, t]);

  const authorHandle =
    profile?.username?.trim() ||
    user?.username?.trim() ||
    (user?.email?.includes('@') ? user.email.split('@')[0] : '');
  const authorAvatarUrl = profile?.avatar_url || undefined;

  useEffect(() => {
    if (draft.source.mode !== 'asset' || !draft.source.assetId) return;
    let active = true;
    void socialFeedService
      .lookupPublication(draft.assetType, draft.source.assetId)
      .then((res) => {
        if (!active) return;
        if (res.asset_project_id) {
          setAssetProject({ id: res.asset_project_id, name: res.asset_project_name });
        }
        if (!res.exists || !res.publication_id) return;
        setExistingPublication({ id: res.publication_id, title: res.title });
        setPublicationMode('update');
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [draft.assetType, draft.source]);

  const feedPostUrl =
    typeof window !== 'undefined' && successResult?.publication_id
      ? `${window.location.origin}${feedPostDetailUrl(successResult.publication_id)}`
      : '';

  const handleBack = () => {
    if (onCancel) {
      onCancel();
      return;
    }
    if (onBack) {
      onBack();
      return;
    }
    router.back();
  };

  const handleCopyLink = async () => {
    if (!feedPostUrl) return;
    try {
      await navigator.clipboard.writeText(feedPostUrl);
      message.success(t('link_copied'));
    } catch {
      message.error(t('copy_failed'));
    }
  };

  // Dashboard/chart only: hand the same snapshot to /feed's composer as an
  // attachment so authors can add commentary — consolidates the old separate
  // "Attach to a new post" menu item into this publish flow.
  const canContinueWithPost =
    draft.source.mode === 'asset' &&
    Boolean(draft.source.assetId) &&
    (draft.assetType === 'dashboard' || draft.assetType === 'chart');

  const handleContinueWithPost = () => {
    if (draft.source.mode !== 'asset' || !draft.source.assetId) return;
    if (draft.assetType !== 'dashboard' && draft.assetType !== 'chart') return;
    const ok = writePendingFeedAttachment({
      asset_type: draft.assetType,
      asset_id: draft.source.assetId,
      title: title.trim() || draft.title || t('default_title'),
      snapshot_payload: draft.snapshotPayload ?? null,
    });
    if (!ok) {
      message.error(t('continue_with_post_storage_error'));
      return;
    }
    onCancel?.();
    router.push('/feed');
  };

  const handlePublish = async () => {
    if (!title.trim()) {
      message.warning(t('title_required'));
      return;
    }
    if (isEnterpriseEdition && visibility === 'project' && !effectiveProjectId) {
      message.error(t('project_required'));
      return;
    }
    if (isEnterpriseEdition && visibility === 'organization' && !organizationId) {
      message.error(t('organization_required'));
      return;
    }

    const previewMetadata = {
      ...(draft.previewMetadata || {}),
      previewLabel: title.trim(),
      ...(draft.chartPreview ? { chartWidget: draft.chartPreview } : {}),
    };
    const renderMode = draft.renderMode ?? 'snapshot';
    const snapshotPayload = draft.snapshotPayload;
    const loginWall = visibility === 'public' ? requiresLogin : true;

    setSubmitting(true);
    setPublishError(null);
    try {
      // Best-effort thumbnail capture — never blocks or surfaces an error to
      // the user; a missing thumbnail just means the feed card falls back
      // to its placeholder visual.
      let thumbnailUrl: string | undefined;
      if (draft.captureSelector) {
        const screenshot = await captureElementScreenshot(draft.captureSelector, {
          toggleClassName: 'dashboard-export-light',
          maxHeightPx: draft.captureMaxHeightPx,
        });
        if (screenshot) {
          thumbnailUrl = (await uploadFeedThumbnail(screenshot)) ?? undefined;
        }
      }

      let result: PublishAssetResponse;

      if (draft.source.mode === 'chat') {
        result = await socialFeedService.publishFromChat({
          conversation_id: draft.source.conversationId,
          message_id: draft.source.messageId,
          title: title.trim(),
          description: description.trim() || undefined,
          tags: draft.defaultTags ?? [],
          visibility,
          organization_id: isEnterpriseEdition ? organizationId : undefined,
          project_id: isEnterpriseEdition ? projectId : undefined,
          preview_metadata: previewMetadata,
          render_mode: renderMode,
          snapshot_payload: snapshotPayload,
          thumbnail_url: thumbnailUrl,
          requires_login: loginWall,
          publication_mode: publicationMode,
        });
        clearChatFeedDraft();
      } else {
        result = await socialFeedService.publishAsset({
          asset_type: draft.assetType,
          asset_id: draft.source.assetId,
          source_query_id: draft.source.sourceQueryId,
          organization_id: isEnterpriseEdition ? organizationId : undefined,
          project_id: isEnterpriseEdition ? projectId : undefined,
          title: title.trim(),
          description: description.trim() || undefined,
          tags: (draft.defaultTags ?? []).map((tag) => tag.trim()).filter(Boolean),
          visibility,
          preview_metadata: previewMetadata,
          render_mode: renderMode,
          snapshot_payload: snapshotPayload,
          thumbnail_url: thumbnailUrl,
          requires_login: loginWall,
          publication_mode: publicationMode,
          publication_id:
            publicationMode === 'update' && existingPublication?.id
              ? existingPublication.id
              : undefined,
        });
      }

      setSuccessResult(result);
      onSuccess?.(result);
    } catch (error) {
      const friendly = formatFeedPublishError(error, t('publish_failed'));
      setPublishError(friendly);
      message.error(friendly);
    } finally {
      setSubmitting(false);
    }
  };

  if (successResult) {
    const isPending = successResult.status === 'pending';
    // A dashboard/chart's post is attributed to the asset's OWN project
    // (resolved server-side, authoritative — see PublishAssetResponse's
    // project_id doc) which the composer can't reliably predict beforehand:
    // it's not necessarily the project active in the header when you hit
    // Publish, if the asset itself lives in a different project. Rather
    // than guess at compose time, confirm the real destination here once
    // it's known, only when it's actually the surprising case.
    const landedProjectId = successResult.project_id;
    const landedProjectDiffers = Boolean(landedProjectId) && landedProjectId !== projectId;
    const landedProjectName = landedProjectDiffers
      ? allProjects.find((p) => String(p.id) === landedProjectId)?.name
      : undefined;
    return (
      <div className={`feed-publish-success ${layout === 'embedded' ? 'feed-publish-success--embedded' : ''}`}>
        <div className="feed-publish-success-icon">
          <CheckCircleOutlined />
        </div>
        <h2 className="feed-publish-success-title">
          {isPending ? t('success_pending_title') : t('success_live_title')}
        </h2>
        <p className="feed-publish-success-body">
          {isPending ? t('success_pending_body') : t('success_live_body')}
        </p>
        {landedProjectDiffers && (
          <p className="feed-publish-success-project-note">
            {landedProjectName
              ? t('success_project_note', { project: landedProjectName })
              : t('success_project_note_unknown')}
          </p>
        )}
        {!isPending && (
          <div className="feed-publish-success-actions">
            <Button
              type="primary"
              size="large"
              icon={<LinkOutlined />}
              onClick={() => router.push(feedPostListUrl(successResult.publication_id))}
            >
              {t('view_in_feed')}
            </Button>
            <Button size="large" icon={<CopyOutlined />} onClick={() => void handleCopyLink()}>
              {t('copy_link')}
            </Button>
          </div>
        )}
        <Button type="link" onClick={() => router.push('/feed')} className="feed-publish-back-link">
          {t('back_to_feed')}
        </Button>
      </div>
    );
  }

  const visibilityOptions: { value: FeedVisibility; label: string; disabled?: boolean }[] =
    isEnterpriseEdition
      ? [
          { value: 'project', label: tf('scope_project'), disabled: !effectiveProjectId },
          { value: 'organization', label: tf('scope_organization'), disabled: !organizationId },
          { value: 'public', label: tf('scope_public') },
          { value: 'private', label: tf('scope_private') },
        ]
      : [
          { value: 'public', label: tf('scope_public') },
          { value: 'private', label: tf('scope_private') },
        ];

  const rootClass = layout === 'embedded' ? 'feed-publish-layout feed-publish-layout--embedded' : 'feed-publish-layout';

  return (
    <div className={rootClass}>
      {layout === 'page' && onBack ? (
        <button type="button" className="feed-publish-back" onClick={handleBack}>
          <ArrowLeftOutlined />
          <span>{t('back_to_chat')}</span>
        </button>
      ) : null}

      <div className="feed-publish-grid">
        <section className="feed-publish-preview-card">
          <FeedPostPreview
            draft={draft}
            title={title}
            description={description}
            authorName={authorName}
            authorHandle={authorHandle}
            authorAvatarUrl={authorAvatarUrl}
            compact={layout === 'embedded'}
          />
        </section>

        <section className="feed-publish-form-card">
          {layout === 'page' ? (
            <h2 className="feed-publish-form-heading">{heading ?? t('heading')}</h2>
          ) : null}
          <p className="feed-publish-snapshot-note">{t('snapshot_mode_note')}</p>

          {publishError ? <p className="feed-publish-inline-error">{publishError}</p> : null}

          {/* eslint-disable-next-line jsx-a11y/label-has-for -- antd's Input renders a
              native input nested inside; the linter can't see through the component
              boundary, but wrapping it in <label> does correctly associate the text. */}
          <label className="feed-publish-field">
            <span className="feed-publish-field-label">{t('title_label')}</span>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('title_placeholder')}
              maxLength={120}
              showCount
            />
          </label>

          {showDescription ? (
            // eslint-disable-next-line jsx-a11y/label-has-for -- see title field above.
            <label className="feed-publish-field">
              <span className="feed-publish-field-label">{t('description_label')}</span>
              <Input.TextArea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('description_placeholder')}
                maxLength={600}
                showCount
              />
            </label>
          ) : (
            <Button type="link" className="feed-publish-add-desc" onClick={() => setShowDescription(true)}>
              {t('add_description')}
            </Button>
          )}

          <div className="feed-publish-field">
            <span className="feed-publish-field-label">{t('visibility_label')}</span>
            <Radio.Group
              value={visibility}
              onChange={(e) => {
                const next = e.target.value as FeedVisibility;
                setVisibility(next);
                if (next !== 'public') setRequiresLogin(true);
              }}
              className="feed-publish-visibility"
              optionType="button"
              buttonStyle="solid"
            >
              {visibilityOptions.map((opt) => (
                <Radio.Button key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </Radio.Button>
              ))}
            </Radio.Group>
            {visibility === 'project' && isAssetSourceMode ? (
              // publish_asset always attributes a dashboard/chart post to the
              // asset's OWN project server-side, never the header's active
              // one (security fix - see FeedPublishComposer's assetProject
              // state comment). Say so up front instead of only on the
              // success screen, which used to be the only place a mismatch
              // ever surfaced.
              <p className="feed-publish-field-hint">
                {effectiveProjectName
                  ? projectMismatch
                    ? t('project_scope_hint_mismatch', { project: effectiveProjectName })
                    : t('project_scope_hint', { project: effectiveProjectName })
                  : t('project_scope_hint_unknown')}
              </p>
            ) : null}
          </div>

          {visibility === 'public' ? (
            <div className="feed-publish-field feed-publish-field--row">
              <span className="feed-publish-field-label">{t('require_sign_in_label')}</span>
              <Switch
                checked={requiresLogin}
                onChange={setRequiresLogin}
                checkedChildren={t('require_sign_in_on')}
                unCheckedChildren={t('require_sign_in_off')}
              />
              <p className="feed-publish-field-hint">{t('require_sign_in_hint')}</p>
            </div>
          ) : null}

          {existingPublication && draft.source.mode === 'asset' ? (
            <div className="feed-publish-field">
              <span className="feed-publish-field-label">{t('publication_mode_label')}</span>
              <Radio.Group
                value={publicationMode}
                onChange={(e) => setPublicationMode(e.target.value as 'update' | 'create_new')}
                className="feed-publish-visibility"
              >
                <Radio value="update">{t('publication_mode_update')}</Radio>
                <Radio value="create_new">{t('publication_mode_new')}</Radio>
              </Radio.Group>
              <p className="feed-publish-field-hint">
                {publicationMode === 'update'
                  ? t('publication_mode_update_hint', { title: existingPublication.title || t('default_title') })
                  : t('publication_mode_new_hint')}
              </p>
            </div>
          ) : null}

          <Button
            type="primary"
            size="large"
            block
            icon={<SendOutlined />}
            loading={submitting}
            className="feed-publish-submit"
            onClick={() => void handlePublish()}
          >
            {t('publish_button')}
          </Button>
          {canContinueWithPost ? (
            <>
              <Button
                size="large"
                block
                icon={<PaperClipOutlined />}
                className="feed-publish-continue-post"
                disabled={submitting}
                onClick={handleContinueWithPost}
              >
                {t('continue_with_post_button')}
              </Button>
              <p className="feed-publish-field-hint feed-publish-continue-hint">
                {t('continue_with_post_hint')}
              </p>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default FeedPublishComposer;
