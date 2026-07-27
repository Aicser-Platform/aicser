'use client';

import React from 'react';
import { Breadcrumb } from 'antd';
import { useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { NAV_LABEL_KEYS, NAV_PARENT_GROUP, selectedKeyForPathname } from './navConfig';

/**
 * Page-level "you are here" trail, shown above every dashboard-shell page.
 * Reuses the same nav label keys as the sidebar (NAV_LABEL_KEYS) so the two
 * never drift out of sync, and the same AntD Breadcrumb pattern already used
 * for dashboard drill-down (see dashboards/components/DrillBreadcrumb.tsx).
 */
export function PageBreadcrumb() {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() ? `?${searchParams.toString()}` : null;
  const key = selectedKeyForPathname(pathname, search);
  const labelKey = key ? NAV_LABEL_KEYS[key] : undefined;

  if (!key || !labelKey) return null;

  const parentKey = NAV_PARENT_GROUP[key];
  const parentLabelKey = parentKey ? NAV_LABEL_KEYS[parentKey] : undefined;

  // A single-crumb trail (no parent group) just repeats the page's own heading —
  // e.g. Query Editor, Chat, Feed, Settings are flat top-level nav items — so it
  // adds no wayfinding value there and only reads as duplicated text. Only render
  // once there's a real parent > child trail (e.g. Data & Model > Semantic layer).
  if (!parentLabelKey) return null;

  const items = [{ title: t(parentLabelKey) }, { title: t(labelKey) }];

  return (
    <div
      className="page-breadcrumb-bar"
      style={{
        padding: '10px 24px 0',
        fontSize: 13,
        flexShrink: 0,
      }}
    >
      <Breadcrumb items={items} />
    </div>
  );
}

export default PageBreadcrumb;
