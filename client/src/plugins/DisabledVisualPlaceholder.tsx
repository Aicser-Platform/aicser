'use client';

import React from 'react';
import { StopOutlined } from '@ant-design/icons';

interface DisabledVisualPlaceholderProps {
  chartType: string;
  label?: string;
  minHeight?: number;
}

export const DisabledVisualPlaceholder: React.FC<DisabledVisualPlaceholderProps> = ({
  chartType,
  label,
  minHeight = 200,
}) => {
  const displayLabel = label || chartType.charAt(0).toUpperCase() + chartType.slice(1);

  return (
    <div
      data-testid="disabled-visual-placeholder"
      className="flex h-full w-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--ant-color-border)] bg-[var(--ant-color-fill-quaternary)] px-6 py-8 text-center"
      style={{ minHeight }}
    >
      <StopOutlined className="mb-2.5 text-2xl text-[var(--ant-color-text-tertiary)]" />
      <div className="text-sm font-semibold text-[var(--ant-color-text)]">
        {displayLabel} visual is not active
      </div>
      <div className="mt-1 max-w-md text-xs leading-relaxed text-[var(--ant-color-text-tertiary)]">
        This chart is currently disabled or not included in your organization&apos;s subscription.
        Contact an administrator to enable it in <strong>Settings &gt; Plug-ins</strong>. Your saved
        chart configuration and data remain intact.
      </div>
    </div>
  );
};

