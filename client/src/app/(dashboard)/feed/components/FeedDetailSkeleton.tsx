'use client';

import React from 'react';

const skeleton = 'animate-pulse rounded bg-[var(--ant-color-border-secondary)]';

const FeedDetailSkeleton: React.FC = () => {
  return (
    <div className="pointer-events-none flex w-full flex-col gap-5">
      <div className="flex items-center justify-between">
        <div className={`${skeleton} h-8 w-28 rounded-md`} />
        <div className={`${skeleton} h-8 w-8 rounded-md`} />
      </div>

      <header className="flex flex-col gap-3">
        <div className={`${skeleton} h-8 w-56`} />
        <div className={`${skeleton} h-8 w-3/5 max-w-xl`} />
      </header>

      <section className="overflow-hidden rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
        <div className="min-h-[min(70vh,880px)] bg-[var(--ant-color-bg-container)]">
          <div className={`${skeleton} h-full min-h-[420px] w-full rounded-lg`} />
        </div>
      </section>

      <div className={`${skeleton} h-10 w-full rounded-md`} />

      <section className="rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-5">
        <div className={`${skeleton} mb-4 h-5 w-32`} />
        <div className={`${skeleton} h-20 w-full rounded-lg`} />
      </section>
    </div>
  );
};

export default FeedDetailSkeleton;
