'use client';

import React, { memo } from 'react';
import { Spin, Skeleton, Card, Space, Typography, Progress, Row, Col, Avatar, Button } from 'antd';
import { 
  LoadingOutlined, 
  DatabaseOutlined, 
  BarChartOutlined, 
  MessageOutlined,
  DashboardOutlined,
  FileTextOutlined,
  UserOutlined,
  SettingOutlined,
  SearchOutlined,
  CloudOutlined,
  ApiOutlined,
  ThunderboltOutlined
} from '@ant-design/icons';

const { Title, Text } = Typography;

// Enhanced loading states with better UX and memory optimization
interface LoadingStatesProps {
  type?: 'default' | 'chart' | 'data' | 'query' | 'dashboard' | 'chat' | 'table' | 'modal' | 'sidebar' | 'header';
  message?: string;
  progress?: number;
  size?: 'small' | 'default' | 'large';
  showSkeleton?: boolean;
  skeletonRows?: number;
  className?: string;
}

// Memoized loading icon component for better performance
const LoadingIcon = memo(({ type, size = 'default' }: { type: string; size?: string }) => {
  const iconProps = { 
    style: { 
      fontSize: size === 'large' ? 32 : size === 'small' ? 16 : 24, 
      color: 'var(--ant-primary-color)' 
    }, 
    spin: true 
  };

  switch (type) {
    case 'chart':
      return <BarChartOutlined {...iconProps} />;
    case 'data':
      return <DatabaseOutlined {...iconProps} />;
    case 'query':
      return <FileTextOutlined {...iconProps} />;
    case 'dashboard':
      return <DashboardOutlined {...iconProps} />;
    case 'chat':
      return <MessageOutlined {...iconProps} />;
    case 'table':
      return <FileTextOutlined {...iconProps} />;
    case 'modal':
      return <SettingOutlined {...iconProps} />;
    case 'sidebar':
      return <ThunderboltOutlined {...iconProps} />;
    case 'header':
      return <SearchOutlined {...iconProps} />;
    default:
      return <LoadingOutlined {...iconProps} />;
  }
});

LoadingIcon.displayName = 'LoadingIcon';

// Memoized skeleton component for better performance
const LoadingSkeleton = memo(({ type, rows = 3 }: { type: string; rows?: number }) => {
  const getSkeletonConfig = () => {
    switch (type) {
      case 'chart':
        return {
          rows: 3,
          title: { width: '60%' },
          paragraph: { rows: 2, width: ['100%', '80%'] }
        };
      case 'data':
        return {
          rows: 4,
          title: { width: '40%' },
          paragraph: { rows: 3, width: ['100%', '90%', '70%'] }
        };
      case 'dashboard':
        return {
          rows: 6,
          title: { width: '50%' },
          paragraph: { rows: 4, width: ['100%', '95%', '85%', '75%'] }
        };
      case 'chat':
        return {
          rows: 2,
          title: { width: '30%' },
          paragraph: { rows: 1, width: ['100%'] }
        };
      case 'table':
        return {
          rows: 5,
          title: { width: '40%' },
          paragraph: { rows: 4, width: ['100%', '90%', '80%', '70%'] }
        };
      default:
        return {
          rows: rows,
          title: { width: '30%' },
          paragraph: { rows: 1, width: ['100%'] }
        };
    }
  };

  return <Skeleton {...getSkeletonConfig()} />;
});

LoadingSkeleton.displayName = 'LoadingSkeleton';

