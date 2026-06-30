'use client';

import React, { useState } from 'react';
import { Dropdown, Button, Modal, message, Spin, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ShareAltOutlined,
  LinkOutlined,
  CodeOutlined,
  ExportOutlined,
  EyeOutlined,
  SendOutlined,
  ClockCircleOutlined,
  UnorderedListOutlined,
  GlobalOutlined,
  LockOutlined,
  PrinterOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { fetchApi } from '@/utils/api';
import { chartService } from '../services/chartService';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { EmbedCodePanel } from '@/components/embed/EmbedCodePanel';
import { useEmbedCode } from '@/hooks/useEmbedCode';

type Props = {
  dashboardId: string | null;
  dashboardName?: string;
  onPreview?: () => void;
  onExport?: (format: string) => void;
  buildShareUrl: () => string;
  activePageId?: string | null;
  runtimeFilters?: RuntimeFilter[];
  /** Edit-mode distribute actions merged into this menu */
  isEditMode?: boolean;
  isEnterprise?: boolean;
  onPublish?: () => void;
  onScheduleDelivery?: () => void;
  onManageSchedules?: () => void;
  isPublic?: boolean;
  onPublicAccessChange?: (isPublic: boolean) => void;
};

export function DashboardShareMenu({
  dashboardId,
  dashboardName,
  onPreview,
  onExport,
  buildShareUrl,
  activePageId,
  runtimeFilters = [],
  isEditMode = false,
  isEnterprise = false,
  onPublish,
  onScheduleDelivery,
  onManageSchedules,
  isPublic = false,
  onPublicAccessChange,
}: Props) {
  const t = useTranslations('dashboards');
  const tt = useTranslations('dashboard_tabs');
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedUrl, setEmbedUrl] = useState('');
  const [embedToken, setEmbedToken] = useState<string | undefined>();
  const { createEmbedCode, loading: embedLoading } = useEmbedCode();

  const copyLink = async () => {
    const url = buildShareUrl();
    await navigator.clipboard.writeText(url);
    message.success(t('share_link_copied'));
  };

  const showEmbed = async () => {
    if (!dashboardId) return;
    setEmbedOpen(true);
    setEmbedUrl('');
    setEmbedToken(undefined);

    const result = await createEmbedCode({
      scope: 'dashboard',
      resourceId: dashboardId,
      name: dashboardName ? `Embed: ${dashboardName}` : 'Dashboard embed',
      pageId: activePageId,
      filters: runtimeFilters,
    });
    setEmbedUrl(result.embedUrl);
    setEmbedToken(result.token);
  };

  const items: MenuProps['items'] = [
    {
      key: 'link',
      icon: <LinkOutlined />,
      label: t('share_copy_link'),
      onClick: () => void copyLink(),
    },
    ...(onPreview
      ? [
          {
            key: 'preview',
            icon: <EyeOutlined />,
            label: t('preview_shared'),
            onClick: onPreview,
          },
        ]
      : []),
    {
      key: 'embed',
      icon: <CodeOutlined />,
      label: t('share_embed_snippet'),
      onClick: () => void showEmbed(),
    },
    ...(isEditMode && dashboardId
      ? [
          {
            key: 'public-access',
            icon: isPublic ? <LockOutlined /> : <GlobalOutlined />,
            label: isPublic ? t('make_private') : t('allow_public_access'),
            onClick: () => {
              void (async () => {
                try {
                  const next = !isPublic;
                  await chartService.publishDashboardAccess(dashboardId, next);
                  onPublicAccessChange?.(next);
                  message.success(next ? t('made_public') : t('made_private'));
                } catch {
                  message.error(t('public_access_failed'));
                }
              })();
            },
          } as const,
        ]
      : []),
    { type: 'divider' as const },
    {
      key: 'png',
      icon: <ExportOutlined />,
      label: t('export_png'),
      onClick: () => onExport?.('png'),
    },
    {
      key: 'pdf',
      icon: <ExportOutlined />,
      label: t('export_pdf'),
      onClick: () => onExport?.('pdf'),
    },
    {
      key: 'print',
      icon: <PrinterOutlined />,
      label: 'Print / Save as PDF',
      onClick: () => {
        document.body.classList.add('dashboard-print-mode');
        window.print();
        const cleanup = () => {
          document.body.classList.remove('dashboard-print-mode');
          window.removeEventListener('afterprint', cleanup);
        };
        window.addEventListener('afterprint', cleanup);
      },
    },
  ];

  if (isEditMode && onPublish) {
    items.push(
      { type: 'divider' as const },
      {
        key: 'publish',
        icon: <SendOutlined />,
        label: tt('publish'),
        onClick: onPublish,
      }
    );
  }

  if (isEditMode && isEnterprise && onScheduleDelivery && onManageSchedules) {
    items.push(
      { type: 'divider' as const },
      {
        key: 'schedule',
        icon: <ClockCircleOutlined />,
        label: tt('schedule_delivery'),
        onClick: onScheduleDelivery,
      },
      {
        key: 'manage-schedules',
        icon: <UnorderedListOutlined />,
        label: tt('manage_schedules'),
        onClick: onManageSchedules,
      }
    );
  }

  return (
    <>
      <Dropdown menu={{ items }} trigger={['click']}>
        <Tooltip title={t('share_tooltip')}>
          <Button icon={<ShareAltOutlined />} disabled={!dashboardId}>
            {t('share')}
          </Button>
        </Tooltip>
      </Dropdown>
      <Modal
        title={t('share_embed_snippet')}
        open={embedOpen}
        onCancel={() => setEmbedOpen(false)}
        width={720}
        footer={null}
        destroyOnHidden
      >
        <EmbedCodePanel
          embedUrl={embedUrl}
          loading={embedLoading}
          token={embedToken}
          title={dashboardName}
          iframeHeight={420}
        />
      </Modal>
    </>
  );
}

export default DashboardShareMenu;
