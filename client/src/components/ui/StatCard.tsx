'use client';

import React from 'react';
import { Card } from 'antd';

export interface StatCardProps {
  /** Icon shown alongside the label. */
  icon: React.ReactNode;
  /** Small uppercase muted label. */
  label: string;
  /** Large bold primary value. */
  value: React.ReactNode;
  /** Optional small hint line shown below the value. */
  hint?: React.ReactNode;
  className?: string;
}

/**
 * Generic, reusable stat tile — small uppercase label + icon, large value, optional hint.
 * Used across settings/admin surfaces wherever a quick metric needs a card.
 */
export function StatCard({ icon, label, value, hint, className = '' }: StatCardProps) {
  return (
    <Card size="small" bordered className={`rounded-xl ${className}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--ant-color-text-tertiary)]">
        <span className="shrink-0 text-sm leading-none">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1.5 text-xl font-bold leading-[1.3] text-[var(--ant-color-text)]">{value}</div>
      {hint != null && (
        <div className="mt-0.5 text-xs leading-[1.4] text-[var(--ant-color-text-tertiary)]">{hint}</div>
      )}
    </Card>
  );
}

export default StatCard;
