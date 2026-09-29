'use client';

import React from 'react';
import { Menu, Tooltip } from 'antd';
import { DownOutlined, RightOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useTranslations } from 'next-intl';
import type { NavItemDef } from './navConfig';
import { NAV_HINT_KEYS } from './navConfig';

export const RAIL_WIDTH = 64;

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
  /** Sections folded until the person opens them (by role); their own choice is remembered. */
  defaultFolded?: string[];
}

const FOLD_STORAGE_KEY = 'aicser.nav.folded';
const NO_FOLDED: string[] = [];

function readFolded(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(FOLD_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeFolded(value: Record<string, boolean>) {
  try {
    window.localStorage.setItem(FOLD_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable: folding still works for this visit */
  }
}

export type SidebarNavHandle = {
  dismissOverlays: () => void;
};

type AntMenuItem = Required<MenuProps>['items'][number];

function flattenHrefs(items: NavItemDef[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const item of items) {
    if (item.kind === 'link') map[item.key] = item.href;
    if (item.kind === 'group' || item.kind === 'section') {
      for (const child of item.children) map[child.key] = child.href;
    }
  }
  return map;
}

function linkItem(child: { key: string; labelKey: string }, icons: SidebarNavIconMap, t: (key: string) => string, railCollapsed: boolean): AntMenuItem {
  const label = t(child.labelKey);
  const hintKey = NAV_HINT_KEYS[child.key];
  return {
    key: child.key,
    icon: icons[child.key],
    label: railCollapsed ? (
      <Tooltip title={hintKey ? `${label} — ${t(hintKey)}` : label} placement="right" mouseEnterDelay={0.35}>
        <span>{label}</span>
      </Tooltip>
    ) : hintKey ? <span title={t(hintKey)}>{label}</span> : label,
  };
}

function buildMenuItems(
  items: NavItemDef[],
  icons: SidebarNavIconMap,
  t: (key: string) => string,
  railCollapsed: boolean,
  isFolded: (key: string) => boolean,
  toggle: (key: string) => void,
): AntMenuItem[] {
  return items.flatMap((item, index): AntMenuItem[] => {
    if (item.kind === 'divider') {
      return [{ type: 'divider', key: `divider-${index}` } as AntMenuItem];
    }
    if (item.kind === 'section') {
      // On the icon rail a section is one icon that opens its pages — a short rail, with each
      // page named in the pop-out instead of a long column of unlabeled icons.
      if (railCollapsed) {
        return [{
          key: item.key,
          icon: icons[item.key],
          label: t(item.labelKey),
          popupClassName: 'nav-section-popup',
          children: [
            { type: 'group', key: `${item.key}-title`, label: t(item.labelKey), children: item.children.map((c) => linkItem(c, icons, t, false)) },
          ],
        } as AntMenuItem];
      }
      const folded = isFolded(item.key);
      const hintKey = NAV_HINT_KEYS[item.key];
      return [{
        type: 'group',
        key: item.key,
        label: (
          <button type="button" className="nav-section-toggle" aria-expanded={!folded}
            title={hintKey ? t(hintKey) : undefined} onClick={() => toggle(item.key)}>
            <span>{t(item.labelKey)}</span>
            {folded ? <RightOutlined aria-hidden /> : <DownOutlined aria-hidden />}
          </button>
        ),
        children: folded ? [] : item.children.map((c) => linkItem(c, icons, t, false)),
      } as AntMenuItem];
    }

    const hintKey = NAV_HINT_KEYS[item.key];
    const label = t(item.labelKey);
    const labelNode = railCollapsed ? (
      <Tooltip title={label} placement="right" mouseEnterDelay={0.35}>
        <span>{label}</span>
      </Tooltip>
    ) : hintKey ? (
      <span title={t(hintKey)}>{label}</span>
    ) : (
      label
    );

    if (item.kind === 'link') {
      return [linkItem(item, icons, t, railCollapsed)];
    }

    return [{
      key: item.key,
      icon: icons[item.key],
      label: labelNode,
      children: item.children.map((child) => ({
        key: child.key,
        icon: icons[child.key],
        label: NAV_HINT_KEYS[child.key] ? <span title={t(NAV_HINT_KEYS[child.key])}>{t(child.labelKey)}</span> : t(child.labelKey),
      })),
    } as AntMenuItem];
  });
}

export const SidebarNav = React.forwardRef<SidebarNavHandle, SidebarNavProps>(function SidebarNav(
  { items, selectedKey, routeOpenGroups, railCollapsed, onNavigate, icons, theme = 'light', defaultFolded = NO_FOLDED },
  ref
) {
  const t = useTranslations('nav');

  // Two separate open states: the expanded sidebar's sections (persistent — only the user
  // folds them) and the icon rail's pop-out menus (transient — closed on outside click,
  // navigation or Escape). They used to share one state, so every outside click, every
  // navigation and every Escape anywhere folded all sections shut, hiding the current page.
  const [openKeys, setOpenKeys] = React.useState<string[]>(routeOpenGroups);
  const [railOpenKeys, setRailOpenKeys] = React.useState<string[]>([]);

  const hrefByKey = React.useMemo(() => flattenHrefs(items), [items]);

  // Section folding: the person's own choice (remembered) over the role default. The section
  // holding the current page is always shown, so you can see where you are.
  const [folded, setFolded] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => setFolded(readFolded()), []);
  const activeSection = React.useMemo(() => {
    for (const item of items) {
      if (item.kind === 'section' && item.children.some((c) => c.key === selectedKey)) return item.key;
    }
    return null;
  }, [items, selectedKey]);
  const isFolded = React.useCallback(
    (key: string) => folded[key] ?? (key !== activeSection && defaultFolded.includes(key)),
    [activeSection, folded, defaultFolded],
  );
  const toggle = React.useCallback((key: string) => {
    setFolded((current) => {
      const next = { ...current, [key]: !isFolded(key) };
      writeFolded(next);
      return next;
    });
  }, [isFolded]);

  const menuItems = React.useMemo(
    () => buildMenuItems(items, icons, t, railCollapsed, isFolded, toggle),
    [items, icons, t, railCollapsed, isFolded, toggle]
  );

  /** The section holding the current page — it always stays open so you can see where you are. */
  const activeGroup = React.useMemo(() => {
    for (const item of items) {
      if (item.kind === 'group' && item.children.some((c) => c.key === selectedKey)) return item.key;
    }
    return null;
  }, [items, selectedKey]);

  React.useEffect(() => {
    const wanted = [...routeOpenGroups, ...(activeGroup ? [activeGroup] : [])];
    if (wanted.length === 0) return;
    setOpenKeys((current) => {
      const missing = wanted.filter((key) => !current.includes(key));
      return missing.length ? [...current, ...missing] : current;
    });
    // Re-run on every navigation, not only when the route's group changes.
  }, [routeOpenGroups, activeGroup, selectedKey]);

  const dismissOverlays = React.useCallback(() => {
    setRailOpenKeys([]);
  }, []);

  React.useImperativeHandle(ref, () => ({ dismissOverlays }), [dismissOverlays]);

  React.useEffect(() => {
    if (!railCollapsed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissOverlays();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissOverlays, railCollapsed]);

  const onOpenChange: MenuProps['onOpenChange'] = (keys) => {
    if (railCollapsed) {
      // One pop-out at a time on the rail.
      const latest = keys.find((key) => !railOpenKeys.includes(key));
      setRailOpenKeys(latest ? [latest] : keys);
      return;
    }
    setOpenKeys(keys);
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
      openKeys={railCollapsed ? railOpenKeys : openKeys}
      onOpenChange={onOpenChange}
      onClick={onClick}
      items={menuItems}
      className="!border-none !bg-transparent"
    />
  );
});

export default SidebarNav;
