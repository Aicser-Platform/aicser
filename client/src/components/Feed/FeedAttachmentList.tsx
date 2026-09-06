'use client';

import React from 'react';
import { Skeleton, Typography } from 'antd';
import { DashboardOutlined, LockOutlined, LineChartOutlined } from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { AssetType, FeedAttachmentPayload } from '@/services/socialFeedService';
import { buildPreviewFeedItem, assetTypeLabelKey } from './feedPostDisplay';
import { FeedExpandableText } from '@/components/Feed/FeedExpandableText';
import FeedPreviewVisual from '@/app/(dashboard)/feed/components/FeedPreviewVisual';
import { useLazyVisible } from '@/hooks/useLazyVisible';

const { Paragraph, Text } = Typography;

function AttachmentPreviewCard({ att }: { att: FeedAttachmentPayload }) {
  const t = useTranslations('feed_page');
  const tFeed = useTranslations('feed');
  const router = useRouter();
  // A dashboard/chart preview is a live, DB-backed fetch (unless the
  // publication has a captured snapshot) - deferring it until the card is
  // actually about to be seen keeps a feed full of several attachments from
  // firing every one of their fetches at once on page load. Same lazy-embed
  // pattern feeds like LinkedIn/Twitter use for rich content.
  const { ref, visible } = useLazyVisible<HTMLDivElement>();

  const title = att.title || (att.asset_type === 'chart' ? t('attachment_untitled_chart') : t('attachment_untitled'));
  const description = att.description?.trim();
  const assetTypeLabel = tFeed(assetTypeLabelKey(att.asset_type as AssetType) as 'insights_type');
  const previewItem = buildPreviewFeedItem({
    assetType: att.asset_type,
    assetId: att.asset_id,
    title,
    renderMode: att.renderMode,
    snapshotPayload: att.snapshotPayload ?? undefined,
    previewMetadata: {
      previewType: att.previewType,
      previewData: att.previewData,
      previews: att.previews,
      chartWidget: att.chartWidget,
      dashboardId: att.dashboardId,
    },
  });
  const openAttachment = () => router.push(`/feed/${att.referencedPostId}`);
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAttachment();
    }
  };

  // Same title+description pairing (FeedPostContent) and same thumbnail
  // treatment - rounded-lg aspect-video with the asset-type badge floating
  // in the corner (FeedCardMedia) - a real "Publish to Feed" post renders
  // with, so an attached chart/dashboard reads as the same kind of card
  // instead of a smaller, differently-chromed one missing its own insight
  // text. The rounded, softly-filled outer wrapper (no border/divider line)
  // is the only addition, needed to visually group one attachment's title +
  // thumbnail together when a post has several stacked in a row.
  return (
    <div
      className="cursor-pointer rounded-lg p-2.5 transition-colors hover:bg-[var(--ant-color-fill-quaternary)]"
      style={{ background: 'var(--ant-color-fill-quaternary)' }}
      role="button"
      tabIndex={0}
      onClick={openAttachment}
      onKeyDown={handleKeyDown}
    >
      <Paragraph
        className="mb-1 text-sm font-semibold leading-snug text-[var(--ant-color-text)]"
        ellipsis={{ rows: 2 }}
      >
        {title}
      </Paragraph>
      {description ? (
        <FeedExpandableText text={description} maxRows={2} className="mb-2 text-sm leading-relaxed" />
      ) : null}
      <div ref={ref} className="relative aspect-video w-full overflow-hidden rounded-lg bg-[var(--ant-color-bg-layout)]">
        {visible ? (
          <div className="pointer-events-none absolute inset-0">
            <FeedPreviewVisual item={previewItem} maxPreviews={2} />
          </div>
        ) : (
          <Skeleton.Node active style={{ width: '100%', height: '100%' }} />
        )}
        <div className="absolute right-2 top-2 z-10">
          <span className="rounded-full bg-[var(--ant-color-bg-elevated)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ant-color-text-secondary)] shadow-sm">
            {assetTypeLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Existing dashboards/charts a post references. Each is backed by a real
 * feed publication (auto-published the first time it's attached anywhere,
 * same pipeline as "Publish to Feed") - the deep link is always just
 * /feed/{referencedPostId}, and the tile reuses the exact same building
 * blocks a normal published dashboard/chart post renders with: title +
 * description typography from FeedPostContent, and the rounded aspect-video
 * thumbnail with a floating asset-type badge from FeedCardMedia. One shared
 * presentation for every card on the page, published or attached, rather
 * than a second, sparser bespoke rendering.
 *
 * The whole tile opens the full attachment (/feed/{referencedPostId}); the
 * preview itself is inert (pointer-events: none) rather than interactive in
 * place - a live dashboard's own filter controls/scroll only make sense at
 * full size, and clipping them into a card-sized tile the way the
 * aspect-video frame requires would leave truncated, half-usable controls.
 * Click through to interact with the real thing, the same as clicking a
 * normal post's thumbnail.
 *
 * `restricted: true` means the CURRENT VIEWER can't see that publication -
 * no title/preview is included in that case (per-viewer check server-side),
 * the card renders a "Restricted" placeholder instead. A missing
 * `referencedPostId` on a non-restricted entry means the publication was
 * deleted after being attached - rendered as "no longer available". */
export function FeedAttachmentList({ attachments }: { attachments?: FeedAttachmentPayload[] | null }) {
  const t = useTranslations('feed_page');
  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 px-4 pb-2">
      {attachments.map((att) => {
        const Icon = att.asset_type === 'chart' ? LineChartOutlined : DashboardOutlined;

        if (att.restricted) {
          return (
            <div
              key={att.asset_id}
              className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2"
              style={{ borderColor: 'var(--ant-color-border-secondary)', color: 'var(--ant-color-text-tertiary)' }}
            >
              <LockOutlined />
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t('attachment_restricted')}
              </Text>
            </div>
          );
        }

        if (!att.referencedPostId) {
          return (
            <div
              key={att.asset_id}
              className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-2"
              style={{ borderColor: 'var(--ant-color-border-secondary)', color: 'var(--ant-color-text-tertiary)' }}
            >
              <Icon />
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t('attachment_unavailable')}
              </Text>
            </div>
          );
        }

        return <AttachmentPreviewCard key={att.asset_id} att={att} />;
      })}
    </div>
  );
}

export default FeedAttachmentList;
