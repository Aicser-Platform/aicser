'use client';

/**
 * Dismissible banner shown below a given viewport width — for desktop-first
 * canvas surfaces (SQL editor, chart designer) that have no responsive layout
 * yet, so narrow-viewport users at least get a signal instead of a silently
 * broken layout. Dismissal is remembered per-surface in localStorage.
 */

import React, { useEffect, useState } from 'react';
import { Alert } from 'antd';
import { DesktopOutlined } from '@ant-design/icons';

const STORAGE_PREFIX = 'aicser:narrow-viewport-notice-dismissed:';

export interface NarrowViewportNoticeProps {
  message: string;
  /** Unique per surface (e.g. "query-editor", "chart-designer") — used as the localStorage key. */
  storageKey: string;
  breakpoint?: number;
}

export const NarrowViewportNotice: React.FC<NarrowViewportNoticeProps> = ({
  message,
  storageKey,
  breakpoint = 768,
}) => {
  const [isNarrow, setIsNarrow] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(`${STORAGE_PREFIX}${storageKey}`) === '1');
    } catch {
      setDismissed(false);
    }

    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const update = () => setIsNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [storageKey, breakpoint]);

  if (!isNarrow || dismissed) return null;

  return (
    <div style={{ padding: '6px 12px' }}>
      <Alert
        type="warning"
        showIcon
        icon={<DesktopOutlined />}
        message={message}
        closable
        onClose={() => {
          setDismissed(true);
          try {
            window.localStorage.setItem(`${STORAGE_PREFIX}${storageKey}`, '1');
          } catch {
            // private browsing / storage disabled — dismissal just won't persist
          }
        }}
        style={{ borderRadius: 8 }}
      />
    </div>
  );
};

export default NarrowViewportNotice;
