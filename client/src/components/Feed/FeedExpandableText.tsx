'use client';

import React, { useState } from 'react';
import { Typography } from 'antd';
import { useTranslations } from 'next-intl';

const { Paragraph } = Typography;

interface FeedExpandableTextProps {
  text: string;
  className?: string;
  maxChars?: number;
  maxRows?: number;
  mode?: 'chars' | 'rows';
}

export function FeedExpandableText({
  text,
  className = '',
  maxChars = 320,
  maxRows = 3,
  mode = 'rows',
}: FeedExpandableTextProps) {
  const t = useTranslations('feed_publish_page');
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  if (!text.trim()) return null;

  if (mode === 'chars') {
    const needsExpand = text.length > maxChars;
    return (
      <div className={`feed-expandable-text ${className}`.trim()}>
        <p className="feed-publish-excerpt-text m-0">
          {expanded || !needsExpand ? text : `${text.slice(0, maxChars).trimEnd()}…`}
        </p>
        {needsExpand && (
          <button type="button" className="feed-publish-excerpt-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('see_less') : t('see_more')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={`feed-expandable-text ${className}`.trim()}>
      <Paragraph
        className="text-sm m-0 leading-relaxed text-[var(--ant-color-text-secondary)]"
        ellipsis={
          expanded
            ? false
            : {
                rows: maxRows,
                onEllipsis: (ellipsed) => setTruncated(ellipsed),
              }
        }
      >
        {text}
      </Paragraph>
      {(truncated || expanded) && (
        <button type="button" className="feed-publish-excerpt-toggle mt-1" onClick={() => setExpanded((v) => !v)}>
          {expanded ? t('see_less') : t('see_more')}
        </button>
      )}
    </div>
  );
}

export default FeedExpandableText;
