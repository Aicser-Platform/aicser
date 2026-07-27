'use client';

import React from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

/** Quiet section label — consistent muted style + optional tooltip (no instructional paragraphs). */
export function PpLabel({
  children,
  tip,
}: {
  children: React.ReactNode;
  tip?: string;
}) {
  return (
    <div className="pp-section-label">
      <span>{children}</span>
      {tip ? (
        <Tooltip title={tip}>
          <InfoCircleOutlined className="pp-section-label-tip" aria-label={tip} />
        </Tooltip>
      ) : null}
    </div>
  );
}

export default PpLabel;
