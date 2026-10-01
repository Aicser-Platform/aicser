'use client';

import React from 'react';
import { Collapse } from 'antd';

/** Power features folded by default: the basics come first, as in Datawrapper's Refine tab.
 * Opens by itself when the chart already uses what's inside. */
export const AdvancedCollapse: React.FC<{ title: React.ReactNode; active?: boolean; children: React.ReactNode }> = ({
  title,
  active,
  children,
}) => (
  <Collapse
    size="small"
    ghost
    className="pp-advanced-collapse"
    defaultActiveKey={active ? ['advanced'] : []}
    items={[{ key: 'advanced', label: <span style={{ fontSize: 12 }}>{title}</span>, children }]}
  />
);
