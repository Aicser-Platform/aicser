'use client';

import React from 'react';
import { 
  Card, 
  Space, 
  Typography, 
  Button, 
  Tooltip, 
  Badge, 
  Divider,
  Row,
  Col,
  Statistic,
  Progress,
  Tag,
  Avatar,
  Dropdown,
  Menu,
  message
} from 'antd';
import { 
  ThunderboltOutlined,
  RocketOutlined,
  StarOutlined,
  HeartOutlined,
  BulbOutlined,
  SettingOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons';

const { Title, Text, Paragraph } = Typography;

interface UIEnhancementsProps {
  type?: 'dashboard' | 'chart' | 'query' | 'data' | 'analytics';
  title?: string;
  description?: string;
  status?: 'active' | 'inactive' | 'loading' | 'error' | 'success';
  metrics?: {
    value: number | string;
    label: string;
    trend?: 'up' | 'down' | 'stable';
    color?: string;
  }[];
  actions?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    type?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
    disabled?: boolean;
  }[];
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const UIEnhancements: React.FC<UIEnhancementsProps> = ({
  type = 'dashboard',
  title,
  description,
  status = 'active',
  metrics = [],
  actions = [],
  children,
  className,
  style
}) => {
  const getStatusColor = () => {
    switch (status) {
      case 'active':
        return '#52c41a';
      case 'inactive':
        return '#d9d9d9';
      case 'loading':
        return '#1890ff';
      case 'error':
        return '#ff4d4f';
      case 'success':
        return '#52c41a';
      default:
        return '#1890ff';
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'active':
        return <PlayCircleOutlined style={{ color: getStatusColor() }} />;
      case 'inactive':
        return <PauseCircleOutlined style={{ color: getStatusColor() }} />;
      case 'loading':
        return <ReloadOutlined spin style={{ color: getStatusColor() }} />;
      case 'error':
        return <ThunderboltOutlined style={{ color: getStatusColor() }} />;
      case 'success':
        return <StarOutlined style={{ color: getStatusColor() }} />;
      default:
        return <BulbOutlined style={{ color: getStatusColor() }} />;
    }
  };

  const getTypeIcon = () => {
    switch (type) {
      case 'dashboard':
        return <RocketOutlined style={{ fontSize: '24px', color: '#1890ff' }} />;
      case 'chart':
        return <ThunderboltOutlined style={{ fontSize: '24px', color: '#722ed1' }} />;
      case 'query':
        return <BulbOutlined style={{ fontSize: '24px', color: '#52c41a' }} />;
      case 'data':
        return <HeartOutlined style={{ fontSize: '24px', color: '#fa8c16' }} />;
      case 'analytics':
        return <StarOutlined style={{ fontSize: '24px', color: '#eb2f96' }} />;
      default:
        return <SettingOutlined style={{ fontSize: '24px', color: '#1890ff' }} />;
    }
  };

  return (
    <Card
      className={className}
      style={{
        borderRadius: '12px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.05)',
        border: '1px solid #f0f0f0',
        transition: 'all 0.3s ease',
        ...style
      }}
      hoverable
      actions={actions.length > 0 ? actions.map((action, index) => (
        <Tooltip key={index} title={action.label}>
          <Button
            type={action.type || 'text'}
            icon={action.icon}
            onClick={action.onClick}
            disabled={action.disabled}
            style={{ 
              border: 'none',
              boxShadow: 'none',
              height: 'auto',
              padding: '8px 12px'
            }}
          >
            {action.label}
          </Button>
        </Tooltip>
      )) : undefined}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Space size="middle">
            {getTypeIcon()}
            <div>
              {title && (
                <Title level={4} style={{ margin: 0, color: '#262626' }}>
                  {title}
                </Title>
              )}
              {description && (
                <Text type="secondary" style={{ fontSize: '14px' }}>
                  {description}
                </Text>
              )}
            </div>
          </Space>
          
          <Space size="small">
            <Badge 
              status={status === 'active' ? 'success' : status === 'error' ? 'error' : 'default'} 
              text={status.charAt(0).toUpperCase() + status.slice(1)}
            />
            {getStatusIcon()}
          </Space>
        </div>

        {/* Metrics */}
        {metrics.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Row gutter={[16, 16]}>
              {metrics.map((metric, index) => (
                <Col key={index} span={24 / metrics.length}>
                  <Statistic
                    title={metric.label}
                    value={metric.value}
                    valueStyle={{ 
                      color: metric.color || '#262626',
                      fontSize: '20px',
                      fontWeight: 600
                    }}
                    prefix={
                      metric.trend === 'up' ? (
                        <span style={{ color: '#52c41a' }}>↗</span>
                      ) : metric.trend === 'down' ? (
                        <span style={{ color: '#ff4d4f' }}>↘</span>
                      ) : (
                        <span style={{ color: '#1890ff' }}>→</span>
                      )
                    }
                  />
                </Col>
              ))}
            </Row>
          </>
        )}

        {/* Content */}
        {children && (
          <div style={{ marginTop: '16px' }}>
            {children}
          </div>
        )}
      </Space>
    </Card>
  );
};

