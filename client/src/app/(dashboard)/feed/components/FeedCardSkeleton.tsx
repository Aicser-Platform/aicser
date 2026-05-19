'use client';

import React from 'react';

interface FeedCardSkeletonProps {
  compact?: boolean;
}

const FeedCardSkeleton: React.FC<FeedCardSkeletonProps> = () => {
  return (
    <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden mb-6 flex flex-col pointer-events-none w-full animate-pulse">
      {/* Header: avatar + author info + controls */}
      <div className="flex items-center justify-between p-4 sm:p-5 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]/10">
        <div className="flex items-center gap-3 w-full max-w-[80%]">
          <div className="bg-[var(--ant-color-border-secondary)] rounded-full shrink-0 w-11 h-11" />
          <div className="flex flex-col gap-2 w-full">
            <div className="bg-[var(--ant-color-border-secondary)] rounded" style={{ width: 140, height: 14 }} />
            <div className="bg-[var(--ant-color-border-secondary)] rounded" style={{ width: 110, height: 11 }} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="bg-[var(--ant-color-border-secondary)] rounded-full" style={{ width: 68, height: 26 }} />
        </div>
      </div>

      {/* Body: content + media */}
      <div className="px-5 pt-3 pb-4">
        <div className="flex flex-col gap-2 mb-2">
          <div className="bg-[var(--ant-color-border-secondary)] rounded" style={{ width: '85%', height: 14 }} />
          <div className="bg-[var(--ant-color-border-secondary)] rounded" style={{ width: '95%', height: 12 }} />
          <div className="bg-[var(--ant-color-border-secondary)] rounded" style={{ width: '70%', height: 12 }} />
        </div>
        <div className="flex gap-2 mt-3">
          <div className="bg-[var(--ant-color-border-secondary)] rounded-full" style={{ width: 64, height: 20 }} />
          <div className="bg-[var(--ant-color-border-secondary)] rounded-full" style={{ width: 52, height: 20 }} />
          <div className="bg-[var(--ant-color-border-secondary)] rounded-full" style={{ width: 72, height: 20 }} />
        </div>
      </div>

      {/* Media block */}
      <div className="w-full aspect-[16/9] bg-[var(--ant-color-border-secondary)]/50 border-y border-[var(--ant-color-border-secondary)] relative">
        <div className="absolute top-4 left-4">
          <div className="bg-[var(--ant-color-border-secondary)] rounded-md" style={{ width: 80, height: 24 }} />
        </div>
        <div className="flex items-center justify-center w-full h-full p-4">
          <div className="w-full h-full bg-[var(--ant-color-border-secondary)]/70 rounded-lg" />
        </div>
      </div>

      {/* Metrics bar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--ant-color-border-secondary)]">
        <div className="bg-[var(--ant-color-border-secondary)] rounded" style={{ width: 60, height: 11 }} />
        <div className="bg-[var(--ant-color-border-secondary)] rounded ml-auto" style={{ width: 74, height: 11 }} />
      </div>

      {/* Actions */}
      <div className="flex px-2 py-1.5 items-center justify-between gap-1 border-t border-[var(--ant-color-border-secondary)]">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex-1 h-10 bg-[var(--ant-color-border-secondary)]/80 rounded-md mx-1" />
        ))}
      </div>
    </div>
  );
};

export default FeedCardSkeleton;
