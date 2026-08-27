'use client';

import React from 'react';
import { Button, Popover, Typography } from 'antd';
import { InfoCircleOutlined } from '@ant-design/icons';

const { Paragraph, Text } = Typography;

export interface ErrorDetailsButtonProps {
  /** Raw/technical error text — shown copyable inside the popover. */
  technicalDetail: string;
  /** Button label, e.g. "Show details". */
  label: string;
  /** Popover heading, e.g. "Error details". */
  title?: string;
  size?: 'small' | 'middle';
}

/**
 * Small "Show details" affordance that opens the raw/technical error text in
 * an accessible, copyable popover — replaces dumping technical error strings
 * into a native `title` tooltip (not keyboard-reachable, not copyable).
 */
export const ErrorDetailsButton: React.FC<ErrorDetailsButtonProps> = ({
  technicalDetail,
  label,
  title,
  size = 'small',
}) => {
  if (!technicalDetail || !technicalDetail.trim()) return null;

  return (
    <Popover
      trigger="click"
      placement="bottom"
      title={title}
      content={
        <div style={{ maxWidth: 420 }}>
          <Paragraph copyable={{ text: technicalDetail }} style={{ marginBottom: 0 }}>
            <Text code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {technicalDetail}
            </Text>
          </Paragraph>
        </div>
      }
    >
      <Button size={size} type="link" icon={<InfoCircleOutlined />} onClick={(e) => e.stopPropagation()}>
        {label}
      </Button>
    </Popover>
  );
};

export default ErrorDetailsButton;
