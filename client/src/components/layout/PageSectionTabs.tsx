'use client';

import React from 'react';
import { Tabs } from 'antd';

/**
 * A page's sections, right under its title (Activity / Runs on its own / Saved; Assets / Glossary).
 * One rule everywhere: underline tabs switch sections; a pill switch (Segmented) only switches views
 * of the same content and sits next to that content.
 */
export function PageSectionTabs<K extends string>({ value, onChange, items }: {
  value: K;
  onChange: (key: K) => void;
  items: { key: K; label: React.ReactNode }[];
}) {
  return (
    <Tabs
      className="page-section-tabs"
      activeKey={value}
      onChange={(k) => onChange(k as K)}
      items={items.map((i) => ({ key: i.key, label: i.label }))}
    />
  );
}

export default PageSectionTabs;
