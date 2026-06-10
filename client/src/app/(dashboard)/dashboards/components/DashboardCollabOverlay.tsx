'use client';

import React from 'react';
import type { PeerCursor } from '../utils/collaborationTypes';

type Props = {
  cursors: PeerCursor[];
  selfUserId?: string | null;
};

export function DashboardCollabOverlay({ cursors, selfUserId }: Props) {
  const visible = cursors.filter((c) => c.userId !== selfUserId);

  if (!visible.length) return null;

  return (
    <div className="dashboard-collab-overlay" aria-hidden>
      {visible.map((cursor) => (
        <div
          key={cursor.userId}
          className="dashboard-collab-cursor"
          style={{
            left: `${cursor.x * 100}%`,
            top: `${cursor.y * 100}%`,
            ['--collab-color' as string]: cursor.color,
          }}
        >
          <svg className="dashboard-collab-cursor-icon" viewBox="0 0 24 24" width="18" height="18">
            <path
              fill="currentColor"
              d="M5 3l14 7.5-6.2 1.4L9.8 19 5 3z"
            />
          </svg>
          <span className="dashboard-collab-cursor-label">{cursor.name}</span>
        </div>
      ))}
    </div>
  );
}

export default DashboardCollabOverlay;
