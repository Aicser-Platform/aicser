import React from 'react';
import type { FeedItem } from '@/services/socialFeedService';
import { FeedPostContent } from '@/components/Feed/FeedPostContent';
import FeedCardMedia from '../FeedCardMedia';

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
  return (
    <div className="flex flex-col">
      <div className={compact ? 'px-3 py-2' : 'px-4 py-2.5'}>
        <FeedPostContent item={item} compactTitle descriptionMaxRows={2} />
      </div>

      <FeedCardMedia
        item={item}
        maxPreviews={compact ? 2 : 4}
        previewClickable={previewClickable}
        onPreviewClick={onPreviewClick}
        hideThumbnail={hidePreview}
        thumbnailWrapperClassName={compact ? 'px-3 pb-2.5' : 'px-4 pb-3'}
        tagsWrapperClassName={compact ? 'px-3 py-1.5' : 'px-4 py-2'}
      />
    </div>
  );
};

export default FeedCardBody;
