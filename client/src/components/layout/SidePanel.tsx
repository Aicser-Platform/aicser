'use client';

/**
 * One way to fold a side panel, used by every workspace (Prepare, Semantic model, Lake tables,
 * Chart library, Dashboards): a small « / » toggle in the panel's header, and when folded a 40px
 * rail with the panel's icon and name that opens it again. The state is remembered per panel.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Tooltip, Typography } from 'antd';
import { DoubleLeftOutlined, DoubleRightOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import './SidePanel.css';

const { Text } = Typography;

export type PanelSide = 'left' | 'right';

const storageKey = (id: string) => `aicser.panel.${id}`;

/** Whether a panel is folded, remembered in this browser. `defaultCollapsed` applies until the
 * person chooses (e.g. fold a secondary panel on laptop-width screens). */
export function usePanelCollapsed(id: string, defaultCollapsed: boolean | (() => boolean) = false): [boolean, (next: boolean) => void] {
  const initial = () => {
    try {
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey(id)) : null;
      if (saved === '1' || saved === '0') return saved === '1';
    } catch {
      /* storage blocked: use the default */
    }
    return typeof defaultCollapsed === 'function' ? defaultCollapsed() : defaultCollapsed;
  };
  const [collapsed, setCollapsed] = useState<boolean>(initial);
  // Another panel with the same id (e.g. the page re-mounted) stays in step.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === storageKey(id) && (e.newValue === '1' || e.newValue === '0')) setCollapsed(e.newValue === '1');
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id]);
  const set = useCallback((next: boolean) => {
    setCollapsed(next);
    try {
      window.localStorage.setItem(storageKey(id), next ? '1' : '0');
    } catch {
      /* not remembered, still works */
    }
  }, [id]);
  return [collapsed, set];
}

/** The « / » button: it points the way the panel moves. */
export function PanelToggle({ side, collapsed, onToggle, label }: {
  side: PanelSide; collapsed: boolean; onToggle: () => void; label: string;
}) {
  const t = useTranslations('common');
  const folds = side === 'left' ? !collapsed : collapsed;
  const text = collapsed ? t('panel_expand', { name: label }) : t('panel_collapse', { name: label });
  return (
    <Tooltip title={text} placement={side === 'left' ? 'right' : 'left'} mouseEnterDelay={0.4}>
      <Button
        type="text"
        size="small"
        className="side-panel__toggle"
        aria-label={text}
        aria-expanded={!collapsed}
        icon={folds ? <DoubleLeftOutlined /> : <DoubleRightOutlined />}
        onClick={onToggle}
      />
    </Tooltip>
  );
}

/** A folded panel: the toggle, the panel's icon (with a count when there is one), its name. */
export function CollapsedRail({ side, label, icon, count, onExpand, className }: {
  side: PanelSide; label: string; icon?: React.ReactNode; count?: number; onExpand: () => void; className?: string;
}) {
  return (
    <div className={`side-panel-rail side-panel-rail--${side}${className ? ` ${className}` : ''}`}>
      <PanelToggle side={side} collapsed onToggle={onExpand} label={label} />
      <button type="button" className="side-panel-rail__body" onClick={onExpand} aria-label={label}>
        {icon ? (
          <Badge count={count} size="small" offset={[4, -2]}>
            <span className="side-panel-rail__icon" aria-hidden>{icon}</span>
          </Badge>
        ) : null}
        <span className="side-panel-rail__label">{label}</span>
      </button>
    </div>
  );
}

/**
 * A side panel with its header (title, optional extras, the toggle) and its content; folded, the
 * rail. Its width is its own, so the page's grid column is `auto`.
 */
export function SidePanel({
  id, side, title, icon, extra, count, width = 260, defaultCollapsed, className, children, ariaLabel, header,
}: {
  id: string;
  side: PanelSide;
  title: string;
  icon?: React.ReactNode;
  /** Right of the title: a count, a status tag, small actions. */
  extra?: React.ReactNode;
  /** Shown on the folded rail (e.g. how many suggestions are waiting). */
  count?: number;
  width?: number;
  defaultCollapsed?: boolean | (() => boolean);
  className?: string;
  ariaLabel?: string;
  /** In place of the title (e.g. the panel's search box, as the chart library has); the title
   * still names the folded rail and the toggle. */
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = usePanelCollapsed(id, defaultCollapsed);
  if (collapsed) {
    return (
      <aside className={`side-panel side-panel--collapsed ${className ?? ''}`} aria-label={ariaLabel ?? title}>
        <CollapsedRail side={side} label={title} icon={icon} count={count} onExpand={() => setCollapsed(false)} />
      </aside>
    );
  }
  const toggle = <PanelToggle side={side} collapsed={false} onToggle={() => setCollapsed(true)} label={title} />;
  return (
    <aside
      className={`side-panel side-panel--${side} ${className ?? ''}`}
      style={{ ['--side-panel-width' as string]: `${width}px` }}
      aria-label={ariaLabel ?? title}
    >
      <div className="side-panel__head">
        {side === 'right' ? toggle : null}
        {header ?? <Text strong className="side-panel__title">{icon ? <span className="side-panel__title-icon" aria-hidden>{icon}</span> : null}{title}</Text>}
        <span className="side-panel__extra">{extra}</span>
        {side === 'left' ? toggle : null}
      </div>
      {children}
    </aside>
  );
}

export default SidePanel;
