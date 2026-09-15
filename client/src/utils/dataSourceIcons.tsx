'use client';

import React, { useState, useContext } from 'react';
import {
  DatabaseOutlined,
  FileTextOutlined,
  CloudOutlined,
  ApiOutlined,
  BookOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { getIntegrationByAppType, getIntegrationLogo } from '@/config/integrations';
import { ThemeModeContext } from '@/components/Providers/ThemeModeContext';

/** Brand colors for fallback badge when logo fails to load. */
export const DATA_SOURCE_BRAND_COLORS: Record<string, string> = {
  postgresql: '#336791',
  mysql: '#4479A1',
  sqlserver: '#CC2927',
  mssql: '#CC2927',
  clickhouse: '#FFCC02',
  snowflake: '#29B5E8',
  bigquery: '#4285F4',
  redshift: '#8C4FFF',
  duckdb: '#29B5E8',
  delta_lake: '#F36201',
  iceberg: '#0F6FFF',
  s3_parquet: '#FF9900',
  azure_blob: '#0078D4',
  gcp_cloud_storage: '#4285F4',
  file: '#52c41a',
  google_sheets: '#0F9D58',
  api: '#fa8c16',
  mongodb: '#47A248',
  cassandra: '#1287B1',
  dynamodb: '#4053D6',
  databricks: '#FF3621',
  kafka: '#231F20',
  elasticsearch: '#005571',
  opensearch: '#005EB8',
  influxdb: '#22ADF6',
  graphql_api: '#E10098',
  rest_api: '#61AFFE',
};

export function getDatabaseLogoUrl(dbType: string): string {
  const logo = getIntegrationLogo(dbType);
  if (logo) return logo;
  return 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/database/database-original.svg';
}

export interface DataSourceIconProps {
  type: string;
  dbType?: string;
  size?: number;
  style?: React.CSSProperties;
}

/**
 * Renders a type-specific icon for a data source using integration logos.
 * For database/warehouse with dbType, uses the matching logo (adapts to dark/light mode).
 * Otherwise uses a generic icon by type (file, api, knowledge_base, etc.).
 */
export function DataSourceIcon({ type, dbType, size = 16, style }: DataSourceIconProps): React.ReactElement {
  const baseStyle: React.CSSProperties = { fontSize: size };

  // Prefer the real per-vendor logo whenever a specific dbType is known,
  // regardless of the broad category -- enterprise_connector sources (Kafka,
  // Elasticsearch, etc, from ee/modules/data/services/enterprise_connectors_service.py)
  // carry a real dbType but a category that isn't 'database'/'warehouse', so
  // gating on category alone left them falling through to the generic
  // InfoCircleOutlined default below.
  if (dbType && getIntegrationLogo(dbType)) {
    // DataSourceLogoImage already carries its own full-size centering
    // wrapper (see below) -- return it directly rather than double-wrapping.
    return <DataSourceLogoImage appType={dbType} size={size} style={style} />;
  }

  let inner: React.ReactElement;
  if (type === 'file' && getIntegrationLogo('file')) {
    return <DataSourceLogoImage appType="file" size={size} style={style} />;
  } else if (type === 'file') {
    inner = <FileTextOutlined style={{ ...baseStyle, color: '#52c41a' }} />;
  } else if (type === 'api' && getIntegrationLogo('api')) {
    return <DataSourceLogoImage appType="api" size={size} style={style} />;
  } else if (type === 'api') {
    inner = <ApiOutlined style={{ ...baseStyle, color: '#fa8c16' }} />;
  } else if (type === 'sample_duckdb' && getIntegrationLogo('duckdb')) {
    return <DataSourceLogoImage appType="duckdb" size={size} style={style} />;
  } else if (type === 'sample_duckdb') {
    inner = <DatabaseOutlined style={{ ...baseStyle, color: '#29B5E8' }} />;
  } else if (type === 'google_sheets' && getIntegrationLogo('google_sheets')) {
    return <DataSourceLogoImage appType="google_sheets" size={size} style={style} />;
  } else if (type === 'google_sheets') {
    inner = <FileTextOutlined style={{ ...baseStyle, color: '#0F9D58' }} />;
  } else {
    switch (type) {
      case 'database':
        inner = <DatabaseOutlined style={{ ...baseStyle, color: '#1677ff' }} />;
        break;
      case 'warehouse':
        inner = <CloudOutlined style={{ ...baseStyle, color: '#722ed1' }} />;
        break;
      case 'cube':
        inner = <CloudOutlined style={{ ...baseStyle, color: '#13c2c2' }} />;
        break;
      case 'knowledge_base':
        inner = <BookOutlined style={{ ...baseStyle, color: '#eb2f96' }} />;
        break;
      default:
        inner = <InfoCircleOutlined style={baseStyle} />;
    }
  }

  // RELIABILITY: every branch above used to return its <XOutlined> glyph
  // directly, with no size/centering wrapper -- unlike DataSourceLogoImage's
  // own span (display:inline-flex, alignItems/justifyContent:center, fixed
  // width/height:size), so a plain antd icon's own default inline SVG
  // vertical-align (not baseline-neutral) made it sit visibly off-center
  // next to text in any flex row that centers this component as a whole
  // item, e.g. the Sources panel's data-source picker. Wrapping every
  // fallback-icon branch in the identical span DataSourceLogoImage already
  // uses makes every DataSourceIcon result -- real logo or generic glyph --
  // occupy the exact same size x size centered box, regardless of branch.
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
      }}
    >
      {inner}
    </span>
  );
}

