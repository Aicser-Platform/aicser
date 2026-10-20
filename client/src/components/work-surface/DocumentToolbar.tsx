'use client';

import React from 'react';
import { Input, Space, Tag, Tooltip, Typography } from 'antd';
import { CloudSyncOutlined } from '@ant-design/icons';
import './work-surface.css';

const { Text } = Typography;

export type DocumentSaveTone = 'ok' | 'warn' | 'danger';

export type DocumentToolbarProps = {
  title: string;
  titlePlaceholder?: string;
  titleReadOnly?: boolean;
  titleAriaLabel: string;
  onTitleChange?: (value: string) => void;
  onTitleBlur?: () => void;
  saveLabel?: React.ReactNode;
  saveTone?: DocumentSaveTone;
  saveTooltip?: React.ReactNode;
  viewOnly?: boolean;
  viewOnlyLabel?: string;
  statusTags?: React.ReactNode;
  menuRow?: React.ReactNode;
  actions?: React.ReactNode;
};

/**
 * Shared document chrome for Sheets and Notebooks — one product voice above the editor surface.
 */
export function DocumentToolbar({
  title,
  titlePlaceholder,
  titleReadOnly,
  titleAriaLabel,
  onTitleChange,
  onTitleBlur,
  saveLabel,
  saveTone = 'ok',
  saveTooltip,
  viewOnly,
  viewOnlyLabel,
  statusTags,
  menuRow,
  actions,
}: DocumentToolbarProps) {
  const saveType = saveTone === 'danger' ? 'danger' : saveTone === 'warn' ? 'warning' : 'secondary';

  const toolbarActions = menuRow || actions ? (
    <Space size={8} wrap className="ws-doc__actions">
      {menuRow}
      {actions}
    </Space>
  ) : null;

  return (
    <header className="ws-doc">
      <div className="ws-doc__row">
        <div className="ws-doc__title">
          <Input
            variant="borderless"
            className="ws-doc__title-input"
            value={title}
            readOnly={titleReadOnly}
            placeholder={titlePlaceholder}
            maxLength={200}
            aria-label={titleAriaLabel}
            onChange={(e) => onTitleChange?.(e.target.value)}
            onBlur={onTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
          {viewOnly ? (
            <Tag bordered={false}>{viewOnlyLabel}</Tag>
          ) : saveLabel ? (
            <Tooltip title={saveTooltip}>
              <Text type={saveType} className="ws-doc__save" aria-live="polite">
                <CloudSyncOutlined /> {saveLabel}
              </Text>
            </Tooltip>
          ) : null}
          {statusTags}
        </div>
        {toolbarActions}
      </div>
    </header>
  );
}
