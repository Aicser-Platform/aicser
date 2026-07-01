'use client';

import React from 'react';
import { Button } from 'antd';
import {
  BulbOutlined,
  CompassOutlined,
  DashboardOutlined,
  FireOutlined,
  MessageOutlined,
  ShareAltOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { FeedFiltersValue } from './FeedFilters';
import { getChatHref, isEnterpriseEdition } from '@/utils/appPaths';

const defaultTeamScope = isEnterpriseEdition() ? 'organization' : 'public';

export type FeedExploreAction =
  | { type: 'chat'; prompt: string }
  | { type: 'navigate'; path: string }
  | { type: 'filters'; patch: Partial<FeedFiltersValue> };

interface FeedExploreStripProps {
  variant?: 'compact' | 'empty';
  onAction: (action: FeedExploreAction) => void;
  onDiscover?: () => void;
}

const FeedExploreStrip: React.FC<FeedExploreStripProps> = ({
  variant = 'compact',
  onAction,
  onDiscover,
}) => {
  const t = useTranslations('feed_page');
  const router = useRouter();

  const chips: Array<{
    key: string;
    label: string;
    icon: React.ReactNode;
    action: FeedExploreAction;
  }> = [
    {
      key: 'trending',
      label: t('explore_chip_trending'),
      icon: <FireOutlined />,
      action: { type: 'filters', patch: { sort: 'trending', scope: defaultTeamScope } },
    },
    {
      key: 'team',
      label: t('explore_chip_team'),
      icon: <TeamOutlined />,
      action: { type: 'filters', patch: { scope: defaultTeamScope, sort: 'recommended' } },
    },
    {
      key: 'question',
      label: t('explore_chip_question'),
      icon: <MessageOutlined />,
      action: { type: 'chat', prompt: t('explore_prompt_question') },
    },
    {
      key: 'learn',
      label: t('explore_chip_learn'),
      icon: <BulbOutlined />,
      action: { type: 'chat', prompt: t('explore_prompt_learn') },
    },
    {
      key: 'build_dashboard',
      label: t('explore_chip_build_dashboard'),
      icon: <DashboardOutlined />,
      action: { type: 'chat', prompt: t('explore_prompt_build_dashboard') },
    },
    {
      key: 'share_insight',
      label: t('explore_chip_share_insight'),
      icon: <ShareAltOutlined />,
      action: { type: 'navigate', path: '/feed/publish' },
    },
  ];

  const visibleChips = variant === 'compact' ? chips.slice(0, 4) : chips;

  const handleChip = (action: FeedExploreAction) => {
    if (action.type === 'chat') {
      router.push(getChatHref({ prompt: action.prompt }));
      return;
    }
    if (action.type === 'navigate') {
      router.push(action.path);
      return;
    }
    onAction(action);
  };

  const chipButtonClassName =
    'inline-flex items-center gap-1.5 rounded-full border border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] px-3 py-1.5 text-sm text-[var(--ant-color-text-secondary)] transition-colors hover:border-[var(--ant-color-primary)] hover:text-[var(--ant-color-primary)] hover:bg-[var(--ant-color-primary-bg)]';

  if (variant === 'compact') {
    return (
      <div className="flex flex-wrap items-center gap-2 mb-4" aria-label={t('explore_strip_aria')}>
        {visibleChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-label={chip.label}
            onClick={() => handleChip(chip.action)}
            className={chipButtonClassName}
          >
            {chip.icon}
            <span>{chip.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-label={t('explore_strip_aria')}>
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm font-medium text-[var(--ant-color-text-secondary)]">{t('explore_empty_title')}</p>
        {onDiscover ? (
          <Button size="small" icon={<CompassOutlined />} onClick={onDiscover}>
            {t('discover')}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {visibleChips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            aria-label={chip.label}
            onClick={() => handleChip(chip.action)}
            className={chipButtonClassName}
          >
            {chip.icon}
            <span>{chip.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default FeedExploreStrip;
