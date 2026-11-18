'use client';

import './FeedExpandableText.css';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AicserUi } from '@/components/aicser-ui/scope';
import { cn } from '@/lib/ui/utils';
import { renderTextWithMentions } from './MentionText';

interface FeedExpandableTextProps {
  text: string;
  className?: string;
  maxChars?: number;
  maxRows?: number;
  mode?: 'chars' | 'rows';
}

/** Text clamped to a few rows (or characters) with "See more" / "See less" (Aicser UI; scoped itself). */
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
  const ref = useRef<HTMLParagraphElement>(null);

  // Rows mode: the clamp hides the overflow, so "See more" appears only when something is hidden.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || mode !== 'rows' || expanded) return;
    const measure = () => setTruncated(el.scrollHeight - el.clientHeight > 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, maxRows, mode, expanded]);

  if (!text.trim()) return null;

  const toggle = (
    <button
      type="button"
      className="feed-publish-excerpt-toggle mt-1 self-start border-0 bg-transparent p-0 text-xs font-semibold text-primary-hover hover:underline dark:text-primary"
      onClick={() => setExpanded((v) => !v)}
    >
      {expanded ? t('see_less') : t('see_more')}
    </button>
  );

  if (mode === 'chars') {
    const needsExpand = text.length > maxChars;
    return (
      <AicserUi>
        <div className={cn('feed-expandable-text flex flex-col', className)}>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">
            {renderTextWithMentions(expanded || !needsExpand ? text : `${text.slice(0, maxChars).trimEnd()}…`)}
          </p>
          {needsExpand && toggle}
        </div>
      </AicserUi>
    );
  }

  return (
    <AicserUi>
      <div className={cn('feed-expandable-text flex flex-col', className)}>
        <p
          ref={ref}
          className="m-0 overflow-hidden text-sm leading-relaxed text-muted-foreground"
          style={
            expanded ? undefined : { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: maxRows }
          }
        >
          {renderTextWithMentions(text)}
        </p>
        {(truncated || expanded) && toggle}
      </div>
    </AicserUi>
  );
}

export default FeedExpandableText;
