'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Empty, Skeleton, Space, message } from 'antd';
import { AppstoreOutlined, BarsOutlined } from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { useQueryClient, useQueries } from '@tanstack/react-query';
import { useProjects } from '@/hooks/useProjects';
import { useProjectStore } from '@/stores/useProjectStore';
import { useOrganizationStore } from '@/stores/useOrganizationStore';
import { useDataSourceStore } from '@/stores/useDataSourceStore';
import { useConversationStore } from '@/stores/useConversationStore';
import { dataSourceKeys } from '@/hooks/dataSourceKeys';
import { listProjectMembers } from '@/api/projects';
import { listDataSources } from '@/api/dataSources';
import { ProjectCard, type ProjectCardStats } from '@/components/Project/ProjectCard';
import type { Project } from '@/types/project';
import type { TabComponentProps } from '../page';

const SKELETON_COUNT = 6;
const STATS_STALE_TIME = 5 * 60 * 1000;

const projectStatsQueryKey = (projectId: string) => ['project-stats', projectId] as const;

const fetchProjectStats = async (projectId: string): Promise<ProjectCardStats> => {
  const [membersResult, dataSourcesResult] = await Promise.allSettled([
    listProjectMembers(projectId),
    listDataSources(projectId),
  ]);
  return {
    members: membersResult.status === 'fulfilled' ? membersResult.value.total : 'error',
    dataSources: dataSourcesResult.status === 'fulfilled' ? dataSourcesResult.value.data_sources.length : 'error',
  };
};

export const ProjectTab: React.FC<TabComponentProps> = ({ onSetAction }) => {
  const t = useTranslations('header');
  const queryClient = useQueryClient();

  const organizationId = useOrganizationStore((s) => s.currentOrganization?.id);
  const { currentProject, selectProject } = useProjectStore();
  const { projects, isLoading } = useProjects(organizationId);

  const [layout, setLayout] = useState<'grid' | 'list'>('grid');

  // No primary action for this tab — clear whatever the previous tab registered.
  useEffect(() => {
    onSetAction?.(null);
  }, [onSetAction]);

  const statsQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: projectStatsQueryKey(project.id),
      queryFn: () => fetchProjectStats(project.id),
      staleTime: STATS_STALE_TIME,
    })),
  });

  const handleSelectProject = (project: Project) => {
    message.loading({ content: t('switching_project'), key: 'project-switch' });
    selectProject(project);
    useDataSourceStore.getState().select(null);
    void queryClient.invalidateQueries({ queryKey: dataSourceKeys.all });
    void useConversationStore.getState().loadConversations(String(project.id));
    message.success({ content: t('switched_to', { name: project.name }), key: 'project-switch', duration: 2 });
  };

  const skeletonCards = useMemo(
    () =>
      Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <Skeleton key={i} active paragraph={{ rows: 2 }} className="rounded-xl border border-[var(--ant-color-border)] p-4" />
      )),
    []
  );

  const cards = projects.map((project, i) => {
    const query = statsQueries[i];
    const stats: ProjectCardStats = query?.data ?? { members: 'error', dataSources: 'error' };
    return (
      <ProjectCard
        key={project.id}
        project={project}
        layout={layout}
        isActive={String(currentProject?.id) === String(project.id)}
        stats={stats}
        loadingStats={query?.isLoading ?? false}
        onSelect={handleSelectProject}
      />
    );
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <Space.Compact>
          <Button
            type={layout === 'grid' ? 'primary' : 'default'}
            icon={<AppstoreOutlined />}
            onClick={() => setLayout('grid')}
          />
          <Button
            type={layout === 'list' ? 'primary' : 'default'}
            icon={<BarsOutlined />}
            onClick={() => setLayout('list')}
          />
        </Space.Compact>
      </div>

      {isLoading ? (
        layout === 'grid' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{skeletonCards}</div>
        ) : (
          <div className="flex flex-col gap-2">{skeletonCards}</div>
        )
      ) : projects.length === 0 ? (
        <Empty description="No projects in this organization" style={{ padding: '48px 0' }} />
      ) : layout === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards}</div>
      ) : (
        <div className="flex flex-col gap-2">{cards}</div>
      )}
    </div>
  );
};
