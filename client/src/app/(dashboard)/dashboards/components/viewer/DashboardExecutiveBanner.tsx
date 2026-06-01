'use client';

import React, { useState } from 'react';
import { BulbOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';

export type WidgetInsightItem = {
  id: string;
  title: string;
  insight?: string;
};

export type DashboardExecutiveMeta = {
  keyInsight?: string;
  storyArc?: string;
  widgetInsights?: WidgetInsightItem[];
};

type Props = DashboardExecutiveMeta & {
  className?: string;
};

export function DashboardExecutiveBanner({
  keyInsight,
  storyArc,
  widgetInsights = [],
  className = '',
}: Props) {
  const t = useTranslations('dashboard_viewer');
  const [expanded, setExpanded] = useState(false);

  const insight = keyInsight?.trim();
  const narrative = storyArc?.trim();
  const items = widgetInsights.filter((w) => w.insight?.trim());

  if (!insight && !narrative && !items.length) return null;

  const showToggle = Boolean(narrative || items.length);

  return (
    <section
      className={`dashboard-executive-banner ${className}`.trim()}
      aria-label={t('executive_banner_aria')}
    >
      {insight ? (
        <div className="dashboard-executive-banner-headline">
          <BulbOutlined className="dashboard-executive-banner-icon" aria-hidden />
          <p className="dashboard-executive-banner-insight">{insight}</p>
        </div>
      ) : null}

      {showToggle ? (
        <>
          {expanded && narrative ? (
            <p className="dashboard-executive-banner-narrative">{narrative}</p>
          ) : null}

          {expanded && items.length > 0 ? (
            <ul className="dashboard-executive-banner-insights">
              {items.map((item) => (
                <li key={item.id}>
                  <span className="dashboard-executive-banner-widget-title">{item.title}</span>
                  <span className="dashboard-executive-banner-widget-insight">{item.insight}</span>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            className="dashboard-executive-banner-toggle no-print"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                <UpOutlined /> {t('executive_hide_details')}
              </>
            ) : (
              <>
                <DownOutlined /> {t('executive_show_details', { count: items.length || 1 })}
              </>
            )}
          </button>
        </>
      ) : narrative && !showToggle ? (
        <p className="dashboard-executive-banner-narrative">{narrative}</p>
      ) : null}
    </section>
  );
}

export default DashboardExecutiveBanner;
