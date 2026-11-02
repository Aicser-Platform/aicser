'use client';

import React, { useState } from 'react';
import { Dropdown, Button, message, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  ShareAltOutlined,
  LinkOutlined,
  CodeOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  EyeOutlined,
  SendOutlined,
  ClockCircleOutlined,
  UnorderedListOutlined,
  GlobalOutlined,
  LockOutlined,
  PrinterOutlined,
  DownloadOutlined,
} from '@ant-design/icons';
import { useTranslations } from 'next-intl';
import { chartService } from '../services/chartService';
import type { RuntimeFilter } from '../stores/useDashboardStore';
import { EmbedDialog } from '@/components/embed/EmbedDialog';
import { ShareDialog } from '@/components/share/ShareDialog';
import { menuItemWithDescription } from '@/components/Feed/MenuItemWithDescription';

type Props = {
  dashboardId: string | null;
  dashboardName?: string;
  onPreview?: () => void;
  onExport?: (format: string) => void;
  /** Industry-style print: dashboard only + title/branding */
  onPrint?: () => void;
  buildShareUrl: () => string;
  activePageId?: string | null;
  runtimeFilters?: RuntimeFilter[];
  /** Edit-mode distribute actions merged into this menu */
  isEditMode?: boolean;
  isEnterprise?: boolean;
  /** Operate add-on: scheduled dashboard email. Hidden when the plan lacks it. */
  canSchedule?: boolean;
  onPublish?: () => void;
  onScheduleDelivery?: () => void;
  onManageSchedules?: () => void;
  isPublic?: boolean;
  onPublicAccessChange?: (isPublic: boolean) => void;
  exportBusy?: boolean;
};

export function DashboardShareMenu({
  dashboardId,
  dashboardName,
  onPreview,
  onExport,
  onPrint,
  buildShareUrl,
  activePageId,
  runtimeFilters = [],
  isEditMode = false,
  isEnterprise = false,
  canSchedule = false,
  onPublish,
  onScheduleDelivery,
  onManageSchedules,
  isPublic = false,
  onPublicAccessChange,
  exportBusy = false,
}: Props) {
  const t = useTranslations('dashboards');
  const tt = useTranslations('dashboard_tabs');
  const [embedOpen, setEmbedOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const tShare = useTranslations('share_links');

  const showEmbed = () => {
    if (dashboardId) setEmbedOpen(true);
  };

  const runPrint = () => {
    if (onPrint) {
      onPrint();
      return;
    }
    document.body.classList.add('dashboard-print-mode');
    window.print();
    const cleanup = () => {
      document.body.classList.remove('dashboard-print-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
  };

  const items: MenuProps['items'] = [
    {
      key: 'share',
      icon: <LinkOutlined />,
      label: tShare('open'),
      disabled: !dashboardId,
      onClick: () => setShareOpen(true),
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
      onClick: showEmbed,
    },
    // Dashboards made public before share links: this closes them. New sharing is in the dialog.
    ...(isEditMode && dashboardId && isPublic
      ? [
          {
            key: 'public-access',
            icon: isPublic ? <LockOutlined /> : <GlobalOutlined />,
            label: isPublic ? t('make_private') : t('allow_public_access'),
            onClick: () => {
              void (async () => {
                try {
                  const next = !isPublic;
                  const res = await chartService.publishDashboardAccess(dashboardId, next);
                  if (next && res?.is_public === false) {
                    message.info(t('public_sent_for_approval'));
                    return;
                  }
                  onPublicAccessChange?.(next);
                  message.success(next ? t('made_public') : t('made_private'));
                } catch (err) {
                  message.error(err instanceof Error && err.message ? err.message : t('public_access_failed'));
                }
              })();
            },
          } as const,
        ]
      : []),
    { type: 'divider' as const },
    {
      key: 'export',
      icon: <DownloadOutlined />,
      label: t('export_menu'),
      disabled: exportBusy,
      children: [
        {
          key: 'png',
          icon: <FileImageOutlined />,
          label: menuItemWithDescription(t('export_png'), t('export_png_desc')),
          disabled: exportBusy,
          onClick: () => onExport?.('png'),
        },
        {
          key: 'pdf',
          icon: <FilePdfOutlined />,
          label: menuItemWithDescription(t('export_pdf'), t('export_pdf_desc')),
          disabled: exportBusy,
          onClick: () => onExport?.('pdf'),
        },
        {
          key: 'pdf_report',
          icon: <FilePdfOutlined />,
          label: menuItemWithDescription(t('export_pdf_report'), t('export_pdf_report_desc')),
          disabled: exportBusy,
          onClick: () => onExport?.('pdf_report'),
        },
        {
          key: 'print',
          icon: <PrinterOutlined />,
          label: menuItemWithDescription(t('export_print'), t('export_print_desc')),
          disabled: exportBusy,
          onClick: runPrint,
        },
      ],
    },
  ];

  if (onPublish) {
    items.push(
      { type: 'divider' as const },
      {
        key: 'publish',
        icon: <SendOutlined />,
        label: menuItemWithDescription(tt('publish'), tt('publish_desc')),
        onClick: onPublish,
      }
    );
  }

  if (isEditMode && isEnterprise && canSchedule && onScheduleDelivery && onManageSchedules) {
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
          <Button icon={<ShareAltOutlined />} disabled={!dashboardId} loading={exportBusy}>
            {t('share')}
          </Button>
        </Tooltip>
      </Dropdown>
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        kind="dashboard"
        resourceId={dashboardId}
        title={dashboardName || ''}
        onAdvancedEmbed={() => {
          setShareOpen(false);
          showEmbed();
        }}
      />
      <EmbedDialog
        open={embedOpen}
        onClose={() => setEmbedOpen(false)}
        scope="dashboard"
        resourceId={dashboardId}
        name={dashboardName}
        pageId={activePageId}
        filters={runtimeFilters}
        iframeHeight={420}
      />
    </>
  );
}

export default DashboardShareMenu;
