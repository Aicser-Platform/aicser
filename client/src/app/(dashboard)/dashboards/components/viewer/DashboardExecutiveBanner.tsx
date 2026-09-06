'use client';

import React, { useEffect, useState } from 'react';
import { Button } from 'antd';
import { BulbOutlined, CloseOutlined, DownOutlined, UpOutlined } from '@ant-design/icons';
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
  /** Scopes the dismiss preference to this dashboard. Without it the banner
   * is not dismissable — the caller opted out of persistence rather than
   * dismiss being silently unavailable. */
  dashboardId?: string;
};

/** A short, stable fingerprint of the banner's own content, so dismissing
 * today's insight doesn't also hide tomorrow's different one once the
 * dashboard regenerates — re-running the AI dashboard (or its data changing
 * enough to reword the headline) naturally un-dismisses. */
function contentFingerprint(insight?: string): string {
  const s = (insight || '').trim();
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return String(hash);
}

export function DashboardExecutiveBanner({
  keyInsight,
  storyArc,
  widgetInsights = [],
  className = '',
  dashboardId,
}: Props) {
  const t = useTranslations('dashboard_viewer');
  const [expanded, setExpanded] = useState(false);

  const insight = keyInsight?.trim();
  const narrative = storyArc?.trim();
  const items = widgetInsights.filter((w) => w.insight?.trim());

  const storageKey = dashboardId ? `aicser_exec_banner_dismissed_${dashboardId}` : null;
  const fingerprint = contentFingerprint(insight);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!storageKey) return;
    try {
      setDismissed(window.localStorage.getItem(storageKey) === fingerprint);
    } catch {
      /* localStorage unavailable (private mode, etc.) — stay non-dismissed */
    }
    // Re-check whenever this dashboard/insight identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, fingerprint]);

  const handleDismiss = () => {
    setDismissed(true);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, fingerprint);
    } catch {
      /* best-effort only — dismiss still works for this session */
    }
  };

  if (!insight && !narrative && !items.length) return null;
  if (dismissed) return null;

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
          {storageKey ? (
            <Button
              type="text"
              className="icon-only-btn no-print"
              icon={<CloseOutlined />}
              onClick={handleDismiss}
              aria-label={t('executive_banner_dismiss')}
            />
          ) : null}
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
