/**
 * RoleBadge Component
 * 
 * Displays a user's role with appropriate styling and colors.
 */

import React from 'react';
import { Tag } from 'antd';
import { 
  CrownOutlined, 
  UserOutlined, 
  TeamOutlined, 
  EyeOutlined 
} from '@ant-design/icons';

export type RoleType = 'owner' | 'admin' | 'member' | 'viewer' | 'project_owner' | 'project_editor' | 'project_viewer';

interface RoleBadgeProps {
  role: RoleType | string;
  size?: 'small' | 'middle' | 'large';
  showIcon?: boolean;
}

const roleConfig: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  owner: {
    color: 'gold',
    icon: <CrownOutlined />,
    label: 'Owner',
  },
  admin: {
    color: 'blue',
    icon: <TeamOutlined />,
    label: 'Admin',
  },
  member: {
    color: 'green',
    icon: <UserOutlined />,
    label: 'Member',
  },
  viewer: {
    color: 'default',
    icon: <EyeOutlined />,
    label: 'Viewer',
  },
  project_owner: {
    color: 'purple',
    icon: <CrownOutlined />,
    label: 'Project Owner',
  },
  project_editor: {
    color: 'cyan',
    icon: <UserOutlined />,
    label: 'Project Editor',
  },
  project_viewer: {
    color: 'default',
    icon: <EyeOutlined />,
    label: 'Project Viewer',
  },
};

export const RoleBadge: React.FC<RoleBadgeProps> = ({
  role,
  size = 'middle',
  showIcon = true,
}) => {
  const normalizedRole = role.toLowerCase();
  const config = roleConfig[normalizedRole] || {
    color: 'default',
    icon: <UserOutlined />,
    label: role,
  };

  return (
    <Tag color={config.color} icon={showIcon ? config.icon : null} style={{ margin: 0 }}>
      {config.label}
    </Tag>
  );
};



