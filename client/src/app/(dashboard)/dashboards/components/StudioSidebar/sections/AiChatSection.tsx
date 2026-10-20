'use client';

import React from 'react';
import Link from 'next/link';
import { Button } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { getChatHref, isEnterpriseEdition } from '@/utils/appPaths';
import { useDashboardStore } from '../../../stores/useDashboardStore';
import { buildDashboardStudioSurfaceContext } from '@/agent/dashboardSurfaceContext';
import { SurfaceCopilotPanel } from '@/ee';
import type { PendingSurfaceQuestion } from '@/agent/inlineAsk';

interface AiChatSectionProps {
  activeDashboardId?: string | null;
  activeDashboardName?: string;
  /** A question asked with ⌘J on a widget, sent as soon as the panel is ready. */
  pendingQuestion?: PendingSurfaceQuestion | null;
}

export function AiChatSection({ activeDashboardId, activeDashboardName, pendingQuestion }: AiChatSectionProps) {
  const t = useTranslations('dashboards');
  const layout = useDashboardStore((s) => s.layout);
  const widgets = useDashboardStore((s) => s.widgets);
  const runtimeFilters = useDashboardStore((s) => s.runtimeFilters);
  const loadDashboardById = useDashboardStore((s) => s.loadDashboardById);
  const primaryDataSourceId = widgets.find((w) => w.dataSourceId)?.dataSourceId as string | undefined;

  const chatStudioUrl = activeDashboardId
    ? getChatHref({ mode: 'dashboard', dashboard_id: activeDashboardId })
    : getChatHref({ mode: 'dashboard' });

  const surfaceContext = activeDashboardId
    ? buildDashboardStudioSurfaceContext({
        dashboardId: activeDashboardId,
        title: activeDashboardName,
        intent: 'ask',
        filters: runtimeFilters as unknown[],
        dataSourceId: primaryDataSourceId,
        widgets,
        layout,
      })
    : null;

  const eeCopilot = isEnterpriseEdition() && surfaceContext;

  if (eeCopilot) {
    return (
      <div className="dashboard-ai-sidebar">
        <SurfaceCopilotPanel
          surfaceContext={surfaceContext}
          dataSourceId={primaryDataSourceId}
          fillHeight
          placeholder={t('ai_assistant_prompt_placeholder_short')}
          pendingQuestion={pendingQuestion}
          onRunComplete={(result) => {
            // The assistant edited (or undid) this board on the server: show its version here.
            const changed = result.dashboard_created as { dashboard_id?: string } | undefined;
            if (changed?.dashboard_id && String(changed.dashboard_id) === String(activeDashboardId)) {
              void loadDashboardById(String(activeDashboardId));
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="dashboard-ai-sidebar dashboard-ai-sidebar--ce p-3">
      <p className="text-xs text-text-secondary m-0 mb-2">{t('ai_assistant_desc')}</p>
      <Link href={chatStudioUrl}>
        <Button type="primary" block icon={<RobotOutlined />}>{t('ai_assistant_open_chat')}</Button>
      </Link>
    </div>
  );
}

export default AiChatSection;
