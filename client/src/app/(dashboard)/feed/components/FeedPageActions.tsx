'use client';

import React from 'react';
import { Button, Dropdown, Space, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  CompassOutlined,
  DashboardOutlined,
  MessageOutlined,
  MoreOutlined,
  ShareAltOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { isEnterpriseEdition } from '@/utils/appPaths';

interface FeedPageActionsProps {
  onDiscover?: () => void;
}

const FeedPageActions: React.FC<FeedPageActionsProps> = ({ onDiscover }) => {
  const t = useTranslations('feed_page');
  const router = useRouter();
  const ee = isEnterpriseEdition();

  const menuItems: MenuProps['items'] = [
    {
      key: 'share',
      icon: <ShareAltOutlined />,
      label: t('share_insight'),
      onClick: () => router.push('/feed/publish'),
    },
    {
      key: 'saved',
      icon: <StarOutlined />,
      label: t('saved'),
      onClick: () => router.push('/feed/saved'),
    },
    {
      key: 'dashboards',
      icon: <DashboardOutlined />,
      label: t('my_dashboards'),
      onClick: () => router.push('/dashboards'),
    },
    ...(onDiscover
      ? [
          {
            key: 'discover',
            icon: <CompassOutlined />,
            label: t('discover'),
            onClick: onDiscover,
          },
        ]
      : []),
  ];

  return (
    <Space size={8}>
      <Tooltip title={t('share_insight')}>
        <Button
          type="primary"
          icon={<ShareAltOutlined />}
          onClick={() => router.push('/feed/publish')}
        >
          <span className="hidden sm:inline">{t('share_insight')}</span>
        </Button>
      </Tooltip>
      <Tooltip title={ee ? t('explore_with_ai') : t('explore_query_editor_cta')}>
        <Button
          icon={<MessageOutlined />}
          onClick={() =>
            router.push(ee ? '/chat' : '/query-editor')
          }
        />
      </Tooltip>
      <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="bottomRight">
        <Button icon={<MoreOutlined />} aria-label={t('more_menu_aria')} />
      </Dropdown>
    </Space>
  );
};

export default FeedPageActions;
