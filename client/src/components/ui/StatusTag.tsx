'use client';

import React from 'react';
import { Tag } from 'antd';
import {
  CheckCircleFilled,
  ClockCircleOutlined,
  ExclamationCircleFilled,
  InfoCircleFilled,
  MinusCircleOutlined,
  WarningFilled,
} from '@ant-design/icons';

export type StatusTone = 'ok' | 'error' | 'warning' | 'info' | 'pending' | 'neutral';

const TONE: Record<StatusTone, { color: string; icon: React.ReactNode }> = {
  ok: { color: 'success', icon: <CheckCircleFilled /> },
  error: { color: 'error', icon: <ExclamationCircleFilled /> },
  warning: { color: 'warning', icon: <WarningFilled /> },
  info: { color: 'processing', icon: <InfoCircleFilled /> },
  pending: { color: 'default', icon: <ClockCircleOutlined /> },
  neutral: { color: 'default', icon: <MinusCircleOutlined /> },
};

/**
 * A state shown the same way everywhere: tone colour plus a shape, so it still reads for people
 * who can't tell red from green, sized to its text (never stretched to the column).
 */
export function StatusTag({ tone, children, className }: { tone: StatusTone; children: React.ReactNode; className?: string }) {
  const { color, icon } = TONE[tone];
  return (
    <Tag color={color} icon={icon} bordered={false} className={['status-tag', className].filter(Boolean).join(' ')}>
      {children}
    </Tag>
  );
}

/** A stored status word ('past_due', 'active') as a label ('Past due', 'Active'), never shouted. */
export function humanizeStatus(status?: string | null): string {
  const words = String(status ?? '').replace(/_/g, ' ').trim().toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—';
}