// Chat-specific loading component
const ChatLoadingState = memo(() => (
  <div style={{ 
    padding: '20px', 
    background: 'var(--ant-color-bg-container)',
    borderRadius: '12px',
    border: '1px solid var(--ant-color-border)'
  }}>
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      {/* Chat messages skeleton */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
        <Avatar icon={<UserOutlined />} size="large" />
        <div style={{ flex: 1 }}>
          <Skeleton title={{ width: '40%' }} paragraph={{ rows: 2, width: ['100%', '80%'] }} />
        </div>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', justifyContent: 'flex-end' }}>
        <div style={{ flex: 1, textAlign: 'right' }}>
          <Skeleton title={{ width: '60%' }} paragraph={{ rows: 1, width: ['100%'] }} />
        </div>
        <Avatar icon={<MessageOutlined />} size="large" />
      </div>
      
      {/* AI response loading */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', background: 'var(--ant-color-bg-elevated)', borderRadius: '8px' }}>
        <Spin indicator={<LoadingIcon type="chat" size="small" />} />
        <Text type="secondary">AI is thinking...</Text>
      </div>
    </Space>
  </div>
));

ChatLoadingState.displayName = 'ChatLoadingState';

// Dashboard loading component
const DashboardLoadingState = memo(() => (
  <div style={{ padding: '20px' }}>
    <Space direction="vertical" style={{ width: '100%' }} size="large">
      <div style={{ textAlign: 'center' }}>
        <LoadingIcon type="dashboard" size="large" />
        <Title level={3} style={{ marginTop: '16px', marginBottom: '8px' }}>
          Loading Dashboard...
        </Title>
        <Text type="secondary">Preparing your analytics workspace</Text>
      </div>
      
      <Row gutter={[16, 16]}>
        {[1, 2, 3, 4].map((i) => (
          <Col xs={24} sm={12} lg={6} key={i}>
            <Card>
              <LoadingSkeleton type="chart" />
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  </div>
));

DashboardLoadingState.displayName = 'DashboardLoadingState';

// Table loading component
const TableLoadingState = memo(() => (
  <Card>
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <LoadingIcon type="table" />
        <Text strong>Loading Data Table...</Text>
      </div>
      <LoadingSkeleton type="table" rows={6} />
    </Space>
  </Card>
));

TableLoadingState.displayName = 'TableLoadingState';

// Sidebar loading component
const SidebarLoadingState = memo(() => (
  <div style={{ 
    padding: '16px', 
    background: 'var(--ant-color-bg-sider)',
    height: '100%',
    borderRight: '1px solid var(--ant-color-border)'
  }}>
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <LoadingIcon type="sidebar" size="small" />
        <Text type="secondary">Loading navigation...</Text>
      </div>
      <LoadingSkeleton type="default" rows={8} />
    </Space>
  </div>
));

SidebarLoadingState.displayName = 'SidebarLoadingState';

// Main enhanced loading states component
const EnhancedLoadingStates: React.FC<LoadingStatesProps> = memo(({
  type = 'default',
  message,
  progress,
  size = 'default',
  showSkeleton = true,
  skeletonRows = 3,
  className = ''
}) => {
  const getLoadingMessage = () => {
    if (message) return message;
    
    switch (type) {
      case 'chart':
        return 'Generating chart visualization...';
      case 'data':
        return 'Loading data sources...';
      case 'query':
        return 'Executing query...';
      case 'dashboard':
        return 'Loading dashboard...';
      case 'chat':
        return 'Preparing chat interface...';
      case 'table':
        return 'Loading data table...';
      case 'modal':
        return 'Loading modal content...';
      case 'sidebar':
        return 'Loading navigation...';
      case 'header':
        return 'Loading header...';
      default:
        return 'Loading...';
    }
  };

  // Specialized loading states
  if (type === 'chat') {
    return <ChatLoadingState />;
  }

  if (type === 'dashboard') {
    return <DashboardLoadingState />;
  }

  if (type === 'table') {
    return <TableLoadingState />;
  }

  if (type === 'sidebar') {
    return <SidebarLoadingState />;
  }

  // Default loading state with enhanced styling
  return (
    <div 
      className={`enhanced-loading-state ${className}`}
      style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        minHeight: '200px',
        flexDirection: 'column',
        padding: '20px',
        background: 'var(--ant-color-bg-container)',
        borderRadius: '12px',
        border: '1px solid var(--ant-color-border)'
      }}
    >
      <Space direction="vertical" size="large" style={{ textAlign: 'center' }}>
        <LoadingIcon type={type} size={size} />
        
        <div>
          <Title level={4} style={{ margin: 0, color: 'var(--ant-color-text)' }}>
            {getLoadingMessage()}
          </Title>
          {progress !== undefined && (
            <Progress 
              percent={progress} 
              style={{ width: '200px', marginTop: '8px' }}
              strokeColor="var(--ant-primary-color)"
            />
          )}
        </div>

        {showSkeleton && (
          <div style={{ width: '100%', maxWidth: '400px' }}>
            <LoadingSkeleton type={type} rows={skeletonRows} />
          </div>
        )}
      </Space>
    </div>
  );
});

EnhancedLoadingStates.displayName = 'EnhancedLoadingStates';

// Specific loading components for common use cases
export const ChartLoading: React.FC<{ message?: string; progress?: number }> = memo(({ message, progress }) => (
  <EnhancedLoadingStates type="chart" message={message} progress={progress} />
));

export const DataLoading: React.FC<{ message?: string; progress?: number }> = memo(({ message, progress }) => (
  <EnhancedLoadingStates type="data" message={message} progress={progress} />
));

export const QueryLoading: React.FC<{ message?: string; progress?: number }> = memo(({ message, progress }) => (
  <EnhancedLoadingStates type="query" message={message} progress={progress} />
));

export const DashboardLoading: React.FC<{ message?: string; progress?: number }> = memo(({ message, progress }) => (
  <EnhancedLoadingStates type="dashboard" message={message} progress={progress} />
));

export const ChatLoading: React.FC<{ message?: string; progress?: number }> = memo(({ message, progress }) => (
  <EnhancedLoadingStates type="chat" message={message} progress={progress} />
));

export const TableLoading: React.FC<{ message?: string; progress?: number }> = memo(({ message, progress }) => (
  <EnhancedLoadingStates type="table" message={message} progress={progress} />
));

export const SidebarLoading: React.FC<{ message?: string; progress?: number }> = memo(({ message, progress }) => (
  <EnhancedLoadingStates type="sidebar" message={message} progress={progress} />
));

ChartLoading.displayName = 'ChartLoading';
DataLoading.displayName = 'DataLoading';
QueryLoading.displayName = 'QueryLoading';
DashboardLoading.displayName = 'DashboardLoading';
ChatLoading.displayName = 'ChatLoading';
TableLoading.displayName = 'TableLoading';
SidebarLoading.displayName = 'SidebarLoading';

export default EnhancedLoadingStates;
