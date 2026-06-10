'use client';

import React from 'react';
import { Card, Empty, Typography } from 'antd';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

const { Text, Title } = Typography;

export type DashboardPageShellProps = {
  children: React.ReactNode;
  className?: string;
  /** Max width for inner content; omit for full width within the shell */
  maxWidth?: number;
  /** Zero padding — for dashboard/chart studio full-bleed layouts */
  fullBleed?: boolean;
  /** Fill remaining viewport height (query editor, data workspaces) */
  fillHeight?: boolean;
  /** Attach to the outer `.page-wrapper` scroll container */
  innerRef?: React.Ref<HTMLDivElement>;
  style?: React.CSSProperties;
};

/** Standard dashboard page scroll container — 24px padding from layout-system.css */
export function DashboardPageShell({
  children,
  className = '',
  maxWidth,
  fullBleed = false,
  fillHeight = false,
  innerRef,
  style,
}: DashboardPageShellProps) {
  const shellClass = [
    'page-wrapper',
    fullBleed ? 'page-wrapper--full-bleed' : '',
    fillHeight ? 'page-wrapper--fill-height' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  const content = maxWidth && !fullBleed ? (
    <div className="page-shell-inner" style={{ maxWidth, margin: '0 auto', width: '100%' }}>
      {children}
    </div>
  ) : (
    children
  );
  return (
    <div ref={innerRef} className={shellClass} style={style}>
      {content}
    </div>
  );
}

export type DashboardPageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  sticky?: boolean;
};

/**
 * Page header — industry-standard two-row layout:
 * Row 1: [icon] Title ........................ Actions
 * Row 2: Subtitle
 */
export function DashboardPageHeader({
  title,
  description,
  icon,
  extra,
  sticky = false,
}: DashboardPageHeaderProps) {
  return (
    <header className={`page-header${sticky ? ' page-header--sticky' : ''}`}>
      <div className="page-header-top">
        <div className="page-header-leading">
          {icon ? <span className="page-header-icon">{icon}</span> : null}
          <Title level={2} className="page-title">
            {title}
          </Title>
        </div>
        {extra ? <div className="page-header-actions">{extra}</div> : null}
      </div>
      {description ? (
        <Text type="secondary" className="page-description">
          {description}
        </Text>
      ) : null}
    </header>
  );
}

export function DashboardPageLoading({ tip }: { tip?: string }) {
  return (
    <div className="page-state-loading">
      <AppLoadingIndicator variant="inline" tip={tip} />
    </div>
  );
}

export type DashboardPageEmptyProps = {
  description: React.ReactNode;
  action?: React.ReactNode;
};

export function DashboardPageEmpty({ description, action }: DashboardPageEmptyProps) {
  return (
    <Card className="page-state-empty" bordered={false}>
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
        {action}
      </Empty>
    </Card>
  );
}
