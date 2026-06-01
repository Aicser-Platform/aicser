'use client';

import React, { useEffect, useMemo, useState } from 'react';
import '@/app/(dashboard)/feed/styles.css';
import { Button, Input, Radio, Switch, message } from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  LinkOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { clearChatFeedDraft, defaultFeedVisibility, feedPostDetailUrl, feedPostListUrl } from './chatFeedDraft';
import { FeedPostPreview } from './FeedPostPreview';
import { formatFeedPublishError } from './feedPublishUtils';
import type { FeedPublishDraft } from './feedPublishDraft';
import type { FeedVisibility, PublishAssetResponse } from '@/services/socialFeedService';
import { socialFeedService } from '@/services/socialFeedService';
import { useProjectStore } from '@/stores/useProjectStore';
import { useAuthStore as useAuth } from '@/stores/useAuthStore';

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
  const currentProject = useProjectStore((s) => s.currentProject);
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
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<PublishAssetResponse | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const authorName = useMemo(() => {
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    const full =
      (typeof meta?.full_name === 'string' && meta.full_name) ||
      (typeof meta?.name === 'string' && meta.name) ||
      '';
    if (full.trim()) return full.trim();
    if (user?.username?.trim()) return user.username.trim();
    if (user?.email?.includes('@')) return user.email.split('@')[0];
    return t('you');
  }, [user, t]);

  const authorHandle = user?.username?.trim() || (user?.email?.includes('@') ? user.email.split('@')[0] : '');

  useEffect(() => {
    if (draft.source.mode !== 'asset' || !draft.source.assetId) return;
    let active = true;
    void socialFeedService
      .lookupPublication(draft.assetType, draft.source.assetId)
      .then((res) => {
        if (!active || !res.exists || !res.publication_id) return;
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

  const handlePublish = async () => {
    if (!title.trim()) {
      message.warning(t('title_required'));
      return;
    }
    if (isEnterpriseEdition && visibility === 'project' && !projectId) {
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
      setPublishError(formatFeedPublishError(error, t('publish_failed')));
    } finally {
      setSubmitting(false);
    }
  };

  if (successResult) {
    const isPending = successResult.status === 'pending';
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
          { value: 'project', label: tf('scope_project'), disabled: !projectId },
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
            compact={layout === 'embedded'}
          />
        </section>

        <section className="feed-publish-form-card">
          <h2 className="feed-publish-form-heading">{heading ?? t('heading')}</h2>
          <p className="feed-publish-snapshot-note">{t('snapshot_mode_note')}</p>

          {publishError ? <p className="feed-publish-inline-error">{publishError}</p> : null}

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
        </section>
      </div>
    </div>
  );
}

export default FeedPublishComposer;
