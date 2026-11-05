'use client';

import React from 'react';
import { TableRowsSkeleton } from './TableRowsSkeleton';

/** The shape of Ask while it loads: the answer area and the composer, in the place they will appear. */
export function ChatPageSkeleton() {
  return (
    <div className="chat-page-skeleton" role="status" aria-busy="true">
      <div className="chat-page-skeleton__thread">
        <TableRowsSkeleton widths={[70]} rows={4} showHeader={false} />
      </div>
      <div className="chat-page-skeleton__composer animate-pulse" />
    </div>
  );
}

export default ChatPageSkeleton;
