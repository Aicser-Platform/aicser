'use client';

import React, { useState } from 'react';
import { Input, Dropdown, Modal, message } from 'antd';
import {
  SearchOutlined,
  DashboardOutlined,
  PlusOutlined,
  MoreOutlined,
  EditOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { useDashboardStore } from '../stores/useDashboardStore';
import './DashboardSidebar.css';
import { useTranslations } from 'next-intl';


export const DashboardSidebar: React.FC = () => {
  const t = useTranslations('dashboard_sidebar');
  const {
    dashboards,
    activeDashboardId,
    isSidebarCollapsed,
    setActiveDashboardId,
    addDashboard,
    removeDashboard,
    updateDashboardName,
  } = useDashboardStore();

  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const filteredDashboards = dashboards.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));

  const handleRename = (id: string, name: string) => {
    setEditingId(id);
    setEditValue(name);
  };

  const submitRename = () => {
    if (editingId && editValue.trim()) {
      updateDashboardName(editingId, editValue.trim());
      setEditingId(null);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (dashboards.length <= 1) {
      message.warning(t('cannot_delete_last'));
      return;
    }

    Modal.confirm({
      title: t('delete_dashboard'),
      content: t('delete_dashboard_confirm', { name }),
      okText: t('delete'),
      okType: 'danger',
      cancelText: t('cancel'),
      onOk: () => {
        removeDashboard(id);
      },
    });
  };

  return (
    <aside className={`dashboard-sidebar ${isSidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <div className="sidebar-search" style={{ flex: 1 }}>
            <Input
              prefix={<SearchOutlined />}
              placeholder={t('search')}
              variant="borderless"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="search-input"
            />
          </div>
        </div>
      </div>

      <div className="sidebar-nav">
        <div className="nav-section">
          <div className="nav-items-list">
            {filteredDashboards.map((dash) => (
              <div
                key={dash.id}
                className={`nav-item ${activeDashboardId === dash.id ? 'active' : ''}`}
                onClick={() => setActiveDashboardId(dash.id)}
              >
                <DashboardOutlined className="item-icon" />
                <div className="item-content">
                  {editingId === dash.id ? (
                    <Input
                      size="small"
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={submitRename}
                      onPressEnter={submitRename}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <span className="item-name">{dash.name}</span>
                  )}
                </div>

                <Dropdown
                  menu={{
                    items: [
                      {
                        key: 'rename',
                        icon: <EditOutlined />,
                        label: t('rename'),
                        onClick: () => handleRename(dash.id, dash.name),
                      },
                      {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: t('delete'),
                        danger: true,
                        onClick: () => handleDelete(dash.id, dash.name),
                      },
                    ],
                    onClick: (e) => e.domEvent.stopPropagation(),
                  }}
                  trigger={['click']}
                  placement="bottomRight"
                >
                  <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                    <MoreOutlined />
                  </div>
                </Dropdown>
              </div>
            ))}
          </div>
        </div>

        <div className="nav-section add-dash-item">
          <div className="add-dashboard-placeholder" onClick={() => addDashboard()}>
            <PlusOutlined className="item-icon" />
            <span className="item-name">{t('add_dashboard')}</span>
          </div>
        </div>
      </div>
    </aside>
  );
};
