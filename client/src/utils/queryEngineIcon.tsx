'use client';

import React from 'react';
import {
  BarChartOutlined,
  CloseCircleOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  RocketOutlined,
  ThunderboltOutlined,
  ToolOutlined,
} from '@ant-design/icons';

const BASE: React.CSSProperties = { fontSize: 14, marginRight: 4, verticalAlign: 'middle' };

export function QueryEngineIcon({
  engine,
  style,
}: {
  engine: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  const s = { ...BASE, ...style };
  switch (engine) {
    case 'duckdb':
      return <DatabaseOutlined style={{ ...s, color: '#1890ff' }} />;
    case 'cube':
      return <BarChartOutlined style={{ ...s, color: '#722ed1' }} />;
    case 'spark':
      return <ThunderboltOutlined style={{ ...s, color: '#fa8c16' }} />;
    case 'direct_sql':
      return <DatabaseOutlined style={{ ...s, color: '#52c41a' }} />;
    case 'pandas':
      return <ExperimentOutlined style={{ ...s, color: '#eb2f96' }} />;
    case 'demo':
      return <RocketOutlined style={s} />;
    case 'error':
      return <CloseCircleOutlined style={{ ...s, color: '#ff4d4f' }} />;
    default:
      return <ToolOutlined style={s} />;
  }
}
