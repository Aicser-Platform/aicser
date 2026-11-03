'use client';

import React from 'react';
import { Badge, Switch, Tag, Tooltip } from 'antd';
import {
  ApiOutlined,
  BarChartOutlined,
  DatabaseOutlined,
  LockOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { PluginContributionItem, PluginStateItem } from '@/services/pluginService';

interface PluginCardProps {
  plugin: PluginStateItem;
  loading?: boolean;
  onToggle: (plugin: PluginStateItem, nextEnabled: boolean) => void;
}

function renderContributionTag(contrib: PluginContributionItem, idx: number) {
  if (contrib.kind === 'visual') {
    return (
      <Tag key={`v-${idx}`} color="blue" icon={<BarChartOutlined />}>
        Visual: {contrib.label || contrib.chart_type}
      </Tag>
    );
  }
  if (contrib.kind === 'connector') {
    return (
      <Tag key={`c-${idx}`} color="purple" icon={<DatabaseOutlined />}>
        Connector: {contrib.label || contrib.db_type}
      </Tag>
    );
  }
  if (contrib.kind === 'ai_skill') {
    return (
      <Tag key={`s-${idx}`} color="green" icon={<ThunderboltOutlined />}>
        AI Skill: {contrib.skill_name}
      </Tag>
    );
  }
  if (contrib.kind === 'mcp_server') {
    return (
      <Tag key={`m-${idx}`} color="cyan" icon={<ApiOutlined />}>
        MCP: {contrib.server_name}
      </Tag>
    );
  }
  return null;
}

export const PluginCard: React.FC<PluginCardProps> = ({
  plugin,
  loading = false,
  onToggle,
}) => {
  return (
    <div
      data-testid={`plugin-card-${plugin.id}`}
      className="flex flex-col justify-between gap-4 rounded-lg border border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] p-4 transition-shadow hover:shadow-sm sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-[var(--ant-color-text)]">
            {plugin.name}
          </span>
          <Tag className="m-0 text-[11px]">v{plugin.version}</Tag>
          {plugin.active ? (
            <Badge status="success" text={<span className="text-xs text-[var(--ant-color-success)]">Active</span>} />
          ) : !plugin.entitled ? (
            <Tag color="gold" icon={<LockOutlined />} className="m-0 text-xs">
              Upgrade Required
            </Tag>
          ) : (
            <Badge status="default" text={<span className="text-xs text-[var(--ant-color-text-tertiary)]">Disabled</span>} />
          )}
          {plugin.author && (
            <span className="text-xs text-[var(--ant-color-text-quaternary)]">
              by {plugin.author}
            </span>
          )}
        </div>

        {plugin.description && (
          <p className="mt-1 mb-2.5 text-xs leading-relaxed text-[var(--ant-color-text-secondary)]">
            {plugin.description}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {plugin.contributions.map((c, idx) => renderContributionTag(c, idx))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3 self-end sm:self-center">
        {!plugin.entitled ? (
          <Tooltip
            title={`Requires plan feature: ${plugin.requires_feature || 'enterprise'}. Upgrade your plan to activate.`}
          >
            <span>
              <Switch
                data-testid={`plugin-toggle-${plugin.id}`}
                checked={false}
                disabled
              />
            </span>
          </Tooltip>
        ) : (
          <Switch
            data-testid={`plugin-toggle-${plugin.id}`}
            checked={plugin.enabled}
            loading={loading}
            onChange={(checked) => onToggle(plugin, checked)}
          />
        )}
      </div>
    </div>
  );
};

