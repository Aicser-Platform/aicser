'use client';

import React from 'react';
import { InfoCircleOutlined } from '@ant-design/icons';
import { Card, Empty, Tooltip, Typography } from 'antd';
import { AppLoadingIndicator } from '@/components/ui/AppLoadingIndicator';

const { Title } = Typography;

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
  /** Not drawn: a coloured icon tile beside the title appeared on some pages and not others. */
  icon?: React.ReactNode;
  extra?: React.ReactNode;
  sticky?: boolean;
};

/**
 * Page header — the same on every page: Title (ⓘ for what it's about) ........ Actions.
 * Words stay out of the way: the description opens from the ⓘ, the page keeps the row.
 */
export function DashboardPageHeader({
  title,
  description,
  extra,
  sticky = false,
}: DashboardPageHeaderProps) {
  return (
    <header className={`page-header${sticky ? ' page-header--sticky' : ''}`}>
      <div className="page-header-top">
        <div className="page-header-leading">
          <Title level={2} className="page-title">
            {title}
          </Title>
          {description ? (
            <Tooltip title={description} placement="bottomLeft">
              <InfoCircleOutlined
                className="page-header-info"
                tabIndex={0}
                aria-label={typeof description === 'string' ? description : undefined}
              />
            </Tooltip>
          ) : null}
        </div>
        {extra ? <div className="page-header-actions">{extra}</div> : null}
      </div>
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
    <Card className="page-state-empty" variant="borderless">
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}>
        {action}
      </Empty>
    </Card>
  );
}
