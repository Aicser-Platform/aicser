'use client';

import React from 'react';
import { Typography } from 'antd';

type Props = {
  label: string;
  scopeTag?: React.ReactNode;
  trailing?: React.ReactNode;
};

/** Slicer-style field label above report filter controls. */
export function FilterFieldLabel({ label, scopeTag, trailing }: Props) {
  return (
    <div className="gfb-field-label-row">
      <div className="gfb-field-label-main">
        <Typography.Text type="secondary" className="gfb-field-label">
          {label}
        </Typography.Text>
        {scopeTag}
      </div>
      {trailing}
    </div>
  );
}

type ShellProps = {
  label: string;
  scopeTag?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
};

export function FilterControlShell({ label, scopeTag, trailing, className, style, children }: ShellProps) {
  return (
    <div className={`gfb-filter-control${className ? ` ${className}` : ''}`} style={style}>
      <FilterFieldLabel label={label} scopeTag={scopeTag} trailing={trailing} />
      <div className="gfb-filter-control-body">{children}</div>
    </div>
  );
}

export default FilterControlShell;
