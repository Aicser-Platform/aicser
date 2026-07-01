import React from 'react';
import { useTranslations } from 'next-intl';
import type { FeedItem } from '@/services/socialFeedService';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import { assetTypeLabelKey } from '@/components/Feed/feedPostDisplay';
import { FeedPreviewEmpty } from '../FeedPreviewEmpty';
import { getBackendUrl } from '@/utils/backendUrl';

interface FeedCardBodyProps {
  item: FeedItem;
  compact: boolean;
  hidePreview?: boolean;
  previewClickable?: boolean;
  onPreviewClick?: () => void;
}

const FeedCardBody: React.FC<FeedCardBodyProps> = ({
  item,
  compact,
  hidePreview = false,
  previewClickable,
  onPreviewClick,
}) => {
  const t = useTranslations('feed');

  const handleMediaKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!previewClickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPreviewClick?.();
    }
  };

  const assetTypeLabel = t(assetTypeLabelKey(item.assetType) as 'insights_type');

  return (
    <div className="flex flex-col">
      <div className={compact ? 'px-3 py-2' : 'px-4 py-2.5'}>
        <FeedPostContent item={item} compactTitle descriptionMaxRows={2} />
      </div>

      {!hidePreview && (
        <div className={compact ? 'px-3 pb-2.5' : 'px-4 pb-3'}>
          <div
            className={`relative aspect-video w-full overflow-hidden rounded-lg bg-[var(--ant-color-bg-layout)] group/media ${
              previewClickable ? 'cursor-pointer' : ''
            }`}
            role={previewClickable ? 'button' : undefined}
            tabIndex={previewClickable ? 0 : -1}
            onClick={previewClickable ? onPreviewClick : undefined}
            onKeyDown={handleMediaKeyDown}
            aria-label={previewClickable ? t('open_post') : undefined}
          >
            {item.asset.thumbnailUrl ? (
              <img
                src={`${getBackendUrl()}${item.asset.thumbnailUrl}`}
                alt={item.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            ) : (
              <FeedPreviewEmpty label={t('snapshot_unavailable')} compact />
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
        <div className={`flex flex-wrap items-center gap-1.5 ${compact ? 'px-3 py-1.5' : 'px-4 py-2'}`}>
          {item.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-secondary)]"
            >
              {tag}
            </span>
          ))}
          {item.tags.length > 4 && (
            <span className="rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-0.5 text-xs text-[var(--ant-color-text-tertiary)]">
              +{item.tags.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default FeedCardBody;