function useIsDarkMode(): boolean {
  const ctx = useContext(ThemeModeContext);
  const [domDark, setDomDark] = useState(() => {
    if (typeof document === 'undefined') return false;
    return document.documentElement.getAttribute('data-theme') === 'dark';
  });
  React.useEffect(() => {
    if (ctx) return;
    if (typeof document === 'undefined') return;
    const el = document.documentElement;
    const check = () => setDomDark(el.getAttribute('data-theme') === 'dark');
    const obs = new MutationObserver(check);
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    return () => obs.disconnect();
  }, [ctx]);
  return ctx ? ctx.isDarkMode : domDark;
}

function DataSourceLogoImage({
  appType,
  size = 16,
  style,
}: {
  appType: string;
  size?: number;
  style?: React.CSSProperties;
}): React.ReactElement {
  const [imgError, setImgError] = useState(false);
  const isDarkMode = useIsDarkMode();
  const logoUrl = getIntegrationLogo(appType) || getDatabaseLogoUrl(appType);
  const integration = getIntegrationByAppType(appType);
  const brandColor = DATA_SOURCE_BRAND_COLORS[appType.toLowerCase()] ?? '#666';

  return (
    <span
      className="data-source-logo-wrapper"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 4,
        overflow: 'hidden',
        // Dark mode: subtle light background so logos remain visible on dark panels
        backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.04)',
        padding: size <= 20 ? 2 : 3,
        ...style,
      }}
    >
      {!imgError && logoUrl ? (
        <img
          src={logoUrl}
          alt={integration?.name ?? appType}
          width={size}
          height={size}
          style={{
            objectFit: 'contain',
            display: 'block',
            width: size,
            height: size,
            // Slight brightness in dark mode so colored logos don’t look too dim
            filter: isDarkMode ? 'brightness(1.08) contrast(1.05)' : 'none',
          }}
          onError={() => setImgError(true)}
        />
      ) : (
        <span
          style={{
            width: size,
            height: size,
            borderRadius: 4,
            backgroundColor: brandColor,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.max(10, size * 0.5),
            fontWeight: 'bold',
            textTransform: 'uppercase',
          }}
        >
          {(integration?.name ?? appType).charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  );
}
