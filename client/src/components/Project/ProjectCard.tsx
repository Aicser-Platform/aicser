'use client';

import React from 'react';
import { Button, Card, Skeleton, Space, Tag, Tooltip } from 'antd';
import { TeamOutlined, DatabaseOutlined, UserOutlined, SwapOutlined, SettingOutlined, CheckCircleFilled } from '@ant-design/icons';
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
  onSettings?: (project: Project) => void;
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
  onSettings,
}) => {
  const isGrid = layout === 'grid';
  const ownerName = project.owner_name || 'Unknown';

  const statChips = (
    <div className={`flex items-center gap-2 ${isGrid ? '' : 'shrink-0'}`}>
      <StatChip icon={<TeamOutlined />} value={stats.members} loading={loadingStats} />
      <StatChip icon={<DatabaseOutlined />} value={stats.dataSources} loading={loadingStats} />
    </div>
  );

  const settingsAction = onSettings ? (
    <Tooltip title="Project settings">
      <Button
        size="small"
        icon={<SettingOutlined />}
        onClick={(e) => {
          e.stopPropagation();
          onSettings(project);
        }}
      />
    </Tooltip>
  ) : null;

  // A dedicated action, not a whole-card click target: browsing/reading cards in this
  // list (member counts, description) must never itself change the user's active
  // project. The active card swaps this for a same-sized disabled indicator
  // (not null) — dropping the button outright left the action row a
  // different width on the active card than every sibling card, which read
  // as a layout clash across the grid/list rather than a clean "already
  // selected" state.
  const switchAction = !isActive ? (
    <Button
      size="small"
      icon={<SwapOutlined />}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(project);
      }}
    >
      Switch project
    </Button>
  ) : (
    <Button size="small" icon={<CheckCircleFilled />} disabled>
      Current project
    </Button>
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
      variant="outlined"
      className={`rounded-xl border-[var(--ant-color-border)] transition-colors ${
        isActive ? 'border-l-[3px] border-l-[var(--ant-color-primary)]' : ''
      }`}
      styles={{ body: { padding: 16 } }}
    >
      {isGrid ? (
        <div className="flex flex-col gap-3">
          {nameAndDescription}
          {/* flex-wrap, not a fixed row: a 3-column grid leaves each card too
              narrow to fit both stat chips and the full-width "Switch
              project"/"Current project" button on one line without either
              overflowing the card's own padding or the row shrinking them
              illegibly - wrapping the actions onto their own line keeps
              everything inside the card at any grid width. */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {statChips}
            <Space size={8} className="shrink-0">
              {settingsAction}
              {switchAction}
            </Space>
          </div>
        </div>
      ) : (
        <div className="flex flex-row flex-wrap items-center justify-between gap-4">
          {nameAndDescription}
          {statChips}
          <Space size={8} className="shrink-0">
            {settingsAction}
            {switchAction}
          </Space>
        </div>
      )}
    </Card>
  );
};

export default ProjectCard;
