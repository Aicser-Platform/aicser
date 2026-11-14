'use client';

import React, { useMemo } from 'react';
import { App, Segmented, Typography } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { buildEnterpriseSidebarItems, filterSidebarItems, type NavItemDef } from '@/layouts/Navigation/navConfig';
import { useSubscriptionStore } from '@/stores/useSubscriptionStore';
import { ORG_MENU_KEY, useOrgMenu, type MenuLevel, type OrgMenu } from '@/hooks/useOrgMenu';
import { fetchApi } from '@/utils/api';

/** What the organization shows in the menu. Access itself stays with roles and the plan. */
export default function MenuTab() {
  const t = useTranslations('settings_menu');
  const tNav = useTranslations('nav');
  const { message } = App.useApp();
  const client = useQueryClient();
  const menu = useOrgMenu();
  const { features } = useSubscriptionStore();

  // Everything the plan includes, whatever is switched off now: that's what can be switched on.
  const items = useMemo<NavItemDef[]>(() => filterSidebarItems(buildEnterpriseSidebarItems(true), {
    hasFeature: (feature) => (features as Record<string, unknown> | undefined)?.[feature] !== false,
  }), [features]);

  const save = async (key: string, level: MenuLevel) => {
    const before = client.getQueryData<{ items: OrgMenu }>(ORG_MENU_KEY);
    const next = { ...menu, [key]: level };
    client.setQueryData(ORG_MENU_KEY, { items: next });
    try {
      await fetchApi('/api/organizations/me/menu', { method: 'PUT', body: JSON.stringify({ items: next }) });
    } catch (error) {
      client.setQueryData(ORG_MENU_KEY, before);
      message.error(error instanceof Error && error.message ? error.message : t('failed'));
    }
  };

  const row = (key: string, labelKey: string) => (
    <div key={key} className="settings-menu-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '6px 0' }}>
      <Typography.Text>{tNav(labelKey as 'feed')}</Typography.Text>
      <Segmented
        size="small"
        value={menu[key] ?? 'everyone'}
        onChange={(value) => void save(key, value as MenuLevel)}
        aria-label={tNav(labelKey as 'feed')}
        options={[
          { value: 'everyone', label: t('everyone') },
          { value: 'admins', label: t('admins') },
          { value: 'off', label: t('off') },
        ]}
      />
    </div>
  );

  return (
    <div style={{ maxWidth: 560 }}>
      <Typography.Paragraph type="secondary">{t('subtitle')}</Typography.Paragraph>
      {items.map((item) => {
        if (item.kind === 'divider') return null;
        if (item.kind === 'link') return row(item.key, item.labelKey);
        return (
          <div key={item.key} style={{ marginTop: 16 }}>
            <Typography.Text strong>{tNav(item.labelKey as 'feed')}</Typography.Text>
            {item.children.map((child) => row(child.key, child.labelKey))}
          </div>
        );
      })}
    </div>
  );
}
