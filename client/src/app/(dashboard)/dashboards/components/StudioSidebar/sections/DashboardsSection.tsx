'use client';

import React, { useState } from 'react';
import { Input, Spin, Empty } from 'antd';
import { SearchOutlined, DashboardOutlined } from '@ant-design/icons';
import { useDashboardStore } from '../../../stores/useDashboardStore';

export function DashboardsSection() {
  const dashboards = useDashboardStore((s) => s.dashboards);
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId);
  const isLoadingDashboards = useDashboardStore((s) => s.isLoadingDashboards);
  const setActiveDashboardId = useDashboardStore((s) => s.setActiveDashboardId);
  const loadDashboardById = useDashboardStore((s) => s.loadDashboardById);
  const [search, setSearch] = useState('');

  const filtered = dashboards.filter((d) =>
    d.name.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = async (id: string) => {
    setActiveDashboardId(id);
    await loadDashboardById(id);
  };

  if (isLoadingDashboards) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Spin size="small" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={{ padding: '8px 12px' }}>
        <Input
          size="small"
          placeholder="Search dashboards..."
          prefix={<SearchOutlined style={{ color: 'var(--ant-color-text-quaternary)' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </div>
      {filtered.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No dashboards"
          style={{ padding: '24px 16px' }}
        />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
          {filtered.map((d) => (
            <li
              key={d.id}
              onClick={() => void handleSelect(d.id)}
              style={{
                padding: '7px 16px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                borderRadius: 0,
                background:
                  d.id === activeDashboardId
                    ? 'var(--ant-color-primary-bg)'
                    : 'transparent',
                color:
                  d.id === activeDashboardId
                    ? 'var(--ant-color-primary)'
                    : 'var(--ant-color-text)',
                fontWeight: d.id === activeDashboardId ? 600 : 400,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => {
                if (d.id !== activeDashboardId) {
                  (e.currentTarget as HTMLLIElement).style.background =
                    'var(--ant-color-fill-secondary)';
                }
              }}
              onMouseLeave={(e) => {
                if (d.id !== activeDashboardId) {
                  (e.currentTarget as HTMLLIElement).style.background = 'transparent';
                }
              }}
            >
              <DashboardOutlined style={{ fontSize: 12, flexShrink: 0 }} />
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {d.name}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
