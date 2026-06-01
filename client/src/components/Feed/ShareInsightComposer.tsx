'use client';

import React from 'react';
import type { ChatFeedDraft } from './chatFeedDraft';
import { chatDraftToPublishDraft } from './feedPublishDraft';
import { FeedPublishComposer } from './FeedPublishComposer';

export interface ShareInsightComposerProps {
  draft: ChatFeedDraft;
  onBack?: () => void;
}

export function ShareInsightComposer({ draft, onBack }: ShareInsightComposerProps) {
  return (
    <FeedPublishComposer
      draft={chatDraftToPublishDraft(draft)}
      layout="page"
      onBack={onBack}
    />
  );
}

export default ShareInsightComposer;
