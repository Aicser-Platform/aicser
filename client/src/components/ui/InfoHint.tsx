'use client';

import React from 'react';
import { Tooltip } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

/** Explanation on demand: an ⓘ beside a label instead of a sentence on the page. */
export function InfoHint({ text }: { text: React.ReactNode }) {
  return (
    <Tooltip title={text}>
      <InfoCircleOutlined
        tabIndex={0}
        aria-label={typeof text === 'string' ? text : undefined}
        style={{ marginInlineStart: 6, color: 'var(--ant-color-text-tertiary)', fontSize: 13, cursor: 'help' }}
      />
    </Tooltip>
  );
}
