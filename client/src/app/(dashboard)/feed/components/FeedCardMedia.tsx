import React from 'react';
import { Skeleton } from 'antd';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';
import {
  assetTypeLabelKey,
  feedItemHasLiveVisual,
  showFeedAssetTypeBadge,
  visibleFeedTags,
} from '@/components/Feed/feedPostDisplay';
import { isVideoMediaUrl, resolveBackendMediaUrl } from '@/utils/mediaUrl';
import { useLazyVisible } from '@/hooks/useLazyVisible';
import FeedPreviewVisual from './FeedPreviewVisual';

interface FeedCardMediaProps {
  item: FeedItem;
  maxPreviews: number;
  previewClickable?: boolean;
  onPreviewClick?: () => void;
  hideThumbnail?: boolean;
  /** Wrapper padding around the thumbnail — callers size this to their own layout. */
  thumbnailWrapperClassName?: string;
  /** Wrapper padding around the tag row. */
  tagsWrapperClassName?: string;
  maxTags?: number;
  /** Stretch the preview to fill the parent (grid cards) instead of a 16:9 hole. */
  fillHeight?: boolean;
  /** Extra badge rendered in the thumbnail's bottom-left corner, opposite the
   * asset-type pill — e.g. FeedGridCard's "+N more attachments" count when
   * this thumbnail is standing in for a text post's first attachment. */
  cornerBadge?: React.ReactNode;
}

/** Thumbnail + tag row shared by FeedCardBody (inline-comment cards) and FeedGridCard (grid cards). */
const FeedCardMedia: React.FC<FeedCardMediaProps> = ({
  item,
  maxPreviews,
  previewClickable = false,
  onPreviewClick,
  hideThumbnail = false,
  thumbnailWrapperClassName = 'px-3 pb-2.5',
  tagsWrapperClassName = 'px-3 py-1.5',
  maxTags = 4,
  cornerBadge,
  fillHeight = false,
}) => {
  const t = useTranslations('feed');
  const showTypeBadge = showFeedAssetTypeBadge(item.assetType);
  const assetTypeLabel = showTypeBadge ? t(assetTypeLabelKey(item.assetType) as 'insights_type') : null;
  const tags = visibleFeedTags(item.tags, item.assetType);
  const thumbnailUrl = resolveBackendMediaUrl(item.asset.thumbnailUrl);
  const videoUrl = isVideoMediaUrl(thumbnailUrl) ? thumbnailUrl : undefined;
  const hasLiveVisual = feedItemHasLiveVisual(item);
  // Frozen html2canvas stills hide ECharts animation and often crop the chart.
  // Prefer the live snapshot/widget; play an actual video when that is the share.
  const useLiveVisual = !videoUrl && hasLiveVisual;
  const useStillImage = Boolean(thumbnailUrl && !videoUrl && !useLiveVisual);
  const skipThumbnail = hideThumbnail || item.assetType === 'post';
  const liveVisualPreview = useLiveVisual;
  const { ref: lazyRef, visible: lazyVisible } = useLazyVisible<HTMLDivElement>('80px');

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!previewClickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPreviewClick?.();
    }
  };

  return (
    <div className={fillHeight ? 'flex h-full min-h-0 flex-col' : undefined}>
      {!skipThumbnail && (
        <div className={`${thumbnailWrapperClassName} ${fillHeight ? 'min-h-0 flex-1' : ''}`.trim()}>
          <div
            className={`relative w-full overflow-hidden bg-[var(--ant-color-bg-container)] ${
              fillHeight || liveVisualPreview || videoUrl ? 'h-full min-h-[160px]' : 'aspect-video'
            } ${previewClickable ? 'cursor-pointer' : ''}`}
            role={previewClickable ? 'button' : undefined}
            tabIndex={previewClickable ? 0 : -1}
            onClick={previewClickable ? onPreviewClick : undefined}
            onKeyDown={handleKeyDown}
            aria-label={previewClickable ? t('open_post') : undefined}
          >
            {videoUrl ? (
              <video
                src={videoUrl}
                poster={useStillImage ? thumbnailUrl : undefined}
                autoPlay
                loop
                muted
                playsInline
                preload="metadata"
                className="absolute inset-0 h-full w-full object-contain bg-[var(--ant-color-bg-container)]"
              />
            ) : useStillImage ? (
              <img
                src={thumbnailUrl}
                alt={item.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-contain bg-[var(--ant-color-bg-container)]"
              />
            ) : (
              <div
                ref={lazyRef}
                className={
                  fillHeight || liveVisualPreview ? 'relative h-full min-h-[160px] w-full' : 'absolute inset-0 h-full w-full'
                }
              >
                {lazyVisible ? (
                  <FeedPreviewVisual item={item} maxPreviews={maxPreviews} />
                ) : (
                  <Skeleton.Node active style={{ width: '100%', height: liveVisualPreview ? 180 : '100%' }} />
                )}
              </div>
            )}
            {assetTypeLabel ? (
              <div className="absolute right-2 top-2 z-10">
                <span className="rounded-full bg-[var(--ant-color-bg-elevated)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ant-color-text-secondary)] shadow-sm">
                  {assetTypeLabel}
                </span>
              </div>
            ) : null}
            {cornerBadge && <div className="absolute bottom-2 left-2 z-10">{cornerBadge}</div>}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className={`flex flex-wrap items-center gap-1.5 ${tagsWrapperClassName}`}>
          {tags.slice(0, maxTags).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-secondary)]"
            >
              {tag}
            </span>
          ))}
          {tags.length > maxTags && (
            <span className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-tertiary)]">
              +{tags.length - maxTags}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default FeedCardMedia;
