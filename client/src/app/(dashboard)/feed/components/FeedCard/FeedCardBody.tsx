import React, { useEffect, useState } from 'react';
import { Typography } from 'antd';
import { DownOutlined, UpOutlined } from '@ant-design/icons';
import type { FeedItem } from '@/services/socialFeedService';
import FeedPreviewVisual from '../FeedPreviewVisual';

const { Paragraph } = Typography;

interface FeedCardBodyProps {
  item: FeedItem;
  compact: boolean;
  previewClickable?: boolean;
  onPreviewClick?: () => void;
}

const FeedCardBody: React.FC<FeedCardBodyProps> = ({ item, compact, previewClickable, onPreviewClick }) => {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [descriptionTruncated, setDescriptionTruncated] = useState(false);

  useEffect(() => {
    setDescriptionExpanded(false);
    setDescriptionTruncated(false);
  }, [item.description, item.id]);

  const handleMediaKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!previewClickable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onPreviewClick?.();
    }
  };

  const assetTypeLabel =
    item.assetType === 'dashboard' ? 'Dashboard' : item.assetType === 'insight' ? 'Insight' : 'Chart';

  return (
    <div className="flex flex-col">
      {/* LinkedIn-style post content */}
      <div className="px-5 pt-3 pb-4 flex flex-col gap-2">
        <Paragraph
          className="text-base font-semibold m-0 leading-snug text-[var(--ant-color-text)]"
          ellipsis={{ rows: 2 }}
        >
          {item.title}
        </Paragraph>
        {item.description && (
          <div className="flex flex-col items-start gap-2">
            <div className="relative w-full">
              <Paragraph
                className="text-sm m-0 leading-relaxed text-[var(--ant-color-text-secondary)]"
                ellipsis={
                  descriptionExpanded
                    ? false
                    : {
                        rows: 3,
                        onEllipsis: (ellipsed) => setDescriptionTruncated(ellipsed),
                      }
                }
              >
                {item.description}
              </Paragraph>
              {descriptionTruncated && !descriptionExpanded && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--ant-color-bg-container)] via-[var(--ant-color-bg-container)]/95 to-transparent" />
              )}
            </div>
            {(descriptionTruncated || descriptionExpanded) && (
              <button
                type="button"
                aria-expanded={descriptionExpanded}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ant-color-primary-border)] bg-[var(--ant-color-primary-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ant-color-primary)] shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--ant-color-primary)] hover:bg-[var(--ant-color-fill-quaternary)] hover:shadow-md"
                onClick={() => setDescriptionExpanded((prev) => !prev)}
              >
                <span className="underline decoration-[0.08em] underline-offset-2">
                  {descriptionExpanded ? 'See less' : 'See more'}
                </span>
                {descriptionExpanded ? <UpOutlined className="text-[10px]" /> : <DownOutlined className="text-[10px]" />}
              </button>
            )}
          </div>
        )}
        {(item.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {item.tags.map((tag) => (
              <span
                key={tag}
                className="text-[13px] font-medium text-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary-hover)] transition-colors cursor-pointer"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Full-width visualization media block */}
      <div
        className={`relative ${item.assetType === 'dashboard' ? 'aspect-[4/3]' : 'aspect-[16/9]'} w-full bg-[var(--ant-color-bg-container)] border-y border-[var(--ant-color-border-secondary)] overflow-hidden group/media ${
          previewClickable ? 'cursor-pointer' : ''
        }`}
        role={previewClickable ? 'button' : undefined}
        tabIndex={previewClickable ? 0 : -1}
        onClick={previewClickable ? onPreviewClick : undefined}
        onKeyDown={handleMediaKeyDown}
        aria-label={previewClickable ? `Open ${assetTypeLabel}` : undefined}
      >
        <div className="absolute top-4 left-4 z-10">
          <span className="px-2.5 py-1 rounded-md bg-[var(--ant-color-bg-elevated)] backdrop-blur-sm border border-[var(--ant-color-border-secondary)] text-xs font-semibold tracking-wide text-[var(--ant-color-text)] shadow-sm uppercase">
            {assetTypeLabel}
          </span>
        </div>
        <div className="w-full h-full flex items-center justify-center bg-[var(--ant-color-bg-container)] relative pointer-events-none">
          <FeedPreviewVisual item={item} maxPreviews={compact ? 4 : undefined} showOverflowBadge={compact} />
        </div>
        {previewClickable && (
          <div className="absolute inset-0 bg-black/0 group-hover/media:bg-black/5 hover:bg-black/10 transition-colors z-20 flex items-center justify-center opacity-0 group-hover/media:opacity-100">
            <button
              type="button"
              className="bg-[var(--ant-color-bg-elevated)] text-[var(--ant-color-text)] px-5 py-2.5 rounded-full font-semibold shadow-xl border border-[var(--ant-color-border-secondary)] backdrop-blur transform translate-y-2 group-hover/media:translate-y-0 transition-all duration-200"
              onClick={(event) => {
                event.stopPropagation();
                onPreviewClick?.();
              }}
            >
              Explore live data
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FeedCardBody;
