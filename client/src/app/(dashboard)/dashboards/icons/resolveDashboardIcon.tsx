'use client';

import React from 'react';
import {
  DollarOutlined,
  EuroOutlined,
  PoundOutlined,
  PercentageOutlined,
  FundOutlined,
  WalletOutlined,
  BankOutlined,
  CreditCardOutlined,
  AccountBookOutlined,
  TransactionOutlined,
  UserOutlined,
  TeamOutlined,
  UserAddOutlined,
  SolutionOutlined,
  ContactsOutlined,
  IdcardOutlined,
  CustomerServiceOutlined,
  ShoppingOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  CarOutlined,
  RocketOutlined,
  CloudOutlined,
  DatabaseOutlined,
  ApiOutlined,
  ClusterOutlined,
  ToolOutlined,
  BuildOutlined,
  InboxOutlined,
  MailOutlined,
  PhoneOutlined,
  GlobalOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  FieldTimeOutlined,
  HistoryOutlined,
  ScheduleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
  FireOutlined,
  HeartOutlined,
  StarOutlined,
  FlagOutlined,
  SafetyOutlined,
  LockOutlined,
  BugOutlined,
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  AreaChartOutlined,
  DotChartOutlined,
  FundProjectionScreenOutlined,
  RiseOutlined,
  FallOutlined,
  StockOutlined,
  HeatMapOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  FileOutlined,
  FileTextOutlined,
  LinkOutlined,
  PaperClipOutlined,
  NumberOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  ApartmentOutlined,
  HomeOutlined,
  SettingOutlined,
  FilterOutlined,
  SearchOutlined,
  BulbOutlined,
  TrophyOutlined,
  GiftOutlined,
  TagOutlined,
  TagsOutlined,
  AimOutlined,
  CompassOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import type { WidgetIconRef } from './dashboardIconTypes';
import { normalizeWidgetIcon } from './dashboardIconTypes';
import { inferAntIconIdFromText } from './dashboardIconCatalog';
import type { BrandIconPackItem } from './brandIconPack';
import { useBrandIconPack } from './useBrandIconPack';

const ANT_ICON_MAP: Record<string, React.ComponentType<{ style?: React.CSSProperties; className?: string }>> = {
  DollarOutlined,
  EuroOutlined,
  PoundOutlined,
  PercentageOutlined,
  FundOutlined,
  WalletOutlined,
  BankOutlined,
  CreditCardOutlined,
  AccountBookOutlined,
  TransactionOutlined,
  UserOutlined,
  TeamOutlined,
  UserAddOutlined,
  SolutionOutlined,
  ContactsOutlined,
  IdcardOutlined,
  CustomerServiceOutlined,
  ShoppingOutlined,
  ShoppingCartOutlined,
  ShopOutlined,
  CarOutlined,
  RocketOutlined,
  CloudOutlined,
  DatabaseOutlined,
  ApiOutlined,
  ClusterOutlined,
  ToolOutlined,
  BuildOutlined,
  InboxOutlined,
  MailOutlined,
  PhoneOutlined,
  GlobalOutlined,
  EnvironmentOutlined,
  ClockCircleOutlined,
  CalendarOutlined,
  FieldTimeOutlined,
  HistoryOutlined,
  ScheduleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
  FireOutlined,
  HeartOutlined,
  StarOutlined,
  FlagOutlined,
  SafetyOutlined,
  LockOutlined,
  BugOutlined,
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  AreaChartOutlined,
  DotChartOutlined,
  FundProjectionScreenOutlined,
  RiseOutlined,
  FallOutlined,
  StockOutlined,
  HeatMapOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  FileOutlined,
  FileTextOutlined,
  LinkOutlined,
  PaperClipOutlined,
  NumberOutlined,
  DashboardOutlined,
  AppstoreOutlined,
  ApartmentOutlined,
  HomeOutlined,
  SettingOutlined,
  FilterOutlined,
  SearchOutlined,
  BulbOutlined,
  TrophyOutlined,
  GiftOutlined,
  TagOutlined,
  TagsOutlined,
  AimOutlined,
  CompassOutlined,
  ExperimentOutlined,
};

export type ResolveDashboardIconOptions = {
  icon?: unknown;
  /** Legacy chartOptions.iconName */
  legacyIconName?: unknown;
  /** Fallback text for heuristic (title + format) */
  fallbackText?: string;
  color?: string;
  className?: string;
  style?: React.CSSProperties;
  size?: number;
  /** Brand pack items (Phase 3) */
  brandItems?: BrandIconPackItem[];
};

export function resolveDashboardIconNode(opts: ResolveDashboardIconOptions): React.ReactNode {
  const ref =
    normalizeWidgetIcon(opts.icon, opts.legacyIconName) ||
    (opts.fallbackText
      ? ({ set: 'antd', name: inferAntIconIdFromText(opts.fallbackText) } as WidgetIconRef)
      : null);

  if (!ref) {
    return <NumberOutlined className={opts.className} style={opts.style} />;
  }

  const size = opts.size;
  const color = opts.color || ref.color;
  const style: React.CSSProperties = {
    ...opts.style,
    ...(color ? { color } : null),
    ...(size ? { fontSize: size } : null),
  };

  if (ref.set === 'emoji') {
    return (
      <span className={opts.className} style={{ lineHeight: 1, ...style }} aria-hidden>
        {ref.name}
      </span>
    );
  }

  if (ref.set === 'custom') {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={ref.name}
        alt=""
        className={opts.className}
        style={{
          width: size || 18,
          height: size || 18,
          objectFit: 'contain',
          display: 'block',
          ...opts.style,
        }}
      />
    );
  }

  if (ref.set === 'brand') {
    const item = opts.brandItems?.find((b) => b.key === ref.name);
    if (!item) return <ApartmentOutlined className={opts.className} style={style} />;
    if (item.kind === 'emoji') {
      return (
        <span className={opts.className} style={{ lineHeight: 1, ...style }} aria-hidden>
          {item.value}
        </span>
      );
    }
    if (item.kind === 'image') {
      // eslint-disable-next-line @next/next/no-img-element
      return (
        <img
          src={item.value}
          alt=""
          className={opts.className}
          style={{
            width: size || 18,
            height: size || 18,
            objectFit: 'contain',
            display: 'block',
            ...opts.style,
          }}
        />
      );
    }
    const BrandIcon = ANT_ICON_MAP[item.value] || ApartmentOutlined;
    return <BrandIcon className={opts.className} style={{ ...style, color: item.color || color }} />;
  }

  const Icon = ANT_ICON_MAP[ref.name] || NumberOutlined;
  return <Icon className={opts.className} style={style} />;
}

/** Client wrapper — loads org brand pack when brandItems are not passed. */
export function DashboardIcon(props: ResolveDashboardIconOptions) {
  const orgBrandItems = useBrandIconPack();
  const brandItems = props.brandItems ?? orgBrandItems;
  return <>{resolveDashboardIconNode({ ...props, brandItems })}</>;
}
