'use client';

import React from 'react';
import { Card, Skeleton, Tag, Tooltip } from 'antd';
import { TeamOutlined, DatabaseOutlined, UserOutlined } from '@ant-design/icons';
import type { Project } from '@/types/project';

export interface ProjectCardStats {
  members: number | 'error';
  dataSources: number | 'error';
}

export interface ProjectCardProps {
  project: Project;
  isActive: boolean;
  layout: 'grid' | 'list';
  stats: ProjectCardStats;
  loadingStats?: boolean;
  onSelect: (project: Project) => void;
}

/** Small muted stat chip — icon + count, with loading/error sub-states. */
const StatChip: React.FC<{
  icon: React.ReactNode;
  value: number | 'error';
  loading?: boolean;
}> = ({ icon, value, loading }) => {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ant-color-fill-tertiary)] px-2.5 py-1 text-xs text-[var(--ant-color-text-secondary)]">
      <span className="shrink-0 text-sm leading-none">{icon}</span>
      {loading ? (
        <Skeleton.Button size="small" active style={{ width: 24, height: 14 }} />
      ) : value === 'error' ? (
        <Tooltip title="Not available — you may not have access to this project's data">
          <span>—</span>
        </Tooltip>
      ) : (
        <span>{value}</span>
      )}
    </span>
  );
};

/**
 * Card for a single project — shown in a list or grid, used by the Settings
 * "Project" tab to let users browse and switch between all projects in the org.
 */
export const ProjectCard: React.FC<ProjectCardProps> = ({
  project,
  isActive,
  layout,
  stats,
  loadingStats = false,
  onSelect,
}) => {
  const isGrid = layout === 'grid';
  const ownerName = project.owner_name || 'Unknown';

  const statChips = (
    <div className={`flex items-center gap-2 ${isGrid ? '' : 'shrink-0'}`}>
      <StatChip icon={<TeamOutlined />} value={stats.members} loading={loadingStats} />
      <StatChip icon={<DatabaseOutlined />} value={stats.dataSources} loading={loadingStats} />
    </div>
  );

  const nameAndDescription = (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <span className="truncate text-[15px] font-semibold text-[var(--ant-color-text)]">{project.name}</span>
        <Tooltip title={`Owned by ${ownerName}`}>
          <Tag
            icon={<UserOutlined />}
            color="default"
            style={{ marginInlineEnd: 0, maxWidth: 180 }}
            className="truncate"
          >
            Owner: {ownerName}
          </Tag>
        </Tooltip>
        {isActive && (
          <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
            Active
          </Tag>
        )}
      </div>
      {project.description ? (
        <p className="mb-0 mt-1 line-clamp-2 text-sm text-[var(--ant-color-text-secondary)]">
          {project.description}
        </p>
      ) : (
        <p className="mb-0 mt-1 text-sm text-[var(--ant-color-text-tertiary)]">No description</p>
      )}
    </div>
  );

  return (
    <Card
      hoverable
      bordered
      onClick={() => onSelect(project)}
      className={`rounded-xl cursor-pointer border-[var(--ant-color-border)] transition-colors hover:border-[var(--ant-color-primary)] ${
        isActive ? 'border-l-[3px] border-l-[var(--ant-color-primary)]' : ''
      }`}
      styles={{ body: { padding: 16 } }}
    >
      {isGrid ? (
        <div className="flex flex-col gap-3">
          {nameAndDescription}
          {statChips}
        </div>
      ) : (
        <div className="flex flex-row items-center justify-between gap-4">
          {nameAndDescription}
          {statChips}
        </div>
      )}
    </Card>
  );
};

export default ProjectCard;