// Enhanced Dashboard Card
export const DashboardCard: React.FC<{
  title: string;
  description: string;
  status: 'active' | 'inactive' | 'loading' | 'error' | 'success';
  metrics: {
    value: number | string;
    label: string;
    trend?: 'up' | 'down' | 'stable';
    color?: string;
  }[];
  actions: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    type?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
    disabled?: boolean;
  }[];
  children?: React.ReactNode;
}> = ({ title, description, status, metrics, actions, children }) => (
  <UIEnhancements
    type="dashboard"
    title={title}
    description={description}
    status={status}
    metrics={metrics}
    actions={actions}
  >
    {children}
  </UIEnhancements>
);

// Enhanced Chart Card
export const ChartCard: React.FC<{
  title: string;
  description: string;
  status: 'active' | 'inactive' | 'loading' | 'error' | 'success';
  children: React.ReactNode;
  actions?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    type?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
    disabled?: boolean;
  }[];
}> = ({ title, description, status, children, actions = [] }) => (
  <UIEnhancements
    type="chart"
    title={title}
    description={description}
    status={status}
    actions={actions}
  >
    {children}
  </UIEnhancements>
);

// Enhanced Query Card
export const QueryCard: React.FC<{
  title: string;
  description: string;
  status: 'active' | 'inactive' | 'loading' | 'error' | 'success';
  children: React.ReactNode;
  actions?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    type?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
    disabled?: boolean;
  }[];
}> = ({ title, description, status, children, actions = [] }) => (
  <UIEnhancements
    type="query"
    title={title}
    description={description}
    status={status}
    actions={actions}
  >
    {children}
  </UIEnhancements>
);

// Enhanced Data Card
export const DataCard: React.FC<{
  title: string;
  description: string;
  status: 'active' | 'inactive' | 'loading' | 'error' | 'success';
  metrics: {
    value: number | string;
    label: string;
    trend?: 'up' | 'down' | 'stable';
    color?: string;
  }[];
  children?: React.ReactNode;
  actions?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    type?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
    disabled?: boolean;
  }[];
}> = ({ title, description, status, metrics, children, actions = [] }) => (
  <UIEnhancements
    type="data"
    title={title}
    description={description}
    status={status}
    metrics={metrics}
    actions={actions}
  >
    {children}
  </UIEnhancements>
);

// Enhanced Analytics Card
export const AnalyticsCard: React.FC<{
  title: string;
  description: string;
  status: 'active' | 'inactive' | 'loading' | 'error' | 'success';
  metrics: {
    value: number | string;
    label: string;
    trend?: 'up' | 'down' | 'stable';
    color?: string;
  }[];
  children?: React.ReactNode;
  actions?: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    type?: 'primary' | 'default' | 'dashed' | 'link' | 'text';
    disabled?: boolean;
  }[];
}> = ({ title, description, status, metrics, children, actions = [] }) => (
  <UIEnhancements
    type="analytics"
    title={title}
    description={description}
    status={status}
    metrics={metrics}
    actions={actions}
  >
    {children}
  </UIEnhancements>
);

export default UIEnhancements;
