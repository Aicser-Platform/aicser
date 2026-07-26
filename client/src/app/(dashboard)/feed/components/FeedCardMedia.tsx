import React from 'react';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';
import { assetTypeLabelKey } from '@/components/Feed/feedPostDisplay';
import { resolveBackendMediaUrl } from '@/utils/mediaUrl';
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
}) => {
  const t = useTranslations('feed');
  const assetTypeLabel = t(assetTypeLabelKey(item.assetType) as 'insights_type');
  const thumbnailUrl = resolveBackendMediaUrl(item.asset.thumbnailUrl);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!previewClickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPreviewClick?.();
    }
  };

  return (
    <>
      {!hideThumbnail && (
        <div className={thumbnailWrapperClassName}>
          <div
            className={`relative aspect-video w-full overflow-hidden rounded-lg bg-[var(--ant-color-bg-layout)] ${
              previewClickable ? 'cursor-pointer' : ''
            }`}
            role={previewClickable ? 'button' : undefined}
            tabIndex={previewClickable ? 0 : -1}
            onClick={previewClickable ? onPreviewClick : undefined}
            onKeyDown={handleKeyDown}
            aria-label={previewClickable ? t('open_post') : undefined}
          >
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={item.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              // Chat-shared insights never get a captured screenshot (no DOM
              // element to point a captureSelector at), so thumbnailUrl is
              // always empty for them — render the real chart/dashboard from
              // its structured data instead of a bare "not available" card.
              <div className="absolute inset-0 h-full w-full">
                <FeedPreviewVisual item={item} maxPreviews={maxPreviews} />
              </div>
            )}
            <div className="absolute right-2 top-2 z-10">
              <span className="rounded-full bg-[var(--ant-color-bg-elevated)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ant-color-text-secondary)] shadow-sm">
                {assetTypeLabel}
              </span>
            </div>
          </div>
        </div>
      )}

      {item.tags.length > 0 && (
        <div className={`flex flex-wrap items-center gap-1.5 ${tagsWrapperClassName}`}>
          {item.tags.slice(0, maxTags).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-secondary)]"
            >
              {tag}
            </span>
          ))}
          {item.tags.length > maxTags && (
            <span className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-tertiary)]">
              +{item.tags.length - maxTags}
            </span>
          )}
        </div>
      )}
    </>
  );
};

export default FeedCardMedia;
