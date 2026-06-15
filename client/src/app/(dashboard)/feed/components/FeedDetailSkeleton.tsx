'use client';

import React from 'react';

const skeleton = 'animate-pulse rounded bg-[var(--ant-color-border-secondary)]';

const FeedDetailSkeleton: React.FC = () => {
  return (
    <div className="pointer-events-none flex w-full flex-col gap-5">
      <div className={`${skeleton} h-4 w-36`} />

      <header className="flex flex-col gap-4 rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex gap-2">
              <div className={`${skeleton} h-6 w-24 rounded-full`} />
              <div className={`${skeleton} h-6 w-20 rounded-full`} />
            </div>
            <div className={`${skeleton} h-8 w-4/5 max-w-2xl`} />
            <div className={`${skeleton} h-4 w-2/3 max-w-xl`} />
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <div className={`${skeleton} h-9 w-24 rounded-md`} />
            <div className={`${skeleton} h-9 w-32 rounded-md`} />
            <div className={`${skeleton} h-9 w-32 rounded-md`} />
          </div>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-5">
          <section className="overflow-hidden rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--ant-color-border-secondary)] px-5 py-4">
              <div className={`${skeleton} h-4 w-40`} />
              <div className={`${skeleton} h-3 w-24`} />
            </div>
            <div className="min-h-[340px] bg-[var(--ant-color-bg-layout)] p-4 sm:p-6">
              <div className={`${skeleton} h-[300px] w-full rounded-lg`} />
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
            <div className="flex items-center gap-3 border-b border-[var(--ant-color-border-secondary)] p-4">
              <div className={`${skeleton} h-10 w-10 shrink-0 rounded-full`} />
              <div className="flex flex-1 flex-col gap-2">
                <div className={`${skeleton} h-4 w-36`} />
                <div className={`${skeleton} h-3 w-24`} />
              </div>
            </div>
            <div className="flex flex-col gap-3 p-5">
              <div className={`${skeleton} h-5 w-3/4`} />
              <div className={`${skeleton} h-4 w-full`} />
              <div className={`${skeleton} h-4 w-5/6`} />
            </div>
            <div className="flex items-center gap-4 border-t border-[var(--ant-color-border-secondary)] px-5 py-3">
              <div className={`${skeleton} h-7 w-20 rounded-md`} />
              <div className={`${skeleton} h-7 w-20 rounded-md`} />
              <div className={`${skeleton} h-7 w-20 rounded-md`} />
            </div>
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-5">
            <div className={`${skeleton} mb-5 h-5 w-24`} />
            <div className="flex items-center gap-3">
              <div className={`${skeleton} h-12 w-12 rounded-full`} />
              <div className="flex flex-1 flex-col gap-2">
                <div className={`${skeleton} h-4 w-32`} />
                <div className={`${skeleton} h-3 w-24`} />
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-5">
            <div className={`${skeleton} mb-5 h-5 w-28`} />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className={`${skeleton} h-20 rounded-lg`} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-5">
            <div className={`${skeleton} mb-5 h-5 w-24`} />
            <div className="flex flex-col gap-4">
              <div className={`${skeleton} h-4 w-full`} />
              <div className={`${skeleton} h-4 w-4/5`} />
              <div className={`${skeleton} h-4 w-full`} />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default FeedDetailSkeleton;
