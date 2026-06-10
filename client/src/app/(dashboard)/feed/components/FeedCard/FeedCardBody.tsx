import React from 'react';
import { useTranslations } from 'next-intl';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import type { FeedItem } from '@/services/socialFeedService';
import FeedPreviewVisual from '../FeedPreviewVisual';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import { assetTypeLabelKey } from '@/components/Feed/feedPostDisplay';

dayjs.extend(relativeTime);

function formatSharedAgo(dateStr: string, t: ReturnType<typeof useTranslations>): string {
  const d = dayjs(dateStr);
  if (!d.isValid()) return '';
  const diffDays = dayjs().diff(d, 'day');
  if (diffDays < 1) return t('shared_today');
  if (diffDays === 1) return t('shared_yesterday');
  if (diffDays < 7) return t('shared_days_ago', { count: diffDays });
  return t('shared_on_date', { date: d.format('MMM D') });
}

function formatSnapshotLabel(item: FeedItem, t: ReturnType<typeof useTranslations>): string | null {
  const captured =
    item.snapshot?.capturedAt ||
    item.asset.snapshotCapturedAt ||
    (item.asset.snapshotPayload as { capturedAt?: string } | undefined)?.capturedAt;
  if (item.renderMode === 'snapshot' && captured) {
    const d = dayjs(captured);
    if (!d.isValid()) return t('snapshot_badge');
    return t('snapshot_from_date', { date: d.format('MMM D, YYYY') });
  }
  return formatSharedAgo(item.publishedAt || item.lastActivityAt, t);
}

interface FeedCardBodyProps {
  item: FeedItem;
  compact: boolean;
  previewClickable?: boolean;
  onPreviewClick?: () => void;
}

const FeedCardBody: React.FC<FeedCardBodyProps> = ({ item, compact, previewClickable, onPreviewClick }) => {
  const t = useTranslations('feed');

  const handleMediaKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!previewClickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPreviewClick?.();
    }
  };

  const assetTypeLabel = t(assetTypeLabelKey(item.assetType) as 'insights_type');
  const freshnessLabel = formatSnapshotLabel(item, t);

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-3 pb-3">
        <FeedPostContent item={item} compactTitle />
      </div>

      <div
        className={`relative ${item.assetType === 'dashboard' ? 'aspect-[4/3]' : 'aspect-[16/9]'} w-full bg-[var(--ant-color-bg-container)] border-y border-[var(--ant-color-border-secondary)] overflow-hidden group/media ${
          previewClickable ? 'cursor-pointer' : ''
        }`}
        role={previewClickable ? 'button' : undefined}
        tabIndex={previewClickable ? 0 : -1}
        onClick={previewClickable ? onPreviewClick : undefined}
        onKeyDown={handleMediaKeyDown}
        aria-label={previewClickable ? t('open_post') : undefined}
      >
        <div className="absolute top-4 left-4 z-10">
          <span className="px-2.5 py-1 rounded-md bg-[var(--ant-color-bg-elevated)] backdrop-blur-sm border border-[var(--ant-color-border-secondary)] text-xs font-semibold tracking-wide text-[var(--ant-color-text)] shadow-sm uppercase">
            {item.renderMode === 'snapshot' ? t('snapshot_badge') : assetTypeLabel}
          </span>
        </div>
        {freshnessLabel && (
          <div className="absolute bottom-3 right-3 z-10 pointer-events-none">
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-medium tracking-wide"
              style={{
                background: 'rgba(0,0,0,0.45)',
                color: 'rgba(255,255,255,0.88)',
                backdropFilter: 'blur(4px)',
                letterSpacing: '0.02em',
              }}
            >
              {freshnessLabel}
            </span>
          </div>
        )}
        <FeedPreviewVisual item={item} maxPreviews={compact ? 4 : undefined} showOverflowBadge={compact} />
      </div>
    </div>
  );
};

export default FeedCardBody;
