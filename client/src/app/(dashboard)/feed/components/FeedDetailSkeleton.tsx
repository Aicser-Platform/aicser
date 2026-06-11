'use client';

import React from 'react';

const skeleton = 'animate-pulse rounded bg-[var(--ant-color-border-secondary)]';

const FeedDetailSkeleton: React.FC = () => {
  return (
    <div className="pointer-events-none flex w-full flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className={`${skeleton} h-8 w-8 shrink-0 rounded-md`} />
            <div className={`${skeleton} h-7 w-2/3 max-w-md`} />
          </div>
          <div className="flex flex-wrap gap-2">
            <div className={`${skeleton} h-8 w-28 rounded-md`} />
            <div className={`${skeleton} h-8 w-36 rounded-md`} />
            <div className={`${skeleton} h-8 w-32 rounded-md`} />
          </div>
        </div>
      </header>

      <section className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] px-4 py-3 sm:px-5">
          <div className={`${skeleton} h-4 w-40`} />
          <div className={`${skeleton} h-3 w-24`} />
        </div>
        <div className="min-h-[260px] bg-[var(--ant-color-bg-layout)] p-4 sm:p-5 md:p-6">
          <div className={`${skeleton} h-[220px] w-full rounded-lg`} />
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
        <div className="flex items-center gap-3 border-b border-[var(--ant-color-border-secondary)] p-4">
          <div className={`${skeleton} h-10 w-10 shrink-0 rounded-full`} />
          <div className="flex flex-1 flex-col gap-2">
            <div className={`${skeleton} h-4 w-36`} />
            <div className={`${skeleton} h-3 w-24`} />
          </div>
        </div>

        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className={`${skeleton} h-5 w-3/4`} />
          <div className={`${skeleton} h-4 w-full`} />
          <div className={`${skeleton} h-4 w-5/6`} />
        </div>

        <div className="flex items-center gap-4 border-t border-[var(--ant-color-border-secondary)] px-4 py-3 sm:px-5">
          <div className={`${skeleton} h-7 w-20 rounded-md`} />
          <div className={`${skeleton} h-7 w-20 rounded-md`} />
          <div className={`${skeleton} h-7 w-20 rounded-md`} />
        </div>
      </section>
    </div>
  );
};

export default FeedDetailSkeleton;
