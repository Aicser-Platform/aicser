'use client';

import React from 'react';
import { Button, message } from 'antd';

/**
 * Clear the dashboard's filter selections with an Undo (Gmail / Notion pattern) instead of a
 * confirmation dialog: the action is cheap and reversible, and never touches widgets or the
 * filters themselves — only what's currently selected in them.
 */
export function clearFiltersWithUndo<T>(
  previous: T[],
  apply: (next: T[]) => void,
  labels: { cleared: string; undo: string },
): void {
  if (!previous.length) return;
  const snapshot = [...previous];
  apply([]);
  const key = 'dashboard-filters-cleared';
  message.open({
    key,
    type: 'info',
    duration: 6,
    content: (
      <span>
        {labels.cleared}{' '}
        <Button
          type="link"
          size="small"
          onClick={() => {
            apply(snapshot);
            message.destroy(key);
          }}
        >
          {labels.undo}
        </Button>
      </span>
    ),
  });
}
