'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { Tooltip } from 'antd';
import { RightOutlined } from '@ant-design/icons';
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
}

export type SidebarNavHandle = {
  dismissOverlays: () => void;
};

/* ── Collapsed rail: click-triggered submenu layer ───────────────────────── */

interface CollapsedSubmenuLayerProps {
  group: Extract<NavItemDef, { kind: 'group' }>;
  anchorTop: number;
  title: string;
  selectedKey: string;
  icons: SidebarNavIconMap;
  onNavigate: (href: string) => void;
  onDismiss: () => void;
  t: (key: string) => string;
}

const CollapsedSubmenuLayer: React.FC<CollapsedSubmenuLayerProps> = ({
  group,
  anchorTop,
  title,
  selectedKey,
  icons,
  onNavigate,
  onDismiss,
  t,
}) => {
  const layerTop = Math.max(8, anchorTop - 8);

  return createPortal(
    <div
      className="sidebar-nav-popover-layer"
      style={{ top: layerTop }}
      role="presentation"
    >
      <div className="sidebar-nav-popover-rail" aria-hidden />
      <div className="sidebar-nav-popover-panel" role="menu" aria-label={title}>
        <div className="sidebar-nav-popover-title">{title}</div>
        <ul className="sidebar-nav-popover-list">
          {group.children.map((child) => {
            const active = selectedKey === child.key;
            return (
              <li key={child.key}>
                <button
                  type="button"
                  role="menuitem"
                  className={`sidebar-nav-popover-item${active ? ' is-active' : ''}`}
                  onClick={() => {
                    onDismiss();
                    onNavigate(child.href);
                  }}
                >
                  {icons[child.key] ? (
                    <span className="sidebar-nav-popover-item-icon">{icons[child.key]}</span>
                  ) : null}
                  <span>{t(child.labelKey)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>,
    document.body
  );
};

/* ── Leaf link ─────────────────────────────────────────────────────────────── */

function NavLinkRow({
  item,
  active,
  railCollapsed,
  icon,
  label,
  onNavigate,
}: {
  item: Extract<NavItemDef, { kind: 'link' }>;
  active: boolean;
  railCollapsed: boolean;
  icon: React.ReactNode;
  label: string;
  onNavigate: (href: string) => void;
}) {
  const btn = (
    <button
      type="button"
      className={`sidebar-nav-link${active ? ' is-active' : ''}`}
      onClick={() => onNavigate(item.href)}
      aria-current={active ? 'page' : undefined}
    >
      <span className="sidebar-nav-link-icon">{icon}</span>
      {!railCollapsed && <span className="sidebar-nav-link-label">{label}</span>}
    </button>
  );

  if (railCollapsed) {
    return (
      <Tooltip title={label} placement="right" mouseEnterDelay={0.35}>
        {btn}
      </Tooltip>
    );
  }
  return btn;
}

/* ── Group row ─────────────────────────────────────────────────────────────── */

function NavGroupRow({
  group,
  isOpen,
  railCollapsed,
  isPopoverTarget,
  selectedKey,
  icon,
  label,
  icons,
  onNavigate,
  onToggleExpanded,
  onOpenPopover,
  onClosePopover,
  t,
}: {
  group: Extract<NavItemDef, { kind: 'group' }>;
  isOpen: boolean;
  railCollapsed: boolean;
  isPopoverTarget: boolean;
  selectedKey: string;
  icon: React.ReactNode;
  label: string;
  icons: SidebarNavIconMap;
  onNavigate: (href: string) => void;
  onToggleExpanded: () => void;
  onOpenPopover: (top: number) => void;
  onClosePopover: () => void;
  t: (key: string) => string;
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const childActive = group.children.some((c) => c.key === selectedKey);

  const anchorTop = () => triggerRef.current?.getBoundingClientRect().top ?? 0;

  const handleRailClick = () => {
    if (isPopoverTarget) {
      onClosePopover();
    } else {
      onOpenPopover(anchorTop());
    }
  };

  const handleExpandedClick = () => {
    onToggleExpanded();
  };

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      className={[
        'sidebar-nav-group-trigger',
        childActive && 'has-active-child',
        isOpen && 'is-open',
        isPopoverTarget && 'is-popover-open',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={railCollapsed ? handleRailClick : handleExpandedClick}
      aria-expanded={isOpen || isPopoverTarget}
      aria-haspopup="true"
    >
      <span className="sidebar-nav-link-icon">{icon}</span>
      {!railCollapsed && (
        <>
          <span className="sidebar-nav-link-label">{label}</span>
          <RightOutlined className="sidebar-nav-chevron" aria-hidden />
        </>
      )}
    </button>
  );

  if (railCollapsed) {
    const row = (
      <div className={`sidebar-nav-group is-rail${isPopoverTarget ? ' is-popover-open' : ''}`}>
        {trigger}
      </div>
    );

    if (isPopoverTarget) return row;

    return (
      <Tooltip title={label} placement="right" mouseEnterDelay={0.5}>
        {row}
      </Tooltip>
    );
  }

  return (
    <div
      className={`sidebar-nav-group${isOpen ? ' is-open' : ''}${childActive ? ' has-active-child' : ''}`}
    >
      {trigger}
      <div className="sidebar-nav-submenu" aria-hidden={!isOpen} data-open={isOpen}>
        <div className="sidebar-nav-submenu-inner">
          {group.children.map((child) => {
            const active = selectedKey === child.key;
            return (
              <button
                key={child.key}
                type="button"
                className={`sidebar-nav-sublink${active ? ' is-active' : ''}`}
                onClick={() => onNavigate(child.href)}
                aria-current={active ? 'page' : undefined}
              >
                {icons[child.key] ? (
                  <span className="sidebar-nav-sublink-icon">{icons[child.key]}</span>
                ) : null}
                <span>{t(child.labelKey)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Root ──────────────────────────────────────────────────────────────────── */

export const SidebarNav = React.forwardRef<SidebarNavHandle, SidebarNavProps>(function SidebarNav(
  { items, selectedKey, routeOpenGroups, railCollapsed, onNavigate, icons },
  ref
) {
  const t = useTranslations('nav');

  const routeGroupKey = routeOpenGroups[0] ?? null;

  const [openGroupKey, setOpenGroupKey] = React.useState<string | null>(routeGroupKey);
  const [popover, setPopover] = React.useState<{ key: string; top: number } | null>(null);

  const dismissOverlays = React.useCallback(() => {
    setPopover(null);
  }, []);

  React.useImperativeHandle(ref, () => ({ dismissOverlays }), [dismissOverlays]);

  React.useEffect(() => {
    setOpenGroupKey(routeGroupKey);
    setPopover(null);
  }, [routeGroupKey]);

  React.useEffect(() => {
    if (!railCollapsed) setPopover(null);
  }, [railCollapsed]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissOverlays();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dismissOverlays]);

  const isGroupOpen = (key: string) => openGroupKey === key;
  const toggleExpandedGroup = (key: string) => {
    setOpenGroupKey((currentKey) => (currentKey === key ? null : key));
  };

  const popoverGroup =
    popover && items.find((i) => i.kind === 'group' && i.key === popover.key);

  return (
    <nav
      className={`sidebar-nav${railCollapsed ? ' is-rail' : ' is-expanded'}`}
      aria-label="Main navigation"
    >
      <ul className="sidebar-nav-list">
        {items.map((item) => {
          if (item.kind === 'divider') {
            return <li key="nav-divider" className="sidebar-nav-divider" role="presentation" />;
          }
          if (item.kind === 'link') {
            return (
              <li key={item.key}>
                <NavLinkRow
                  item={item}
                  active={selectedKey === item.key}
                  railCollapsed={railCollapsed}
                  icon={icons[item.key]}
                  label={t(item.labelKey)}
                  onNavigate={onNavigate}
                />
              </li>
            );
          }
          return (
            <li key={item.key}>
              <NavGroupRow
                group={item}
                isOpen={isGroupOpen(item.key)}
                railCollapsed={railCollapsed}
                isPopoverTarget={popover?.key === item.key}
                selectedKey={selectedKey}
                icon={icons[item.key]}
                label={t(item.labelKey)}
                icons={icons}
                onNavigate={onNavigate}
                onToggleExpanded={() => toggleExpandedGroup(item.key)}
                onOpenPopover={(top) => {
                  setPopover({ key: item.key, top });
                }}
                onClosePopover={() => setPopover(null)}
                t={t}
              />
            </li>
          );
        })}
      </ul>

      {railCollapsed &&
        popover &&
        popoverGroup &&
        popoverGroup.kind === 'group' &&
        typeof document !== 'undefined' && (
          <CollapsedSubmenuLayer
            group={popoverGroup}
            anchorTop={popover.top}
            title={t(popoverGroup.labelKey)}
            selectedKey={selectedKey}
            icons={icons}
            onNavigate={onNavigate}
            onDismiss={() => setPopover(null)}
            t={t}
          />
        )}
    </nav>
  );
});

export default SidebarNav;
