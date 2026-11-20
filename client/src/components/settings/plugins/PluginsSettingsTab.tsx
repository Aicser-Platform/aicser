'use client';

import React, { useMemo, useState } from 'react';
import { Alert, Empty, Input, Segmented, Spin, message } from 'antd';
import { AppstoreAddOutlined, SearchOutlined } from '@ant-design/icons';
import { useAdminPlugins, useTogglePlugin } from '@/plugins/usePlugins';
import type { PluginStateItem } from '@/services/pluginService';
import { PluginCard } from './PluginCard';
import { PluginConfirmModal } from './PluginConfirmModal';

export interface PluginsSettingsTabProps {
  onSetAction?: (node: React.ReactNode) => void;
}

export const PluginsSettingsTab: React.FC<PluginsSettingsTabProps> = () => {
  const { data: plugins = [], isLoading, error } = useAdminPlugins(true);
  const toggleMutation = useTogglePlugin();

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');
  const [pendingDisable, setPendingDisable] = useState<PluginStateItem | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const filteredPlugins = useMemo(() => {
    return plugins.filter((p) => {
      if (kindFilter !== 'all') {
        const hasKind = p.contributions.some((c) => c.kind === kindFilter);
        if (!hasKind) return false;
      }
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const inName = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
        const inDesc = (p.description || '').toLowerCase().includes(q);
        if (!inName && !inDesc) return false;
      }
      return true;
    });
  }, [plugins, kindFilter, search]);

  const executeToggle = async (plugin: PluginStateItem, enabled: boolean) => {
    setMutatingId(plugin.id);
    try {
      await toggleMutation.mutateAsync({ id: plugin.id, enabled });
      void message.success(
        enabled
          ? `${plugin.name} plug-in enabled.`
          : `${plugin.name} plug-in disabled (saved charts and data sources remain intact).`,
      );
    } catch (err) {
      void message.error(
        err instanceof Error ? err.message : `Failed to update ${plugin.name} plug-in`,
      );
    } finally {
      setMutatingId(null);
      setPendingDisable(null);
    }
  };

  const handleToggleRequest = (plugin: PluginStateItem, nextEnabled: boolean) => {
    if (!nextEnabled) {
      setPendingDisable(plugin);
      return;
    }
    void executeToggle(plugin, true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12" data-testid="plugins-loading">
        <Spin description="Loading installed plug-ins..." />
      </div>
    );
  }

  if (error) {
    return (
      <Alert
        type="error"
        showIcon
        title="Could not load plug-ins"
        description={error instanceof Error ? error.message : 'Unexpected error'}
      />
    );
  }

  return (
    <div className="space-y-4" data-testid="plugins-settings-tab">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <Input
          allowClear
          prefix={<SearchOutlined className="text-[var(--ant-color-text-quaternary)]" />}
          placeholder="Search installed plug-ins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          data-testid="plugins-search-input"
        />
        <Segmented
          value={kindFilter}
          onChange={(val) => setKindFilter(String(val))}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Visuals', value: 'visual' },
            { label: 'Connectors', value: 'connector' },
            { label: 'AI & MCP', value: 'mcp_server' },
          ]}
        />
      </div>

      {filteredPlugins.length === 0 ? (
        <Empty
          image={<AppstoreAddOutlined className="text-4xl text-[var(--ant-color-text-quaternary)]" />}
          description="No matching plug-ins found"
        />
      ) : (
        <div className="space-y-3">
          {filteredPlugins.map((plugin) => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              loading={mutatingId === plugin.id}
              onToggle={handleToggleRequest}
            />
          ))}
        </div>
      )}

      <PluginConfirmModal
        plugin={pendingDisable}
        open={Boolean(pendingDisable)}
        loading={Boolean(pendingDisable && mutatingId === pendingDisable.id)}
        onConfirm={() => {
          if (pendingDisable) {
            void executeToggle(pendingDisable, false);
          }
        }}
        onCancel={() => setPendingDisable(null)}
      />
    </div>
  );
};

export default PluginsSettingsTab;

