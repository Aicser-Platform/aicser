'use client';

import React from 'react';

const FeedDetailSkeleton: React.FC = () => {
  return (
    <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 animate-pulse pointer-events-none">
      <div className="mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="bg-[var(--ant-color-border-secondary)] rounded-md h-9 w-32" />
            <div className="flex items-center gap-2">
              <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-10" />
              <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-4" />
              <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-16" />
            </div>
          </div>
          <div className="flex items-center">
            <div className="bg-[var(--ant-color-border-secondary)] rounded-md h-9 w-40" />
          </div>
        </div>

        <div className="max-w-3xl flex flex-col gap-3">
          <div className="bg-[var(--ant-color-border-secondary)] rounded h-8 w-3/4 mb-1" />
          <div className="bg-[var(--ant-color-border-secondary)] rounded h-5 w-full" />
          <div className="bg-[var(--ant-color-border-secondary)] rounded h-5 w-5/6 mb-2" />
          <div className="flex flex-wrap gap-2">
            <div className="bg-[var(--ant-color-border-secondary)] rounded-md h-6 w-16" />
            <div className="bg-[var(--ant-color-border-secondary)] rounded-md h-6 w-24" />
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        <div className="flex-1 w-full flex flex-col gap-6 min-w-0">
          {/* Main Card */}
          <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
            <div className="flex flex-col sm:flex-row">
              <div className="w-full sm:w-2/3 bg-[var(--ant-color-bg-layout)] p-6 border-b sm:border-b-0 sm:border-r border-[var(--ant-color-border-secondary)] flex flex-col items-center justify-center min-h-[400px]">
                <div className="w-full aspect-[4/3] bg-[var(--ant-color-border-secondary)]/70 rounded-lg" />
              </div>
              <div className="w-full sm:w-1/3 p-6 flex flex-col gap-4">
                <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-20 mb-2" />
                <div className="flex flex-col gap-2">
                   <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-full" />
                   <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-full" />
                   <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-4/5" />
                   <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-5/6" />
                   <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-2/3" />
                </div>
                
                <div className="mt-8">
                  <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-12 mb-3" />
                  <div className="flex gap-2">
                    <div className="bg-[var(--ant-color-border-secondary)] rounded-md h-6 w-16" />
                    <div className="bg-[var(--ant-color-border-secondary)] rounded-md h-6 w-20" />
                  </div>
                </div>
                
                <div className="mt-auto pt-6 border-t border-[var(--ant-color-border-secondary)]">
                  <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-16 mb-2" />
                  <div className="bg-[var(--ant-color-border-secondary)] rounded h-5 w-48" />
                </div>
              </div>
            </div>
          </div>

          {/* Dataset Card */}
          <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden mt-6">
            <div className="px-6 py-4 border-b border-[var(--ant-color-border-secondary)]">
              <div className="bg-[var(--ant-color-border-secondary)] rounded h-5 w-32" />
            </div>
            <div className="p-0">
               {[1, 2, 3, 4].map(i => (
                 <div key={i} className="flex px-6 py-4 border-b last:border-0 border-[var(--ant-color-border-secondary)]">
                    <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-24 mr-auto" />
                    <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-16 mr-16" />
                    <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-12" />
                 </div>
               ))}
            </div>
          </div>

          {/* Comments Card */}
          <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden mt-6">
            <div className="px-6 py-4 border-b border-[var(--ant-color-border-secondary)] flex items-center justify-between">
              <div className="bg-[var(--ant-color-border-secondary)] rounded h-5 w-32" />
              <div className="bg-[var(--ant-color-border-secondary)] rounded-full h-5 w-8" />
            </div>
            <div className="divide-y divide-gray-100">
              {[1, 2, 3].map(i => (
                 <div key={i} className="p-6 flex gap-4">
                    <div className="bg-[var(--ant-color-border-secondary)] rounded-full h-10 w-10 shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-32" />
                        <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-16" />
                      </div>
                      <div className="bg-[var(--ant-color-bg-layout)] rounded-lg p-3 border border-[var(--ant-color-border-secondary)] flex flex-col gap-2">
                         <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-full" />
                         <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-4/5" />
                      </div>
                    </div>
                 </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="w-full lg:w-80 flex flex-col gap-6 shrink-0">
          {/* Author */}
          <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
             <div className="px-5 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]">
                <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-16" />
             </div>
             <div className="p-5 flex items-center gap-4">
                <div className="bg-[var(--ant-color-border-secondary)] rounded-full h-12 w-12 shrink-0" />
                <div className="flex flex-col gap-2">
                  <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-32" />
                  <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-20" />
                  <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-24" />
                </div>
             </div>
          </div>

          {/* Engagement */}
          <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
             <div className="px-5 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]">
                <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-24" />
             </div>
             <div className="p-2 grid grid-cols-2 gap-2">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex flex-col items-center justify-center p-3 gap-2">
                     <div className="bg-[var(--ant-color-border-secondary)] rounded h-5 w-16" />
                     <div className="bg-[var(--ant-color-border-secondary)] rounded h-3 w-16" />
                  </div>
                ))}
             </div>
          </div>

          {/* Publishing */}
          <div className="bg-[var(--ant-color-bg-container)] border border-[var(--ant-color-border)] shadow-sm rounded-xl overflow-hidden">
             <div className="px-5 py-4 border-b border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-layout)]">
                <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-24" />
             </div>
             <div className="p-5 flex flex-col gap-4">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex justify-between items-center pb-3 border-b last:border-0 last:pb-0 border-[var(--ant-color-border-secondary)]">
                     <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-20" />
                     <div className="bg-[var(--ant-color-border-secondary)] rounded h-4 w-24" />
                  </div>
                ))}
             </div>
          </div>
        </aside>
      </div>
    </div>
  );
};

export default FeedDetailSkeleton;

