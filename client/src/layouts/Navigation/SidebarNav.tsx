'use client';

import React from 'react';
import { Menu, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import { useTranslations } from 'next-intl';
import type { NavItemDef } from './navConfig';

export const RAIL_WIDTH = 80;

export interface SidebarNavIconMap {
  [key: string]: React.ReactNode;
}

export interface SidebarNavProps {
  items: NavItemDef[];
  selectedKey: string;
  routeOpenGroups: string[];
  railCollapsed: boolean;
  onNavigate: (href: string) => void;
  icons: SidebarNavIconMap;
  theme?: 'light' | 'dark';
}

export type SidebarNavHandle = {
  dismissOverlays: () => void;
};

type AntMenuItem = Required<MenuProps>['items'][number];

function flattenHrefs(items: NavItemDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of items) {
    if (item.kind === 'link') map[item.key] = item.href;
    if (item.kind === 'group') {
      for (const child of item.children) map[child.key] = child.href;
    }
  }
  return map;
}

function buildMenuItems(
  items: NavItemDef[],
  icons: SidebarNavIconMap,
  t: (key: string) => string,
  railCollapsed: boolean
): AntMenuItem[] {
  return items.map((item, index) => {
    if (item.kind === 'divider') {
      return { type: 'divider', key: `divider-${index}` } as AntMenuItem;
    }

    const label = t(item.labelKey);
    const labelNode = railCollapsed ? (
      <Tooltip title={label} placement="right" mouseEnterDelay={0.35}>
        <span>{label}</span>
      </Tooltip>
    ) : (
      label
    );

    if (item.kind === 'link') {
      return { key: item.key, icon: icons[item.key], label: labelNode };
    }

    return {
      key: item.key,
      icon: icons[item.key],
      label: railCollapsed ? labelNode : label,
      children: item.children.map((child) => ({
        key: child.key,
        icon: icons[child.key],
        label: t(child.labelKey),
      })),
    };
  });
}

export const SidebarNav = React.forwardRef<SidebarNavHandle, SidebarNavProps>(function SidebarNav(
  { items, selectedKey, routeOpenGroups, railCollapsed, onNavigate, icons, theme = 'light' },
  ref
) {
  const t = useTranslations('nav');

  const [openKeys, setOpenKeys] = React.useState<string[]>(routeOpenGroups);

  const hrefByKey = React.useMemo(() => flattenHrefs(items), [items]);

  const rootSubmenuKeys = React.useMemo(
    () =>
      items
        .filter((item): item is Extract<NavItemDef, { kind: 'group' }> => item.kind === 'group')
        .map((group) => group.key),
    [items]
  );

  const menuItems = React.useMemo(
    () => buildMenuItems(items, icons, t, railCollapsed),
    [items, icons, t, railCollapsed]
  );

  React.useEffect(() => {
    if (routeOpenGroups.length === 0) return;
    setOpenKeys((current) => {
      const next = new Set(current);
      let changed = false;
      for (const key of routeOpenGroups) {
        if (!next.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? Array.from(next) : current;
    });
  }, [routeOpenGroups]);

  const dismissOverlays = React.useCallback(() => {
    setOpenKeys([]);
  }, []);

  React.useImperativeHandle(ref, () => ({ dismissOverlays }), [dismissOverlays]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissOverlays();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissOverlays]);

  // Accordion behaviour: opening a top-level group closes any other open group.
  const onOpenChange: MenuProps['onOpenChange'] = (keys) => {
    const latestOpenKey = keys.find((key) => openKeys.indexOf(key) === -1);
    if (!latestOpenKey || rootSubmenuKeys.indexOf(latestOpenKey) === -1) {
      setOpenKeys(keys);
    } else {
      setOpenKeys([latestOpenKey]);
    }
  };

  const onClick: MenuProps['onClick'] = ({ key }) => {
    const href = hrefByKey[key];
    if (href) onNavigate(href);
  };

  return (
    <Menu
      mode="inline"
      theme={theme}
      inlineCollapsed={railCollapsed}
      triggerSubMenuAction="click"
      selectedKeys={selectedKey ? [selectedKey] : []}
      openKeys={railCollapsed ? undefined : openKeys}
      onOpenChange={onOpenChange}
      onClick={onClick}
      items={menuItems}
      className="!border-none !bg-transparent"
    />
  );
});

export default SidebarNav;
