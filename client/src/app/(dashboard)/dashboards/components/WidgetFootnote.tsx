'use client';

import React from 'react';

/** "Source / notes" line under a chart (Datawrapper's byline): where the numbers come from,
 * or a caveat the reader should know. Hidden when empty. */
export function WidgetFootnote({ note }: { note?: unknown }) {
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text) return null;
  return (
    <div className="widget-card-footnote" title={text}>
      {text}
    </div>
  );
}
