'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  Steps,
  Form,
  Input,
  Select,
  Button,
  Card,
  Space,
  Tag,
  Alert,
  Upload,
  Radio,
  Row,
  Col,
  Grid,
  Collapse,
  Typography,
  Divider,
  message,
  Table,
} from 'antd';
import { useTranslations } from 'next-intl';
import {
  DatabaseOutlined,
  CloudOutlined,
  InboxOutlined,
  ApiOutlined,
  CheckCircleOutlined,
  UploadOutlined,
  SettingOutlined,
  LockOutlined,
  GlobalOutlined,
  FileOutlined,
  SaveOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  InfoCircleOutlined,
  EditOutlined,
  ExperimentOutlined,
} from '@ant-design/icons';
import { fetchApi, handlePlanLimitError, ApiError } from '@/utils/api';
import { useAuthenticatedFetch } from '@/hooks/useAuthenticatedFetch';
import { useProjectStore } from '@/stores/useProjectStore';

const { Step } = Steps;
const { Option } = Select;
const { Panel } = Collapse;
const { Title, Text } = Typography;
const { Dragger } = Upload;
const { useBreakpoint } = Grid;

/** Parse Google Sheet URL; extract spreadsheet ID and optional gid from ?gid= #gid= or &gid= */
function parseGoogleSheetUrl(url: string): { sheetId: string | null; gid: string | null } {
  const s = (url || '').trim();
  if (!s) return { sheetId: null, gid: null };
  const idMatch = s.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const gidMatch = s.match(/[?#&]gid=(\d+)/i);
  return {
    sheetId: idMatch ? idMatch[1] : null,
    gid: gidMatch ? gidMatch[1] : null,
  };
}

interface UniversalDataSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataSourceCreated: (dataSource: any) => void;
  initialDataSourceType?: 'file' | 'database' | 'warehouse' | 'api' | 'knowledge_base' | 'sample_duckdb' | '';
  isChatIntegration?: boolean;
  /** When set, modal opens in edit mode: form pre-filled and save calls PUT to update */
  existingDataSource?: {
    id: string;
    name: string;
    type: string;
    connection_config?: Record<string, any>;
    description?: string;
  } | null;
}

interface DataSourceConfig {
  name: string;
  type: 'file' | 'database' | 'warehouse' | 'api' | 'knowledge_base' | 'sample_duckdb' | '';
  description?: string;
}

interface ConnectionConfig {
  // Basic connection
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;

  // Advanced options
  sslMode: string;
  connectionPool: boolean;
  minConnections: number;
  maxConnections: number;
  connectionTimeout: number;

  // SQL Server
  trustServerCertificate?: boolean;
  driver?: string;
  // NoSQL
  authSource?: string; // MongoDB auth database
  datacenter?: string; // Cassandra datacenter/local_dc
  // Enterprise features
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshPassword?: string;
  sshKeyPath?: string;
  sslCert?: string;
  sslKey?: string;
  sslCA?: string;

  // Cloud storage and data lake fields
  storageUri?: string;
  accessKey?: string;
  secretKey?: string;
  region?: string;
  endpoint?: string;
  accountName?: string;
  accountKey?: string;
  sasToken?: string;
  gcpProjectId?: string;
  gcpCredentials?: string;
  fileFormat?: string; // For S3/Azure Blob files (e.g., 'parquet', 'csv', 'json')
  snapshotId?: number; // For Iceberg time travel
  version?: number; // For Delta Lake time travel
  timestamp?: string; // For Delta Lake time travel
  // API source: path, method, headers, optional max rows, and auth
  apiPath?: string;
  apiMethod?: string;
  apiHeaders?: string;
  max_rows?: number;
  /** API auth: 'none' | 'basic' | 'bearer' | 'api_key'. When basic, use apiBasicUsername + password. */
  authType?: string;
  /** Basic Auth username (only when authType === 'basic'). */
  apiBasicUsername?: string;
  /** Prometheus base URL (no trailing path), e.g. http://prometheus:9090 */
  prometheusUrl?: string;
}

const UniversalDataSourceModal: React.FC<UniversalDataSourceModalProps> = ({
  isOpen,
  onClose,
  onDataSourceCreated,
  initialDataSourceType = 'file',
  isChatIntegration = false,
  existingDataSource = null,
}) => {
  const t = useTranslations('data_source_modal');
  const screens = useBreakpoint();
  const isCompactViewport = !screens.md;
  const authenticatedFetch = useAuthenticatedFetch();
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [connectionUrlEditable, setConnectionUrlEditable] = useState(true); // Editable by default
  const [customConnectionUrl, setCustomConnectionUrl] = useState('');
  const { currentProject } = useProjectStore();
  // Store normalizes to camelCase; Project type uses snake_case — support both
  const currentOrgId = currentProject
    ? (currentProject as { organization_id?: string; organizationId?: string }).organization_id ??
      (currentProject as { organization_id?: string; organizationId?: string }).organizationId
    : undefined;

  // Data source configuration
  const [dataSourceConfig, setDataSourceConfig] = useState<DataSourceConfig>({
    name: '', // Will auto-generate if empty
    type: initialDataSourceType || '',
    description: '',
  });

  // Auto-generate name from connection details
  const generateDataSourceName = () => {
    const dbType = selectedDatabaseType || 'Database';
    if (dbType === 'prometheus_source') {
      const pu = connectionConfig.prometheusUrl?.trim();
      if (pu) return `Prometheus - ${pu}`;
      return 'Prometheus Connection';
    }
    const host = connectionConfig.host || '';
    const database = connectionConfig.database || '';

    if (host && database) {
      return `${dbType.charAt(0).toUpperCase() + dbType.slice(1)} - ${host}/${database}`;
    } else if (host) {
      return `${dbType.charAt(0).toUpperCase() + dbType.slice(1)} - ${host}`;
    } else {
      return `${dbType.charAt(0).toUpperCase() + dbType.slice(1)} Connection`;
    }
  };

  // Connection configuration
  const [connectionConfig, setConnectionConfig] = useState<ConnectionConfig>({
    host: '',
    port: 5432,
    database: '',
    username: '',
    password: '',
    sslMode: 'prefer',
    connectionPool: false,
    minConnections: 1,
    maxConnections: 10,
    connectionTimeout: 30,
    trustServerCertificate: true,
    // Cloud storage fields
    storageUri: '',
    accessKey: '',
    secretKey: '',
    region: 'us-east-1',
    endpoint: '',
    accountName: '',
    accountKey: '',
    sasToken: '',
    gcpProjectId: '',
    gcpCredentials: '',
    fileFormat: '',
    version: undefined,
    timestamp: '',
    snapshotId: undefined,
    prometheusUrl: '',
  });

  // File upload
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<any>(null); // Preview data from file
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [delimiter, setDelimiter] = useState<string>(',');
  const [headerRow, setHeaderRow] = useState<number | null>(null);
  const [showHeaderAssist, setShowHeaderAssist] = useState(false);
  const [availableSheets, setAvailableSheets] = useState<string[]>([]);

  // Sample data (DuckDB) — domain only; no connection secrets
  const [selectedSampleDomain, setSelectedSampleDomain] = useState<string>('banking');
  // File source sub-type: upload (CSV/Excel/etc.) or Google Sheet by URL
  const [fileSourceKind, setFileSourceKind] = useState<'upload' | 'google_sheet'>('upload');
  // Google Sheets (when fileSourceKind === 'google_sheet'): URL and optional GID
  const [googleSheetUrl, setGoogleSheetUrl] = useState<string>('');
  const [googleSheetGid, setGoogleSheetGid] = useState<string>('');
  const SAMPLE_DOMAINS = [
    { value: 'banking', label: t('sample_domain_banking') },
    { value: 'education', label: t('sample_domain_education') },
    { value: 'insurance', label: t('sample_domain_insurance') },
    { value: 'ecommerce', label: t('sample_domain_ecommerce') },
    { value: 'retail_supply_chain', label: t('sample_domain_retail_supply_chain') },
    { value: 'telecom', label: t('sample_domain_telecom') },
    { value: 'healthcare', label: t('sample_domain_healthcare') },
    { value: 'saas', label: t('sample_domain_saas') },
    { value: 'ngo_impact', label: t('sample_domain_ngo_impact') },
    { value: 'govt_public_services', label: t('sample_domain_govt_public_services') },
    { value: 'energy', label: t('sample_domain_energy') },
  ];
  const SAMPLE_DOMAINS_WITH_DATA = ['banking', 'education', 'insurance', 'ecommerce', 'retail_supply_chain', 'telecom', 'healthcare', 'saas', 'ngo_impact', 'govt_public_services', 'energy'];

  // Supported data sources
  const dataSourceTypes = [
    {
      key: 'file',
      label: t('type_file_label'),
      icon: <InboxOutlined />,
      description: t('type_file_desc'),
      color: 'blue',
    },
    {
      key: 'database',
      label: t('type_database_label'),
      icon: <DatabaseOutlined />,
      description: t('type_database_desc'),
      color: 'green',
    },
    {
      key: 'warehouse',
      label: t('type_warehouse_label'),
      icon: <CloudOutlined />,
      description: t('type_warehouse_desc'),
      color: 'purple',
    },
    {
      key: 'api',
      label: t('type_api_label'),
      icon: <ApiOutlined />,
      description: t('type_api_desc'),
      color: 'orange',
    },
    {
      key: 'knowledge_base',
      label: t('type_knowledge_base_label'),
      icon: <FileOutlined />,
      description: t('type_knowledge_base_desc'),
      color: 'cyan',
    },
    {
      key: 'sample_duckdb',
      label: t('type_sample_duckdb_label'),
      icon: <ExperimentOutlined />,
      description: t('type_sample_duckdb_desc'),
      color: 'geekblue',
    },
  ];

  // Detect dark mode for theme-aware logos
  const [isDarkMode, setIsDarkMode] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      const html = document.documentElement;
      const isDark =
        html.classList.contains('dark') ||
        html.getAttribute('data-theme') === 'dark' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
      setIsDarkMode(isDark);
    };

    checkDarkMode();
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', checkDarkMode);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener('change', checkDarkMode);
    };
  }, []);

  // Brand colors for each database (used for colored styling and fallback)
  const brandColors: Record<string, string> = {
    postgresql: '#336791',
    mysql: '#4479A1',
    sqlserver: '#CC2927',
    duckdb: '#29B5E8',
    clickhouse: '#FFCC02',
    snowflake: '#29B5E8',
    bigquery: '#4285F4',
    redshift: '#8C4FFF',
    delta_lake: '#00ADD8',
    iceberg: '#1E88E5',
    s3_parquet: '#FF9900',
    azure_blob: '#0078D4',
    gcp_cloud_storage: '#4285F4',
    prometheus_source: '#E6522C',
  };

  // Helper function to get database logo URL from CDN
  const getDatabaseLogoUrl = (dbType: string): string => {
    // Using simple-icons CDN for logos
    const iconMap: Record<string, string> = {
      postgresql: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/postgresql.svg',
      mysql: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/mysql.svg',
      sqlserver: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/microsoftsqlserver.svg',
      duckdb: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/duckdb.svg',
      clickhouse: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/clickhouse.svg',
      snowflake: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/snowflake.svg',
      bigquery: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/googlebigquery.svg',
      redshift: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/amazonredshift.svg',
      delta_lake: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/delta.svg',
      iceberg: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/apacheiceberg.svg',
      s3_parquet: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/amazons3.svg',
      azure_blob: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/microsoftazure.svg',
      gcp_cloud_storage: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/googlecloud.svg',
      prometheus_source: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/prometheus.svg',
    };
    return iconMap[dbType] || 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/database.svg';
  };

  // Helper component to render database logo with theme-aware colored styling
  const DatabaseLogo: React.FC<{ dbType: string; size?: number }> = ({ dbType, size = 20 }) => {
    const logoUrl = getDatabaseLogoUrl(dbType);
    const [imgError, setImgError] = useState(false);
    const brandColor = brandColors[dbType] || '#666';

    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          marginRight: '8px',
          flexShrink: 0,
          verticalAlign: 'middle',
          position: 'relative',
        }}
      >
        {!imgError ? (
          <img
            src={logoUrl}
            alt={`${dbType} logo`}
            width={size}
            height={size}
            style={{
              objectFit: 'contain',
              display: 'block',
              // Apply brand color as CSS filter to colorize the SVG
              // Using a combination of filters to apply brand color tinting
              filter: isDarkMode
                ? `brightness(1.15) contrast(1.1) drop-shadow(0 0 2px ${brandColor}50)`
                : `drop-shadow(0 0 1px ${brandColor}40)`,
              // Add subtle padding and background for better visibility
              padding: '1px',
              borderRadius: '2px',
              backgroundColor: isDarkMode ? `${brandColor}15` : 'transparent',
            }}
            onError={() => setImgError(true)}
          />
        ) : (
          // Fallback: colored badge with first letter
          <span
            style={{
              width: size,
              height: size,
              borderRadius: '4px',
              backgroundColor: brandColor,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: size * 0.6,
              fontWeight: 'bold',
              textTransform: 'uppercase',
              boxShadow: isDarkMode ? `0 0 4px ${brandColor}60` : `0 1px 2px ${brandColor}40`,
            }}
          >
            {dbType.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
    );
  };

  // Database types
  // NOTE: The core relational/warehouse options mirror `CubeConnectorService.supported_databases`.
  // Additional data lake / cloud storage options are backed by dedicated connectors.
  const databaseTypes = [
    {
      value: 'postgresql',
      label: t('db_label_postgresql'),
      port: 5432,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: false,
    },
    {
      value: 'mysql',
      label: t('db_label_mysql'),
      port: 3306,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: false,
    },
    {
      value: 'sqlserver',
      label: t('db_label_sqlserver'),
      port: 1433,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: false,
    },
    {
      value: 'clickhouse',
      label: t('db_label_clickhouse'),
      port: 8123,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: false,
    },
    {
      value: 'duckdb',
      label: t('db_label_duckdb'),
      port: null,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: false,
    },
    {
      value: 'snowflake',
      label: t('db_label_snowflake'),
      port: 443,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 'bigquery',
      label: t('db_label_bigquery'),
      port: null,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 'redshift',
      label: t('db_label_redshift'),
      port: 5439,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 'delta_lake',
      label: t('db_label_delta_lake'),
      port: null,
      isDataLake: true,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 'iceberg',
      label: t('db_label_iceberg'),
      port: null,
      isDataLake: true,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 's3_parquet',
      label: t('db_label_s3_parquet'),
      port: null,
      isDataLake: false,
      isCloudStorage: true,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 'azure_blob',
      label: t('db_label_azure_blob'),
      port: null,
      isDataLake: false,
      isCloudStorage: true,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 'gcp_cloud_storage',
      label: t('db_label_gcp_cloud_storage'),
      port: null,
      isDataLake: false,
      isCloudStorage: true,
      isNoSQL: false,
      disabled: true,
    },
    {
      value: 'mongodb',
      label: t('db_label_mongodb'),
      port: 27017,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: true,
      disabled: false,
    },
    {
      value: 'cassandra',
      label: t('db_label_cassandra'),
      port: 9042,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: true,
      disabled: false,
    },
    {
      value: 'dynamodb',
      label: t('db_label_dynamodb'),
      port: null,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: true,
      disabled: false,
    },
    {
      value: 'prometheus_source',
      label: t('db_label_prometheus'),
      port: 9090,
      isDataLake: false,
      isCloudStorage: false,
      isNoSQL: false,
      disabled: false,
    },
  ];

  const [selectedDatabaseType, setSelectedDatabaseType] = useState('postgresql');

  // Track user modifications to prevent overriding user input
  const userModifiedRef = useRef({
    port: false,
    sslMode: false,
    host: false,
    database: false,
    username: false,
    password: false,
  });

  // Set defaults only when database type changes and user hasn't modified the field
  useEffect(() => {
    const databaseTypes = [
      {
        value: 'postgresql',
        label: t('db_label_postgresql'),
        port: 5432,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: false,
      },
      {
        value: 'mysql',
        label: t('db_label_mysql'),
        port: 3306,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: false,
      },
      {
        value: 'sqlserver',
        label: t('db_label_sqlserver'),
        port: 1433,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: false,
      },
      {
        value: 'clickhouse',
        label: t('db_label_clickhouse'),
        port: 8123,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: false,
      },
      {
        value: 'duckdb',
        label: t('db_label_duckdb'),
        port: null,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: false,
      },
      {
        value: 'snowflake',
        label: t('db_label_snowflake'),
        port: 443,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 'bigquery',
        label: t('db_label_bigquery'),
        port: null,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 'redshift',
        label: t('db_label_redshift'),
        port: 5439,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 'delta_lake',
        label: t('db_label_delta_lake'),
        port: null,
        isDataLake: true,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 'iceberg',
        label: t('db_label_iceberg'),
        port: null,
        isDataLake: true,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 's3_parquet',
        label: t('db_label_s3_parquet'),
        port: null,
        isDataLake: false,
        isCloudStorage: true,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 'azure_blob',
        label: t('db_label_azure_blob'),
        port: null,
        isDataLake: false,
        isCloudStorage: true,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 'gcp_cloud_storage',
        label: t('db_label_gcp_cloud_storage'),
        port: null,
        isDataLake: false,
        isCloudStorage: true,
        isNoSQL: false,
        disabled: true,
      },
      {
        value: 'mongodb',
        label: t('db_label_mongodb'),
        port: 27017,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: true,
        disabled: false,
      },
      {
        value: 'cassandra',
        label: t('db_label_cassandra'),
        port: 9042,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: true,
        disabled: false,
      },
      {
        value: 'dynamodb',
        label: t('db_label_dynamodb'),
        port: null,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: true,
        disabled: false,
      },
      {
        value: 'prometheus_source',
        label: t('db_label_prometheus'),
        port: 9090,
        isDataLake: false,
        isCloudStorage: false,
        isNoSQL: false,
        disabled: false,
      },
    ];

    const dbType = databaseTypes.find((db) => db.value === selectedDatabaseType);
    if (dbType) {
      setConnectionConfig((prev) => ({
        ...prev,
        // Only set defaults if user hasn't manually modified these fields
        port: !userModifiedRef.current.port ? dbType.port || prev.port : prev.port,
        sslMode: !userModifiedRef.current.sslMode ? 'prefer' : prev.sslMode,
      }));
    }
  }, [selectedDatabaseType]);

  // Reset form when modal opens; pre-fill when editing existing data source
  useEffect(() => {
    if (isOpen) {
      if (existingDataSource?.id) {
        const conn = existingDataSource.connection_config || {};
        const custom = (conn as any).custom_fields || {};
        const dsType = (existingDataSource.type || '').toLowerCase();
        const dbType = (conn.type || (existingDataSource as any).db_type || 'postgresql').toLowerCase();
        setSelectedDatabaseType(dbType);
        setDataSourceConfig({
          name: existingDataSource.name || '',
          type: (existingDataSource.type as any) || initialDataSourceType,
          description: existingDataSource.description || '',
        });
        if (dsType === 'api') {
          const authType =
            conn.auth_type ||
            (conn.bearer_token ? 'bearer' : conn.api_key ? 'api_key' : conn.username ? 'basic' : 'none');
          setConnectionConfig((prev) => ({
            ...prev,
            host: conn.url || conn.base_url || prev.host,
            apiPath: conn.path != null ? String(conn.path).replace(/^\//, '') : (prev.apiPath ?? ''),
            apiMethod: conn.method || 'GET',
            authType,
            apiBasicUsername:
              authType === 'basic' ? (conn.username ?? prev.apiBasicUsername) : (prev.apiBasicUsername ?? ''),
            password: conn.bearer_token ?? conn.api_key ?? conn.password ?? prev.password ?? '',
            apiHeaders:
              conn.headers != null
                ? typeof conn.headers === 'string'
                  ? conn.headers
                  : JSON.stringify(conn.headers, null, 2)
                : (prev.apiHeaders ?? ''),
            max_rows: conn.max_rows != null ? Number(conn.max_rows) : prev.max_rows,
          }));
        } else if (dsType === 'sample_duckdb') {
          setSelectedSampleDomain(String(conn.domain || 'banking').toLowerCase());
        } else if (dsType === 'google_sheets') {
          setDataSourceConfig((prev) => ({ ...prev, type: 'file' }));
          setFileSourceKind('google_sheet');
          setGoogleSheetUrl(String(conn.sheet_url || '').trim());
          setGoogleSheetGid(String(conn.gid || '').trim());
        } else {
          const portVal = conn.port ?? custom.port;
          const databaseVal =
            conn.database || conn.db || conn.catalog || custom.database || custom.db || custom.catalog;
          const sslVal = conn.ssl_mode || conn.sslmode || custom.ssl_mode || custom.sslmode || 'disable';
          setConnectionConfig((prev) => ({
            ...prev,
            host: conn.host || conn.hostname || custom.host || prev.host,
            port: typeof portVal === 'number' ? portVal : parseInt(portVal, 10) || prev.port,
            database: databaseVal || prev.database,
            username: conn.username || conn.user || custom.username || prev.username,
            password: conn.password || conn.pass || custom.password || '',
            sslMode: sslVal || prev.sslMode,
            connectionPool: prev.connectionPool,
            minConnections: prev.minConnections,
            maxConnections: prev.maxConnections,
            connectionTimeout:
              typeof conn.connection_timeout === 'number'
                ? conn.connection_timeout
                : parseInt(conn.connection_timeout, 10) || prev.connectionTimeout,
            trustServerCertificate:
              typeof (conn as any).trust_server_certificate === 'boolean'
                ? (conn as any).trust_server_certificate
                : (prev.trustServerCertificate ?? true),
            driver: (conn as any).driver ?? prev.driver,
            authSource: (conn as any).auth_source ?? (conn as any).authSource ?? prev.authSource,
            datacenter: (conn as any).datacenter ?? (conn as any).local_dc ?? prev.datacenter,
            prometheusUrl:
              (conn as any).prometheus_url ?? (conn as any).prometheusUrl ?? prev.prometheusUrl ?? '',
          }));
        }
        setCurrentStep(1);
        setTestResult(null);
        setUploadedFile(null);
      } else {
        setCurrentStep(0);
        setDataSourceConfig({
          name: '',
          type: initialDataSourceType,
          description: '',
        });
        setTestResult(null);
        setUploadedFile(null);
      }
    }
  }, [isOpen, initialDataSourceType, existingDataSource?.id]);

  // Update port when database type changes (skip when editing so we keep pre-filled port)
  useEffect(() => {
    if (existingDataSource?.id) return;
    const dbType = databaseTypes.find((db) => db.value === selectedDatabaseType);
    if (dbType && dbType.port) {
      setConnectionConfig((prev) => ({ ...prev, port: dbType.port! }));
    }
  }, [selectedDatabaseType, existingDataSource?.id]);

  const steps = [
    {
      title: t('step_type_title'),
      description: t('step_type_desc'),
    },
    {
      title: t('step_configure_title'),
      description: t('step_configure_desc'),
    },
  ];

  const handleDataSourceTypeSelect = (type: string) => {
    setDataSourceConfig((prev) => ({
      ...prev,
      type: type as any,
      ...(type === 'sample_duckdb' && !prev.name
        ? { name: `Sample: ${SAMPLE_DOMAINS.find((d) => d.value === selectedSampleDomain)?.label ?? selectedSampleDomain}` }
        : {}),
    }));
    if (type === 'file') setFileSourceKind('upload');
    setCurrentStep(1);
  };

  const handleFileUpload = async (file: File) => {
    setUploadedFile(file);
    // Auto-fill data source name from filename (remove extension)
    const autoName = file.name.split('.').slice(0, -1).join('.') || file.name;
    setDataSourceConfig((prev) => ({
      ...prev,
      name: prev.name || autoName, // Only auto-fill if name is empty
    }));

    // Reset preview and options
    setFilePreview(null);
    setSelectedSheet('');
    setHeaderRow(null);
    setShowHeaderAssist(false);
    setAvailableSheets([]);

    // Auto-detect delimiter for CSV files
    if (file.name.endsWith('.csv')) {
      setDelimiter(',');
    } else if (file.name.endsWith('.tsv')) {
      setDelimiter('\t');
    }

    // Auto-preview the file
    // Small delay to ensure state is updated
    setTimeout(() => {
      handlePreviewFile();
    }, 100);

    return false; // Prevent auto upload
  };

  const handlePreviewFile = async (skipSave: boolean = true) => {
    if (!uploadedFile) return;

    setLoading(true);
    try {
      // Create a preview request to get file structure
      // Note: This uploads the file but we can skip saving to data sources if skipSave is true
      const formData = new FormData();
      formData.append('file', uploadedFile);
      if (currentProject?.id) formData.append('project_id', currentProject.id.toString());
      formData.append('include_preview', 'true');
      if (delimiter) formData.append('delimiter', delimiter);
      if (headerRow !== null && Number.isFinite(headerRow) && headerRow >= 0) {
        formData.append('header_row', String(headerRow));
      }
      if (selectedSheet) formData.append('sheet_name', selectedSheet);
      // Add a flag to indicate this is preview-only (backend can handle this)
      if (skipSave) {
        formData.append('preview_only', 'true');
      }

      const response = await fetch('/api/data/upload', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

            if (response.ok) {
                const result = await response.json();
                if (result.data_source?.preview_data) {
                    setFilePreview(result.data_source.preview_data);
                    setShowHeaderAssist(false);
                    // Extract sheet names if available
                    if (result.data_source.sheets) {
                        setAvailableSheets(result.data_source.sheets);
                        if (result.data_source.sheets.length > 0 && !selectedSheet) {
                            setSelectedSheet(result.data_source.sheets[0]);
                        }
                    }
                    setTestResult({ success: true, message: t('preview_loaded_successfully') });
                } else if (result.success) {
                    // If no preview_data but success, try to extract from data_source
                    setTestResult({ success: true, message: t('file_processed_successfully') });
                }
            } else {
                const errorData = await response.json().catch(() => ({ error: t('preview_failed') }));
                if (response.status === 403 && errorData.detail?.error) {
                    const err = new ApiError(403, errorData.detail);
                    if (handlePlanLimitError(err)) return;
                }
                const errMsg = errorData.error || (typeof errorData.detail === 'string' ? errorData.detail : t('preview_failed'));
                const lower = String(errMsg).toLowerCase();
                const likelyHeaderIssue =
                  lower.includes('error tokenizing data') ||
                  lower.includes('expected') ||
                  lower.includes('saw') ||
                  lower.includes('header');
                setShowHeaderAssist(likelyHeaderIssue);
                setTestResult({ success: false, error: errMsg });
            }
        } catch (error: any) {
            console.error('Preview error:', error);
            const errMsg = error.message || t('preview_failed');
            const lower = String(errMsg).toLowerCase();
            const likelyHeaderIssue =
              lower.includes('error tokenizing data') ||
              lower.includes('expected') ||
              lower.includes('saw') ||
              lower.includes('header');
            setShowHeaderAssist(likelyHeaderIssue);
            setTestResult({ success: false, error: errMsg });
        } finally {
            setLoading(false);
        }
    };

  const generateConnectionUrl = () => {
    if (dataSourceConfig.type === 'api') {
      return connectionConfig.host || '';
    }

    if (!connectionConfig.host || !connectionConfig.database || !connectionConfig.username) {
      return '';
    }

    // SQLAlchemy connection URL format: dialect+driver://username:password@host:port/database
    let dialect = '';
    let driver = '';

    switch (selectedDatabaseType) {
      case 'postgresql':
        dialect = 'postgresql';
        driver = 'psycopg2';
        break;
      case 'mysql':
        dialect = 'mysql';
        driver = 'pymysql';
        break;
      case 'sqlserver':
        dialect = 'mssql';
        driver = 'pyodbc';
        break;
      case 'clickhouse':
        dialect = 'clickhouse';
        driver = 'native'; // Use native driver as recommended
        break;
      case 'snowflake':
        dialect = 'snowflake';
        driver = 'snowflake-sqlalchemy';
        break;
      case 'bigquery':
        dialect = 'bigquery';
        driver = 'bigquery';
        break;
      case 'redshift':
        dialect = 'redshift';
        driver = 'psycopg2';
        break;
      default:
        dialect = 'postgresql';
        driver = 'psycopg2';
    }

    const port = connectionConfig.port ? `:${connectionConfig.port}` : '';
    // Encode password (and username) so URI is valid: @ and : in password must be %40 and %3A
    const rawPassword = connectionConfig.password || '';
    const rawUsername = connectionConfig.username || '';
    const password = rawPassword ? `:${encodeURIComponent(rawPassword)}` : '';
    const username = encodeURIComponent(rawUsername);

    // Build query parameters
    const queryParams = [];
    if (connectionConfig.sslMode && connectionConfig.sslMode !== 'disable') {
      queryParams.push(`sslmode=${connectionConfig.sslMode}`);
    }

    // ClickHouse specific parameters
    if (selectedDatabaseType === 'clickhouse') {
      if (connectionConfig.sslMode === 'require') {
        queryParams.push('secure=true');
      }
      if (connectionConfig.connectionTimeout) {
        queryParams.push(`timeout=${connectionConfig.connectionTimeout}`);
      }
    }

    // SQL Server specific parameters (use ODBC Driver 18; TrustServerCertificate for Docker)
    if (selectedDatabaseType === 'sqlserver') {
      queryParams.push('driver=ODBC+Driver+18+for+SQL+Server');
      queryParams.push('TrustServerCertificate=yes');
      if (connectionConfig.sslMode === 'require') {
        queryParams.push('Encrypt=yes');
      }
    }

    const queryString = queryParams.length > 0 ? `?${queryParams.join('&')}` : '';

    return `${dialect}+${driver}://${username}${password}@${connectionConfig.host}${port}/${connectionConfig.database}${queryString}`;
  };

  /** Parse authority (user:password@host:port) so password can contain @ or :. Uses last @ to split userinfo from host. */
  const parseDbAuthority = (authority: string): { username: string; password: string; host: string; port: number } => {
    const atParts = authority.split('@');
    if (atParts.length < 2) {
      return { username: '', password: '', host: '', port: 0 };
    }
    const hostPort = atParts[atParts.length - 1];
    const userInfo = atParts.slice(0, -1).join('@');
    const colonIdx = userInfo.indexOf(':');
    const username = colonIdx >= 0 ? decodeURIComponent(userInfo.slice(0, colonIdx)) : decodeURIComponent(userInfo);
    const password = colonIdx >= 0 ? decodeURIComponent(userInfo.slice(colonIdx + 1)) : '';
    const portIdx = hostPort.lastIndexOf(':');
    const host = portIdx >= 0 ? hostPort.slice(0, portIdx) : hostPort;
    const portStr = portIdx >= 0 ? hostPort.slice(portIdx + 1) : '';
    const port = portStr ? parseInt(portStr, 10) || 0 : 0;
    return { username, password, host, port };
  };

  const parseConnectionUrl = (url: string) => {
    try {
      const afterProto = url.includes('://') ? url.split('://', 2)[1] : '';
      const protocolPart = url.includes('://') ? url.split('://')[0] : '';
      let dialect = '';
      let driver = '';
      if (protocolPart.includes('+')) {
        [dialect, driver] = protocolPart.split('+');
      } else {
        dialect = protocolPart;
      }

      const pathStart = afterProto.indexOf('/');
      const queryStart = afterProto.indexOf('?');
      const authorityEnd = pathStart >= 0 ? pathStart : queryStart >= 0 ? queryStart : afterProto.length;
      const authority = afterProto.slice(0, authorityEnd);
      const pathAndQuery = afterProto.slice(authorityEnd);
      const path = pathAndQuery.split('?')[0].replace(/^\/+/, '');
      const query = pathAndQuery.includes('?') ? pathAndQuery.slice(pathAndQuery.indexOf('?')) : '';

      const {
        username: decodedUsername,
        password: decodedPassword,
        host,
        port: parsedPort,
      } = parseDbAuthority(authority);
      const defaultPort =
        dialect === 'postgresql' ? 5432 : dialect === 'mysql' ? 3306 : dialect === 'clickhouse' ? 8123 : 1433;
      const port = parsedPort || defaultPort;

      let dbType = '';
      switch (dialect) {
        case 'postgresql':
          dbType = 'postgresql';
          break;
        case 'mysql':
          dbType = 'mysql';
          break;
        case 'mssql':
          dbType = 'sqlserver';
          break;
        case 'clickhouse':
          dbType = 'clickhouse';
          break;
        case 'snowflake':
          dbType = 'snowflake';
          break;
        case 'bigquery':
          dbType = 'bigquery';
          break;
        case 'redshift':
          dbType = 'redshift';
          break;
        default:
          dbType = 'postgresql';
      }

      setSelectedDatabaseType(dbType);

      let sslMode = 'prefer';
      if (query) {
        const params = new URLSearchParams(query.startsWith('?') ? query.slice(1) : query);
        if (params.has('sslmode')) sslMode = params.get('sslmode') || 'prefer';
        else if (params.get('secure') === 'true') sslMode = 'require';
        else if (params.get('Encrypt') === 'yes') sslMode = 'require';
      }

      setConnectionConfig((prev) => ({
        ...prev,
        host: host || prev.host,
        port: port || prev.port,
        database: path || prev.database,
        username: decodedUsername || prev.username,
        password: decodedPassword !== undefined ? decodedPassword : prev.password,
        sslMode,
      }));

      userModifiedRef.current.host = true;
      userModifiedRef.current.port = true;
      userModifiedRef.current.database = true;
      userModifiedRef.current.username = true;
      userModifiedRef.current.password = true;
      userModifiedRef.current.sslMode = true;

      message.success(t('connection_url_parsed'));
    } catch (error) {
      message.error(
        'Invalid connection URL format. Use username:password@host:port/db (password with @ or : is supported).'
      );
    }
  };

  const testConnection = async () => {
    setLoading(true);
    setTestResult(null);
    try {
      if (dataSourceConfig.type === 'file') {
        if (fileSourceKind === 'google_sheet') {
          const sheetUrl = googleSheetUrl?.trim();
          if (!sheetUrl) {
            setTestResult({ success: false, error: t('google_url_required') });
            return;
          }
          try {
            const result = await authenticatedFetch('/api/data/sources/test-google-sheet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sheet_url: sheetUrl,
                ...(googleSheetGid?.trim() ? { gid: googleSheetGid.trim() } : {}),
              }),
            });
            if (result?.success) {
              setTestResult({ success: true, message: result.message || 'Google Sheet connection successful' });
            } else {
              setTestResult({ success: false, error: result?.error || 'Failed to connect to sheet' });
            }
          } catch (e: any) {
            setTestResult({ success: false, error: e?.message || 'Failed to test Google Sheet connection' });
          }
          return;
        }
        if (!uploadedFile) {
          setTestResult({ success: false, error: t('please_select_file_upload') });
          return;
        }
        // Auto-fill name if empty
        if (!dataSourceConfig.name) {
          const autoName = uploadedFile.name.split('.').slice(0, -1).join('.') || uploadedFile.name;
          setDataSourceConfig((prev) => ({ ...prev, name: autoName }));
        }
        setTestResult({
          success: true,
          message: `File ready: ${uploadedFile.name} (${(uploadedFile.size / 1024).toFixed(1)} KB)`,
        });
        return;
      }

      if (
        dataSourceConfig.type === 'warehouse' &&
        ['delta_lake', 'iceberg', 's3_parquet', 'azure_blob'].includes(selectedDatabaseType)
      ) {
        // Test cloud storage connection
        if (!connectionConfig.storageUri || connectionConfig.storageUri.trim() === '') {
          setTestResult({ success: false, error: t('storage_uri_required') });
          return;
        }

        const hasS3Creds =
          connectionConfig.storageUri.startsWith('s3://') && connectionConfig.accessKey && connectionConfig.secretKey;
        const hasAzureCreds =
          connectionConfig.storageUri.startsWith('azure://') &&
          connectionConfig.accountName &&
          (connectionConfig.accountKey || connectionConfig.sasToken);

        if (!hasS3Creds && !hasAzureCreds) {
          setTestResult({ success: false, error: t('cloud_credentials_required') });
          return;
        }

        // Test connection via backend
        try {
          const formatType =
            selectedDatabaseType === 'delta_lake'
              ? 'delta'
              : selectedDatabaseType === 'iceberg'
                ? 'iceberg'
                : selectedDatabaseType === 's3_parquet'
                  ? 's3_parquet'
                  : 'azure_blob';

          const testRequest = {
            format_type: formatType,
            storage_uri: connectionConfig.storageUri.trim(),
            credentials: {
              ...(connectionConfig.accessKey && { access_key: connectionConfig.accessKey }),
              ...(connectionConfig.secretKey && { secret_key: connectionConfig.secretKey }),
              ...(connectionConfig.region && { region: connectionConfig.region }),
              ...(connectionConfig.accountName && { account_name: connectionConfig.accountName }),
              ...(connectionConfig.accountKey && { account_key: connectionConfig.accountKey }),
              ...(connectionConfig.sasToken && { sas_token: connectionConfig.sasToken }),
            },
            ...(connectionConfig.version && { version: connectionConfig.version }),
            ...(connectionConfig.timestamp && { timestamp: connectionConfig.timestamp }),
            ...(connectionConfig.snapshotId && { snapshot_id: connectionConfig.snapshotId }),
          };

          const result = await fetchApi('/api/data/delta-iceberg/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testRequest),
          });

          setTestResult(result);
        } catch (error: any) {
          setTestResult({
            success: false,
            error: error.message || t('connection_test_failed_check_settings'),
          });
        }
        return;
      }

      if (dataSourceConfig.type === 'api') {
        if (!connectionConfig.host || !dataSourceConfig.name) {
          setTestResult({ success: false, error: t('required_fields') });
          return;
        }

        // Test API connection by making a simple request
        try {
          const testUrl = connectionConfig.host.endsWith('/')
            ? connectionConfig.host + 'health'
            : connectionConfig.host + '/health';

          const response = await fetch(testUrl, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
              ...(connectionConfig.password && { Authorization: `Bearer ${connectionConfig.password}` }),
            },
            signal: AbortSignal.timeout(5000), // 5 second timeout
          });

          if (response.ok) {
            setTestResult({ success: true, message: t('api_endpoint_accessible') });
          } else {
            setTestResult({
              success: true,
              message: t('api_endpoint_status', { status: response.status }),
            });
          }
        } catch (error) {
          setTestResult({
            success: true,
            message: t('api_configuration_validated'),
          });
        }
        return;
      }

      // Database/Warehouse connection test
      if (selectedDatabaseType === 'prometheus_source') {
        if (!connectionConfig.prometheusUrl?.trim()) {
          setTestResult({ success: false, error: t('test_fill_prometheus') });
          return;
        }
        const endpoint = '/api/data/database/test';
        const requestBody = {
          type: 'prometheus_source',
          name: dataSourceConfig.name || 'Prometheus',
          prometheus_url: connectionConfig.prometheusUrl.trim(),
          host: connectionConfig.prometheusUrl.trim(),
          port: connectionConfig.port || 9090,
        };
        const result = await fetchApi(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
        setTestResult(result);
        return;
      }

      const hasManualFields =
        connectionConfig.host && connectionConfig.database && connectionConfig.username && connectionConfig.password;
      const useUriForTest =
        customConnectionUrl &&
        customConnectionUrl.trim().length > 0 &&
        selectedDatabaseType !== 'delta_lake' &&
        selectedDatabaseType !== 'iceberg';

      const isNoSQL = ['mongodb', 'cassandra', 'dynamodb'].includes(selectedDatabaseType);
      const noSqlOk =
        isNoSQL &&
        ((selectedDatabaseType === 'mongodb' && connectionConfig.host && connectionConfig.database) ||
          (selectedDatabaseType === 'cassandra' && connectionConfig.host && connectionConfig.database) ||
          (selectedDatabaseType === 'dynamodb' &&
            connectionConfig.region &&
            connectionConfig.accessKey &&
            connectionConfig.secretKey));
      if (
        !useUriForTest &&
        !noSqlOk &&
        (!connectionConfig.host ||
          !connectionConfig.database ||
          !connectionConfig.username ||
          !connectionConfig.password)
      ) {
        setTestResult({
          success: false,
          error: isNoSQL ? t('test_fill_nosql') : t('test_fill_db_fields'),
        });
        return;
      }

      // Use the correct endpoint based on database type
      const endpoint = '/api/data/database/test';
      let requestBody: Record<string, unknown>;
      if (useUriForTest) {
        requestBody = {
          type: selectedDatabaseType,
          uri: customConnectionUrl.trim(),
          name: dataSourceConfig.name,
          connection_type: 'uri',
          ssl_mode: connectionConfig.sslMode,
        };
      } else if (selectedDatabaseType === 'mongodb') {
        requestBody = {
          type: 'mongodb',
          connection_string: connectionConfig.host,
          database: connectionConfig.database,
          ...(connectionConfig.authSource && { auth_source: connectionConfig.authSource }),
          ...(connectionConfig.username && { username: connectionConfig.username }),
          ...(connectionConfig.password && { password: connectionConfig.password }),
        };
      } else if (selectedDatabaseType === 'cassandra') {
        requestBody = {
          type: 'cassandra',
          host: connectionConfig.host,
          port: connectionConfig.port || 9042,
          keyspace: connectionConfig.database,
          ...(connectionConfig.datacenter && { datacenter: connectionConfig.datacenter }),
          ...(connectionConfig.username && { username: connectionConfig.username }),
          ...(connectionConfig.password && { password: connectionConfig.password }),
        };
      } else if (selectedDatabaseType === 'dynamodb') {
        requestBody = {
          type: 'dynamodb',
          region: connectionConfig.region || 'us-east-1',
          ...(connectionConfig.endpoint && { endpoint: connectionConfig.endpoint }),
          access_key_id: connectionConfig.accessKey,
          secret_access_key: connectionConfig.secretKey,
        };
      } else {
        requestBody = {
          type: selectedDatabaseType,
          host: connectionConfig.host,
          port: connectionConfig.port,
          database: connectionConfig.database,
          username: connectionConfig.username,
          password: connectionConfig.password,
          ssl_mode: connectionConfig.sslMode,
          connection_timeout: connectionConfig.connectionTimeout ?? 30,
          ...(selectedDatabaseType === 'sqlserver' && {
            trust_server_certificate: connectionConfig.trustServerCertificate !== false,
            ...(connectionConfig.driver?.trim() && { driver: connectionConfig.driver.trim() }),
          }),
        };
      }

      // All databases use the same test endpoint - no need for special handling
      // The backend /data/database/test handles all database types including warehouses

      const result = await fetchApi(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      console.log('Test result:', result);
      setTestResult(result);
    } catch (error) {
      setTestResult({
        success: false,
        error: t('connection_test_failed_check_settings'),
      });
    } finally {
      setLoading(false);
    }
  };

  const saveDataSource = async () => {
    setLoading(true);
    try {
      let response: Response | undefined;

      if (dataSourceConfig.type === 'file') {
        if (fileSourceKind === 'google_sheet') {
          const name = dataSourceConfig.name?.trim();
          if (!name) {
            message.error(t('google_name_required'));
            setLoading(false);
            return;
          }
          const sheetUrl = googleSheetUrl?.trim();
          if (!sheetUrl) {
            message.error(t('google_url_required'));
            setLoading(false);
            return;
          }
          const connectionConfigSheets = {
            sheet_url: sheetUrl,
            ...(googleSheetGid?.trim() ? { gid: googleSheetGid.trim() } : {}),
          };
          try {
            if (existingDataSource?.id) {
              const result = await authenticatedFetch(`/api/data/sources/${existingDataSource.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name,
                  type: 'google_sheets',
                  description: dataSourceConfig.description || undefined,
                  connection_config: connectionConfigSheets,
                }),
              });
              if (result?.success && result?.data_source) {
                message.success(`${result.data_source.name} ${t('connection_successful')}`);
                onDataSourceCreated(result.data_source);
                window.dispatchEvent(new CustomEvent('datasource-created', { detail: result.data_source }));
                setTimeout(() => onClose(), 500);
              } else {
                const errMsg = (result as any)?.error ?? (result as any)?.detail ?? 'Update failed';
                message.error(errMsg);
              }
            } else {
              const result = await authenticatedFetch('/api/data/sources', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name,
                  type: 'google_sheets',
                  description: dataSourceConfig.description || undefined,
                  connection_config: connectionConfigSheets,
                  project_id: String(currentProject!.id),
                }),
              });
              if (result?.success && result?.data_source) {
                const ds = {
                  id: result.data_source.id,
                  name: result.data_source.name,
                  type: 'google_sheets',
                  connection_config: result.data_source.connection_config,
                  status: 'connected',
                  created_at: new Date().toISOString(),
                };
                onDataSourceCreated(ds);
                window.dispatchEvent(new CustomEvent('datasource-created', { detail: ds }));
                onClose();
                message.success(t('google_source_added'));
              } else {
                const errMsg = (result as any)?.error ?? (result as any)?.detail ?? 'Create failed';
                message.error(errMsg);
              }
            }
          } catch (e: any) {
            if (handlePlanLimitError(e)) { setLoading(false); return; }
            message.error(e?.message || t('google_save_failed'));
          } finally {
            setLoading(false);
          }
          return;
        }

        if (!uploadedFile) {
          setTestResult({ success: false, error: t('please_select_file_upload') });
          message.error(t('please_select_file_upload'));
          return;
        }

        // Auto-fill name if empty
        if (!dataSourceConfig.name || dataSourceConfig.name.trim() === '') {
          const autoName = uploadedFile.name.split('.').slice(0, -1).join('.') || uploadedFile.name;
          setDataSourceConfig((prev) => ({ ...prev, name: autoName }));
        }

        // Validate file name
        if (!dataSourceConfig.name || dataSourceConfig.name.trim() === '') {
          setTestResult({ success: false, error: t('data_source_name_required') });
          message.error(t('data_source_name_required'));
          return;
        }

        // Verify file is included and is a valid File object BEFORE creating FormData
        if (!uploadedFile || !(uploadedFile instanceof File)) {
          setTestResult({ success: false, error: t('valid_file_required') });
          message.error(t('valid_file_required'));
          setLoading(false);
          return;
        }

        // Create FormData and append file
        const formData = new FormData();
        formData.append('file', uploadedFile, uploadedFile.name); // Include filename explicitly
        formData.append('name', dataSourceConfig.name.trim());
        if (currentProject?.id) formData.append('project_id', currentProject.id.toString());
        formData.append('include_preview', 'true');
        if (delimiter) formData.append('delimiter', delimiter);
        if (headerRow !== null && Number.isFinite(headerRow) && headerRow >= 0) {
          formData.append('header_row', String(headerRow));
        }
        if (selectedSheet) formData.append('sheet_name', selectedSheet);

        // Double-check file is in FormData
        if (!formData.has('file')) {
          setTestResult({ success: false, error: t('upload_failed') });
          message.error(t('upload_failed'));
          setLoading(false);
          return;
        }

        // Log for debugging (remove in production)
        console.log('Uploading file:', {
          name: uploadedFile.name,
          size: uploadedFile.size,
          type: uploadedFile.type,
          hasFile: formData.has('file'),
        });

        try {
          const result = await fetchApi('/api/data/upload', {
            method: 'POST',
            body: formData,
          });

          if (result.success) {
            const dataSource = result.data_source || {
              id: result.data_source_id,
              name: dataSourceConfig.name || uploadedFile.name,
              type: 'file',
              format: uploadedFile.name.split('.').pop(),
              status: 'connected',
              created_at: new Date().toISOString(),
            };
            onDataSourceCreated(dataSource);
            // Broadcast to DataSourceContext so it reloads the list automatically
            window.dispatchEvent(new CustomEvent('datasource-created', { detail: dataSource }));
            onClose();
            message.success(t('file_uploaded_saved'));
            setLoading(false);
            return;
          } else {
            const errorMessage = result.error || result.detail || 'Failed to upload file';
            setTestResult({ success: false, error: errorMessage });
            message.error(errorMessage);
            setLoading(false);
            return;
          }
        } catch (error: any) {
          if (handlePlanLimitError(error)) { setLoading(false); return; }
          const errorMessage = error.message || 'Network error. Please check your connection and try again.';
          setTestResult({ success: false, error: errorMessage });
          message.error(errorMessage);
          setLoading(false);
          return;
        }
      } else if (dataSourceConfig.type === 'api') {
        const baseUrl = connectionConfig.host?.trim() || '';
        const path = (connectionConfig.apiPath ?? '').trim().replace(/^\//, '');
        const authType = (connectionConfig.authType || connectionConfig.username || 'api_key').trim() || 'none';
        const connectionConfigApi: Record<string, unknown> = {
          url: baseUrl,
          base_url: baseUrl,
          path: path ? `/${path}` : undefined,
          method: (connectionConfig.apiMethod ?? 'GET').toUpperCase(),
          auth_type: authType,
          description: dataSourceConfig.description,
        };
        if (authType === 'basic') {
          connectionConfigApi.username = (connectionConfig.apiBasicUsername ?? '').trim();
          connectionConfigApi.password = connectionConfig.password ?? '';
        } else if (authType === 'bearer') {
          connectionConfigApi.bearer_token = connectionConfig.password ?? '';
        } else if (authType === 'api_key') {
          connectionConfigApi.api_key = connectionConfig.password ?? '';
        }
        if (connectionConfig.max_rows != null && connectionConfig.max_rows > 0) {
          connectionConfigApi.max_rows = connectionConfig.max_rows;
        }
        if ((connectionConfig.apiHeaders ?? '').trim()) {
          try {
            connectionConfigApi.headers = JSON.parse(connectionConfig.apiHeaders!.trim());
          } catch {
            connectionConfigApi.headers = {};
          }
        }
        try {
          if (existingDataSource?.id) {
            const updatePayload = {
              name: dataSourceConfig.name,
              description: dataSourceConfig.description || undefined,
              connection_config: connectionConfigApi,
            };
            const result = await authenticatedFetch(`/api/data/sources/${existingDataSource.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatePayload),
            });
            if (result?.success && result?.data_source) {
              message.success(`${result.data_source.name} ${t('connection_successful')}`);
              onDataSourceCreated(result.data_source);
              window.dispatchEvent(new CustomEvent('datasource-created', { detail: result.data_source }));
              setTimeout(() => onClose(), 500);
            } else {
              const errMsg = (result as any)?.error ?? (result as any)?.detail ?? t('err_update_failed');
              setTestResult({ success: false, error: errMsg });
              message.error(errMsg);
            }
            setLoading(false);
            return;
          }
          const createPayload = {
            name: dataSourceConfig.name,
            type: 'api',
            description: dataSourceConfig.description || undefined,
            connection_config: connectionConfigApi,
            project_id: currentProject?.id ? String(currentProject.id) : undefined,
          };
          const result = await authenticatedFetch('/api/data/sources', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(createPayload),
          });
          if (result?.success && result?.data_source) {
            const apiDataSource = {
              id: result.data_source.id,
              name: result.data_source.name,
              type: 'api',
              config: result.data_source.connection_config,
              connection_config: result.data_source.connection_config,
              status: 'connected',
              created_at: new Date().toISOString(),
            };
            onDataSourceCreated(apiDataSource);
            window.dispatchEvent(new CustomEvent('datasource-created', { detail: apiDataSource }));
            onClose();
            message.success(t('enterprise_connection_created'));
          } else {
            const errMsg = (result as any)?.error ?? (result as any)?.detail ?? t('failed_create_connection');
            setTestResult({ success: false, error: errMsg });
            message.error(errMsg);
          }
        } catch (e: any) {
          if (handlePlanLimitError(e)) { setLoading(false); return; }
          const errMsg = e?.message || t('failed_create_connection');
          setTestResult({ success: false, error: errMsg });
          message.error(errMsg);
        } finally {
          setLoading(false);
        }
        return;
      } else if (dataSourceConfig.type === 'sample_duckdb') {
        const name = dataSourceConfig.name?.trim();
        if (!name) {
          message.error(t('sample_name_required'));
          setLoading(false);
          return;
        }
        const connectionConfigSample = { domain: selectedSampleDomain };
        try {
          if (existingDataSource?.id) {
            const result = await authenticatedFetch(`/api/data/sources/${existingDataSource.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                description: dataSourceConfig.description || undefined,
                connection_config: connectionConfigSample,
              }),
            });
            if (result?.success && result?.data_source) {
              message.success(`${result.data_source.name} ${t('connection_successful')}`);
              onDataSourceCreated(result.data_source);
              window.dispatchEvent(new CustomEvent('datasource-created', { detail: result.data_source }));
              setTimeout(() => onClose(), 500);
            } else {
              const errMsg = (result as any)?.error ?? (result as any)?.detail ?? t('err_update_failed');
              message.error(errMsg);
            }
          } else {
            const result = await authenticatedFetch('/api/data/sources', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name,
                type: 'sample_duckdb',
                description: dataSourceConfig.description || undefined,
                connection_config: connectionConfigSample,
                project_id: String(currentProject!.id),
              }),
            });
            if (result?.success && result?.data_source) {
              const ds = {
                id: result.data_source.id,
                name: result.data_source.name,
                type: 'sample_duckdb',
                connection_config: result.data_source.connection_config,
                status: 'connected',
                created_at: new Date().toISOString(),
              };
              onDataSourceCreated(ds);
              window.dispatchEvent(new CustomEvent('datasource-created', { detail: ds }));
              onClose();
              message.success(t('sample_added'));
            } else {
              const errMsg = (result as any)?.error ?? (result as any)?.detail ?? t('failed_create_connection');
              message.error(errMsg);
            }
          }
        } catch (e: any) {
          if (handlePlanLimitError(e)) { setLoading(false); return; }
          message.error(e?.message || t('sample_save_failed'));
        } finally {
          setLoading(false);
        }
        return;
      } else {
        // Edit existing database/warehouse: PUT update
        if (existingDataSource?.id && (dataSourceConfig.type === 'database' || dataSourceConfig.type === 'warehouse')) {
          const conn: Record<string, any> =
            selectedDatabaseType === 'prometheus_source'
              ? {
                  type: 'prometheus_source',
                  prometheus_url: connectionConfig.prometheusUrl?.trim(),
                  host: connectionConfig.prometheusUrl?.trim(),
                  port: connectionConfig.port || 9090,
                }
              : {
                  type: selectedDatabaseType,
                  host: connectionConfig.host,
                  port: connectionConfig.port,
                  database: connectionConfig.database,
                  username: connectionConfig.username,
                  ssl_mode: connectionConfig.sslMode || 'disable',
                  connection_timeout: connectionConfig.connectionTimeout ?? 30,
                  connection_pool: connectionConfig.connectionPool ?? false,
                  min_connections: connectionConfig.minConnections ?? 1,
                  max_connections: connectionConfig.maxConnections ?? 10,
                };
          if (selectedDatabaseType !== 'prometheus_source') {
            if (connectionConfig.password && connectionConfig.password.trim()) conn.password = connectionConfig.password;
            if (selectedDatabaseType === 'sqlserver') {
              if (connectionConfig.trustServerCertificate !== undefined)
                conn.trust_server_certificate = connectionConfig.trustServerCertificate;
              if (connectionConfig.driver?.trim()) conn.driver = connectionConfig.driver.trim();
            }
          }
          const updatePayload = {
            name: dataSourceConfig.name,
            description: dataSourceConfig.description || undefined,
            connection_config: conn,
          };
          try {
            const updateUrl = `/api/data/sources/${existingDataSource.id}`;
            const result = await authenticatedFetch(updateUrl, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(updatePayload),
            });
            if (result?.success && result?.data_source) {
              message.success(`${result.data_source.name} ${t('connection_successful')}`);
              onDataSourceCreated(result.data_source);
              window.dispatchEvent(new CustomEvent('datasource-created', { detail: result.data_source }));
              setTimeout(() => onClose(), 500);
            } else {
              const errMsg = (result as any)?.error ?? (result as any)?.detail ?? t('err_update_failed');
              setTestResult({ success: false, error: errMsg });
              message.error(errMsg);
            }
          } catch (e: any) {
            setTestResult({ success: false, error: e?.message || t('err_update_failed') });
            message.error(e?.message || t('err_update_failed'));
          } finally {
            setLoading(false);
          }
          return;
        }

        // Database/Warehouse/Cloud Storage connection (create new)
        let endpoint = '/api/data/database/connect';
        let requestBody: any;

        // Handle data lake types (Delta/Iceberg) and cloud storage (S3/Azure/GCP) FIRST
        if (['delta_lake', 'iceberg', 's3_parquet', 'azure_blob', 'gcp_cloud_storage'].includes(selectedDatabaseType)) {
          // Validate cloud storage fields
          if (!connectionConfig.storageUri || connectionConfig.storageUri.trim() === '') {
            setTestResult({ success: false, error: t('storage_uri_required') });
            message.error(t('storage_uri_required'));
            return;
          }

          const hasS3Creds =
            connectionConfig.storageUri.startsWith('s3://') && connectionConfig.accessKey && connectionConfig.secretKey;
          const hasAzureCreds =
            (connectionConfig.storageUri.startsWith('azure://') ||
              connectionConfig.storageUri.startsWith('abfss://')) &&
            connectionConfig.accountName &&
            (connectionConfig.accountKey || connectionConfig.sasToken);
          const hasGCPCreds =
            (connectionConfig.storageUri.startsWith('gcs://') || connectionConfig.storageUri.startsWith('gs://')) &&
            connectionConfig.gcpCredentials;

          if (!hasS3Creds && !hasAzureCreds && !hasGCPCreds) {
            setTestResult({
              success: false,
              error: t('cloud_credentials_required'),
            });
            message.error(t('cloud_credentials_required'));
            return;
          }

          // For cloud storage (not data lakes), require file format
          const isCloudStorage = ['s3_parquet', 'azure_blob', 'gcp_cloud_storage'].includes(selectedDatabaseType);
          if (isCloudStorage && !connectionConfig.fileFormat) {
            setTestResult({ success: false, error: t('file_format_required') });
            message.error(t('file_format_required'));
            return;
          }

          // Auto-generate name if not provided
          let finalName = dataSourceConfig.name;
          if (!finalName || finalName.trim() === '') {
            const uriParts = connectionConfig.storageUri.split('/').filter((p) => p);
            const bucketOrAccount = uriParts[1] || 'Cloud Storage';
            finalName = `${databaseTypes.find((db) => db.value === selectedDatabaseType)?.label} - ${bucketOrAccount}`;
            setDataSourceConfig((prev) => ({ ...prev, name: finalName }));
          }

          // Use Delta/Iceberg connector endpoint
          endpoint = '/api/data/delta-iceberg/connect';
          requestBody = {
            format_type:
              selectedDatabaseType === 'delta_lake'
                ? 'delta'
                : selectedDatabaseType === 'iceberg'
                  ? 'iceberg'
                  : selectedDatabaseType === 's3_parquet'
                    ? 's3_parquet'
                    : selectedDatabaseType === 'azure_blob'
                      ? 'azure_blob'
                      : 'gcp_cloud_storage',
            storage_uri: connectionConfig.storageUri.trim(),
            credentials: {
              ...(connectionConfig.accessKey && { access_key: connectionConfig.accessKey }),
              ...(connectionConfig.secretKey && { secret_key: connectionConfig.secretKey }),
              ...(connectionConfig.region && { region: connectionConfig.region }),
              ...(connectionConfig.endpoint && { endpoint: connectionConfig.endpoint }),
              ...(connectionConfig.accountName && { account_name: connectionConfig.accountName }),
              ...(connectionConfig.accountKey && { account_key: connectionConfig.accountKey }),
              ...(connectionConfig.sasToken && { sas_token: connectionConfig.sasToken }),
              ...(connectionConfig.gcpCredentials && { service_account_key: connectionConfig.gcpCredentials }),
              ...(connectionConfig.gcpProjectId && { project_id: connectionConfig.gcpProjectId }),
            },
            name: finalName,
            ...(connectionConfig.fileFormat && { file_format: connectionConfig.fileFormat }),
            ...(connectionConfig.version && { version: connectionConfig.version }),
            ...(connectionConfig.timestamp && { timestamp: connectionConfig.timestamp }),
            ...(connectionConfig.snapshotId && { snapshot_id: connectionConfig.snapshotId }),
          };
        } else {
          // Regular database / NoSQL / warehouse connection
          if (selectedDatabaseType === 'prometheus_source') {
            if (!connectionConfig.prometheusUrl?.trim()) {
              setTestResult({ success: false, error: t('test_fill_prometheus') });
              message.error(t('test_fill_prometheus'));
              setLoading(false);
              return;
            }
            let finalNameProm = dataSourceConfig.name;
            if (!finalNameProm || finalNameProm.trim() === '') {
              finalNameProm = generateDataSourceName();
              setDataSourceConfig((prev) => ({ ...prev, name: finalNameProm }));
            }
            requestBody = {
              type: 'prometheus_source',
              name: finalNameProm,
              prometheus_url: connectionConfig.prometheusUrl.trim(),
              host: connectionConfig.prometheusUrl.trim(),
              port: connectionConfig.port || 9090,
            };
          } else {
          const isNoSQL = ['mongodb', 'cassandra', 'dynamodb'].includes(selectedDatabaseType);
          const hasManualFields =
            connectionConfig.host && connectionConfig.database && (isNoSQL || connectionConfig.username);
          const useUri = customConnectionUrl && customConnectionUrl.trim().length > 0 && !hasManualFields && !isNoSQL;

          const noSqlOk =
            isNoSQL &&
            ((selectedDatabaseType === 'mongodb' && connectionConfig.host && connectionConfig.database) ||
              (selectedDatabaseType === 'cassandra' && connectionConfig.host && connectionConfig.database) ||
              (selectedDatabaseType === 'dynamodb' &&
                connectionConfig.region &&
                connectionConfig.accessKey &&
                connectionConfig.secretKey));
          if (
            !useUri &&
            !noSqlOk &&
            (!connectionConfig.host ||
              !connectionConfig.database ||
              !connectionConfig.username ||
              !connectionConfig.password)
          ) {
            setTestResult({
              success: false,
              error: isNoSQL
                ? t('test_fill_nosql')
                : t('test_fill_db_fields'),
            });
            return;
          }

          // Auto-generate name if not provided
          let finalName = dataSourceConfig.name;
          if (!finalName || finalName.trim() === '') {
            finalName = generateDataSourceName();
            setDataSourceConfig((prev) => ({ ...prev, name: finalName }));
          }

          if (selectedDatabaseType === 'mongodb') {
            requestBody = {
              type: 'mongodb',
              name: finalName,
              connection_string: connectionConfig.host,
              database: connectionConfig.database,
              ...(connectionConfig.authSource && { auth_source: connectionConfig.authSource }),
              ...(connectionConfig.username && { username: connectionConfig.username }),
              ...(connectionConfig.password && { password: connectionConfig.password }),
            };
          } else if (selectedDatabaseType === 'cassandra') {
            requestBody = {
              type: 'cassandra',
              name: finalName,
              host: connectionConfig.host,
              port: connectionConfig.port || 9042,
              keyspace: connectionConfig.database,
              ...(connectionConfig.datacenter && { datacenter: connectionConfig.datacenter }),
              ...(connectionConfig.username && { username: connectionConfig.username }),
              ...(connectionConfig.password && { password: connectionConfig.password }),
            };
          } else if (selectedDatabaseType === 'dynamodb') {
            requestBody = {
              type: 'dynamodb',
              name: finalName,
              region: connectionConfig.region || 'us-east-1',
              ...(connectionConfig.endpoint && { endpoint: connectionConfig.endpoint }),
              access_key_id: connectionConfig.accessKey,
              secret_access_key: connectionConfig.secretKey,
              ...(connectionConfig.database && { table_name: connectionConfig.database }),
            };
          } else if (useUri) {
            requestBody = {
              type: selectedDatabaseType,
              uri: customConnectionUrl.trim(),
              name: finalName,
              connection_type: 'uri',
              ssl_mode: connectionConfig.sslMode || 'prefer',
            };
          } else {
            requestBody = {
              type: selectedDatabaseType,
              host: connectionConfig.host,
              port: connectionConfig.port,
              database: connectionConfig.database,
              username: connectionConfig.username,
              password: connectionConfig.password,
              name: finalName,
              ssl_mode: connectionConfig.sslMode,
              connection_type: 'manual',
              connection_timeout: connectionConfig.connectionTimeout ?? 30,
              min_connections: connectionConfig.minConnections ?? 1,
              max_connections: connectionConfig.maxConnections ?? 10,
              trust_server_certificate:
                selectedDatabaseType === 'sqlserver' ? (connectionConfig.trustServerCertificate ?? true) : undefined,
              ...(selectedDatabaseType === 'sqlserver' &&
                connectionConfig.driver?.trim() && { driver: connectionConfig.driver.trim() }),
            };
          }

          // For enterprise warehouses, use the warehouse connect endpoint
          if (['snowflake', 'bigquery', 'redshift', 'clickhouse'].includes(selectedDatabaseType)) {
            endpoint = '/api/data/warehouses/connect';
            requestBody = {
              connection_config: requestBody,
            };
          }
          }
        }

        // Inject project_id so the backend assigns the connection to the currently selected project
        if (currentProject?.id) {
          requestBody = { ...requestBody, project_id: String(currentProject.id) };
        }

        const result = await fetchApi(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        console.log('Save success:', result);

        if (result.success) {
          // Handle different response formats from different endpoints
          const dataSource = result.data_source || {
            id: result.data_source_id,
            name: dataSourceConfig.name,
            type: 'database',
            db_type: selectedDatabaseType,
            status: 'connected',
            connection_info: result.connection_info,
          };

          message.success({
            content: `${dataSource.name} ${t('connection_successful')}`,
            duration: 5,
            style: {
              marginTop: '20vh',
            },
          });

          // Notify parent to refresh data sources
          onDataSourceCreated(dataSource);

          // Trigger a custom event to refresh all data source panels
          window.dispatchEvent(
            new CustomEvent('datasource-created', {
              detail: dataSource,
            })
          );

          // Small delay to let user see the success message
          setTimeout(() => {
            onClose();
          }, 500);
        } else {
          setTestResult({ success: false, error: result.error || t('upload_failed') });
          message.error(result.error || t('upload_failed'));
        }
      }
    } catch (error: any) {
      console.error('Save failed:', error);
      if (!handlePlanLimitError(error)) {
        setTestResult({ success: false, error: error.message || t('upload_failed') });
        message.error(error.message || t('upload_failed'));
      }
    } finally {
      setLoading(false);
    }
  };

  const renderDataSourceTypeSelection = () => (
    <div style={{ padding: '8px 0' }}>
      <Title level={4} style={{ textAlign: 'center', marginBottom: '16px' }}>
        {t('choose_type_title')}
      </Title>
      <Row gutter={[16, 16]}>
        {dataSourceTypes.map((type) => (
          <Col xs={24} sm={12} key={type.key}>
            <Card
              hoverable
              onClick={() => handleDataSourceTypeSelect(type.key)}
              style={{
                textAlign: 'center',
                cursor: 'pointer',
                border: dataSourceConfig.type === type.key ? `2px solid #1890ff` : '1px solid #d9d9d9',
              }}
            >
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <div
                  style={{
                    fontSize: '32px',
                    color:
                      type.color === 'blue'
                        ? '#1890ff'
                        : type.color === 'green'
                          ? '#52c41a'
                          : type.color === 'purple'
                            ? '#722ed1'
                            : '#fa8c16',
                  }}
                >
                  {type.icon}
                </div>
                <Title level={5} style={{ margin: 0 }}>
                  {type.label}
                </Title>
                <Text type="secondary">{type.description}</Text>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );

  const renderFileUpload = () => {
    if (fileSourceKind === 'google_sheet') {
      return (
        <div style={{ padding: '24px 0' }}>
          <Title level={4}>{t('connect_google_sheet')}</Title>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            {t('connect_google_sheet_desc')}
          </Text>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label={t('data_source_name')} required>
                <Input
                  value={dataSourceConfig.name}
                  onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, name: e.target.value.trim() }))}
                  placeholder={t('google_name_placeholder')}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item
                label={t('sheet_url')}
                required
                help={t('sheet_url_help')}
              >
                <Input
                  value={googleSheetUrl}
                  onChange={(e) => {
                    const v = e.target.value.trim();
                    setGoogleSheetUrl(v);
                    const { gid } = parseGoogleSheetUrl(v);
                    if (gid != null) setGoogleSheetGid(gid);
                  }}
                  placeholder={t('sheet_url_placeholder')}
                />
              </Form.Item>
            </Col>
            <Col span={24}>
              <Form.Item label={t('sheet_gid_optional')} help={t('sheet_gid_help')}>
                <Input
                  value={googleSheetGid}
                  onChange={(e) => setGoogleSheetGid(e.target.value.trim())}
                  placeholder={t('sheet_gid_placeholder')}
                />
              </Form.Item>
            </Col>
          </Row>
        </div>
      );
    }
    return (
    <div style={{ padding: '24px 0' }}>
      <Title level={4}>{t('upload_your_file')}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: '24px' }}>
        {t('upload_file_desc')}
      </Text>
      <Form.Item label={t('how_add_data')} style={{ marginBottom: 16 }}>
        <Radio.Group
          value={fileSourceKind}
          onChange={(e) => setFileSourceKind(e.target.value)}
          optionType="button"
          buttonStyle="solid"
          options={[
            { label: t('upload_file_option'), value: 'upload' },
            { label: t('google_sheet_option'), value: 'google_sheet' },
          ]}
        />
      </Form.Item>
      {/* File Upload */}
      <Form.Item label={t('select_file')} required>
        <Dragger
          accept=".csv,.xlsx,.xls,.parquet,.json"
          beforeUpload={(file) => {
            handleFileUpload(file);
            return false; // Prevent auto upload
          }}
          showUploadList={false}
          style={{ padding: '24px 0' }}
        >
          <p className="ant-upload-drag-icon">
            <UploadOutlined style={{ fontSize: '48px', color: '#1890ff' }} />
          </p>
          <p className="ant-upload-text">
            {uploadedFile ? uploadedFile.name : t('click_or_drag_upload')}
          </p>
          <p className="ant-upload-hint" style={{ fontSize: '13px' }}>
            {t('single_file_upload_hint')}
          </p>
        </Dragger>

        {uploadedFile && (
          <Alert
            message={t('file_ready')}
            description={
              <span style={{ fontSize: '13px' }}>
                {t('file_ready_desc', {
                  name: uploadedFile.name,
                  size: (uploadedFile.size / 1024).toFixed(1),
                  extra: filePreview ? t('file_preview_loaded') : loading ? t('file_preview_loading') : '',
                })}
              </span>
            }
            type="success"
            showIcon
            style={{ marginTop: '8px', padding: '8px 16px' }}
          />
        )}
      </Form.Item>

      {/* File Options - Sheet Selection and Delimiter */}
      {uploadedFile && (
        <Row gutter={16}>
          {uploadedFile.name.endsWith('.xlsx') || uploadedFile.name.endsWith('.xls') ? (
            <Col span={12}>
              <Form.Item label={t('sheet_excel')} help={t('sheet_excel_help')}>
                <Select
                  value={selectedSheet}
                  onChange={setSelectedSheet}
                  placeholder={t('auto_detect')}
                  allowClear
                >
                  {availableSheets.map((sheet) => (
                    <Option key={sheet} value={sheet}>
                      {sheet}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          ) : null}
          {uploadedFile.name.endsWith('.csv') || uploadedFile.name.endsWith('.tsv') ? (
            <Col span={12}>
              <Form.Item label={t('delimiter')} help={t('delimiter_help')}>
                <Select
                  value={delimiter}
                  onChange={setDelimiter}
                >
                  <Option value=",">{t('delimiter_comma')}</Option>
                  <Option value=";">{t('delimiter_semicolon')}</Option>
                  <Option value="\t">{t('delimiter_tab')}</Option>
                  <Option value="|">{t('delimiter_pipe')}</Option>
                </Select>
              </Form.Item>
            </Col>
          ) : null}
        </Row>
      )}

      {/* Header-assist for CSVs with preamble rows or malformed first lines */}
      {uploadedFile && (uploadedFile.name.endsWith('.csv') || uploadedFile.name.endsWith('.tsv')) && showHeaderAssist && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t('header_row_warning')}
          description={
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text style={{ fontSize: 13 }}>
                {t('header_row_warning_desc')}
              </Text>
              <Space wrap>
                <Input
                  style={{ width: 180 }}
                  placeholder={t('header_row_placeholder')}
                  value={headerRow === null ? '' : String(headerRow)}
                  onChange={(e) => {
                    const raw = e.target.value.trim();
                    if (raw === '') {
                      setHeaderRow(null);
                      return;
                    }
                    const num = Number(raw);
                    if (Number.isFinite(num) && num >= 0) {
                      setHeaderRow(Math.floor(num));
                    }
                  }}
                />
                <Button onClick={() => handlePreviewFile(true)} loading={loading}>
                  {t('retry_preview')}
                </Button>
              </Space>
            </Space>
          }
        />
      )}

      {uploadedFile && (
        <Form.Item>
          <Button onClick={() => handlePreviewFile(true)} loading={loading}>
            {t('refresh_preview')}
          </Button>
        </Form.Item>
      )}

      {/* Data Preview */}
      {filePreview && Array.isArray(filePreview) && filePreview.length > 0 && (
        <Form.Item label={t('data_preview')} help={t('data_preview_help')}>
          <div
            className="aiser-themed-scrollbar"
            style={{
              maxHeight: '200px',
              overflow: 'auto',
              border: '1px solid var(--ant-color-border)',
              borderRadius: '4px',
              padding: '8px',
              backgroundColor: 'var(--ant-color-bg-container)',
            }}
          >
            <Table
              dataSource={filePreview.slice(0, 5)}
              columns={Object.keys(filePreview[0] || {}).map((key) => ({
                title: key,
                dataIndex: key,
                key: key,
              }))}
              pagination={false}
              size="small"
              scroll={{ x: 'max-content' }}
            />
            <Text type="secondary" style={{ fontSize: '12px', display: 'block', marginTop: '8px' }}>
              {t('showing_first_rows', { rows: 5, total: filePreview.length })}
            </Text>
          </div>
        </Form.Item>
      )}

      {/* Data Source Name */}
      <Form.Item label={t('data_source_name')} required>
        <Input
          value={dataSourceConfig.name}
          onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, name: e.target.value }))}
          placeholder={t('data_source_name_placeholder')}
        />
      </Form.Item>

      {/* Description */}
      <Form.Item label={t('description')}>
        <Input.TextArea
          value={dataSourceConfig.description}
          onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, description: e.target.value }))}
          placeholder={t('description_placeholder')}
          rows={3}
        />
      </Form.Item>

      {/* Test result alert for file uploads */}
      {testResult && (
        <Alert
          message={testResult.success ? t('file_ready_with_bang') : t('upload_failed_title')}
          description={<span style={{ fontSize: '13px' }}>{testResult.message || testResult.error}</span>}
          type={testResult.success ? 'success' : 'error'}
          showIcon
          style={{ marginTop: '16px' }}
        />
      )}
    </div>
  );
  };

  const renderDatabaseConfiguration = () => {
    const isCloudStorage = ['s3_parquet', 'azure_blob', 'gcp_cloud_storage'].includes(selectedDatabaseType);
    const isDataLake = ['delta_lake', 'iceberg'].includes(selectedDatabaseType);

    return (
      <div style={{ padding: '8px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <Title level={4} style={{ margin: 0 }}>
            {isCloudStorage
              ? t('cloud_storage_configuration')
              : isDataLake
                ? t('data_lake_configuration')
                : t('database_configuration')}
          </Title>
        </div>

        <Form layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={t('label_database_type')} required>
                <Select
                  value={selectedDatabaseType}
                  onChange={(value) => {
                    setSelectedDatabaseType(value);
                    // Clear connection config when changing database type to avoid confusion
                    setConnectionConfig((prev) => ({
                      host: '',
                      port: databaseTypes.find((db) => db.value === value)?.port || 5432,
                      database: '',
                      username: '',
                      password: '',
                      sslMode: 'prefer',
                      connectionPool: false,
                      minConnections: 1,
                      maxConnections: 10,
                      connectionTimeout: 30,
                      storageUri: '',
                      accessKey: '',
                      secretKey: '',
                      region: 'us-east-1',
                      endpoint: '',
                      accountName: '',
                      accountKey: '',
                      sasToken: '',
                      gcpProjectId: '',
                      gcpCredentials: '',
                      fileFormat: '',
                      version: undefined,
                      timestamp: '',
                      snapshotId: undefined,
                      prometheusUrl: '',
                    }));
                    setTestResult(null);
                  }}
                  style={{ width: '100%' }}
                >
                  {databaseTypes
                    .filter((db) => {
                      // Filter based on data source type selection
                      if (dataSourceConfig.type === 'database') {
                        // For "Database" type, show only traditional databases (not cloud storage or data lakes)
                        return !db.isDataLake && !db.isCloudStorage;
                      } else if (dataSourceConfig.type === 'warehouse') {
                        // For "Warehouse" type, show all warehouse options (databases, data lakes, cloud storage)
                        return true;
                      }
                      // Default: show all
                      return true;
                    })
                    .map((db) => (
                      <Option key={db.value} value={db.value} disabled={db.disabled}>
                        <Space>
                          <DatabaseLogo dbType={db.value} size={18} />
                          <span>{db.label}</span>
                        </Space>
                      </Option>
                    ))}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t('data_source_name')} required>
                <Input
                  value={dataSourceConfig.name}
                  onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t('ph_connection_name_suffix', { engine: databaseTypes.find((db) => db.value === selectedDatabaseType)?.label || '' })}
                />
              </Form.Item>
            </Col>
          </Row>

          {selectedDatabaseType === 'prometheus_source' ? (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item label={t('label_prometheus_url')} required help={t('help_prometheus_wizard')}>
                  <Input
                    value={connectionConfig.prometheusUrl || ''}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, prometheusUrl: e.target.value }))}
                    placeholder={t('ph_prometheus_host')}
                    autoComplete="off"
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : selectedDatabaseType === 'mongodb' ? (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item
                  label={t('label_connection_string')}
                  required
                  // help="Full URI (e.g. mongodb://host:27017). Credentials may be in the URI or in the fields below; values are user input only and handled securely by the platform."
                >
                  <Input
                    value={connectionConfig.host}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, host: e.target.value }))}
                    placeholder={t('ph_mongodb_uri')}
                    autoComplete="off"
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : selectedDatabaseType === 'cassandra' ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={t('label_contact_points')} required>
                  <Input
                    value={connectionConfig.host}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, host: e.target.value }))}
                    placeholder={t('ph_contact_points')}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('label_port')} required>
                  <Input
                    type="number"
                    value={connectionConfig.port || 9042}
                    onChange={(e) => {
                      userModifiedRef.current.port = true;
                      setConnectionConfig((prev) => ({ ...prev, port: parseInt(e.target.value) }));
                    }}
                    placeholder={t('ph_port_cassandra')}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : selectedDatabaseType === 'dynamodb' ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={t('label_aws_region')} required>
                  <Select
                    value={connectionConfig.region || 'us-east-1'}
                    onChange={(value) => setConnectionConfig((prev) => ({ ...prev, region: value }))}
                  >
                    <Option value="us-east-1">{t('region_us_east')}</Option>
                    <Option value="us-west-2">{t('region_us_west')}</Option>
                    <Option value="eu-west-1">{t('region_eu_west')}</Option>
                    <Option value="ap-southeast-1">{t('region_ap_southeast')}</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('label_endpoint_url_optional')}>
                  <Input
                    value={connectionConfig.endpoint || ''}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, endpoint: e.target.value }))}
                    placeholder={t('ph_http_localhost_8000')}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={t('label_host')} required>
                  <Input
                    value={connectionConfig.host}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, host: e.target.value }))}
                    placeholder={t('ph_localhost')}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('label_port')} required>
                  <Input
                    type="number"
                    value={connectionConfig.port}
                    onChange={(e) => {
                      userModifiedRef.current.port = true;
                      setConnectionConfig((prev) => ({ ...prev, port: parseInt(e.target.value) }));
                    }}
                    placeholder={t('ph_port_pg')}
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {selectedDatabaseType === 'prometheus_source' ? null : selectedDatabaseType === 'mongodb' ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={t('label_database')} required>
                  <Input
                    value={connectionConfig.database}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, database: e.target.value }))}
                    placeholder={t('ph_mydb')}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('label_auth_source')}>
                  <Input
                    value={connectionConfig.authSource ?? ''}
                    onChange={(e) =>
                      setConnectionConfig((prev) => ({ ...prev, authSource: e.target.value || undefined }))
                    }
                    placeholder={t('ph_auth_admin')}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : selectedDatabaseType === 'cassandra' ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={t('label_keyspace')} required>
                  <Input
                    value={connectionConfig.database}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, database: e.target.value }))}
                    placeholder={t('ph_my_keyspace')}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('label_datacenter')}>
                  <Input
                    value={connectionConfig.datacenter ?? ''}
                    onChange={(e) =>
                      setConnectionConfig((prev) => ({ ...prev, datacenter: e.target.value || undefined }))
                    }
                    placeholder={t('ph_datacenter1')}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : selectedDatabaseType === 'dynamodb' ? (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item label={t('label_table_name_optional')}>
                  <Input
                    value={connectionConfig.database}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, database: e.target.value }))}
                    placeholder={t('ph_users_table')}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('label_access_key_id')} required>
                  <Input
                    value={connectionConfig.accessKey}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, accessKey: e.target.value }))}
                    placeholder={t('ph_akia')}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  label={selectedDatabaseType === 'duckdb' ? t('label_db_file_path') : t('label_database')}
                  required
                  help={selectedDatabaseType === 'duckdb' ? t('help_duckdb_path') : undefined}
                >
                  <Input
                    value={connectionConfig.database}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, database: e.target.value }))}
                    placeholder={selectedDatabaseType === 'duckdb' ? t('ph_duckdb_path') : t('ph_database_generic')}
                  />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item label={t('label_username')} required>
                  <Input
                    value={connectionConfig.username}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, username: e.target.value }))}
                    placeholder={t('ph_username')}
                  />
                </Form.Item>
              </Col>
            </Row>
          )}

          {selectedDatabaseType === 'prometheus_source' ? null : selectedDatabaseType === 'dynamodb' ? (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item label={t('label_secret_access_key')} required>
                  <Input.Password
                    value={connectionConfig.secretKey}
                    onChange={(e) => setConnectionConfig((prev) => ({ ...prev, secretKey: e.target.value }))}
                    placeholder={t('ph_secret_access_key_sample')}
                  />
                </Form.Item>
              </Col>
            </Row>
          ) : (
            <Form.Item label={t('label_password')} required>
              <Input.Password
                value={connectionConfig.password}
                onChange={(e) => setConnectionConfig((prev) => ({ ...prev, password: e.target.value }))}
                placeholder={t('ph_password')}
              />
            </Form.Item>
          )}

          {/* Connection URL - SQL only; hidden for NoSQL to avoid duplicate/confusing fields */}
          {!['mongodb', 'cassandra', 'dynamodb', 'prometheus_source'].includes(selectedDatabaseType) && (
            <Form.Item label={t('label_connection_url')}>
              <Space.Compact style={{ width: '100%' }}>
                <Input
                  value={
                    connectionUrlEditable ? customConnectionUrl || generateConnectionUrl() : generateConnectionUrl()
                  }
                  readOnly={!connectionUrlEditable}
                  onChange={
                    connectionUrlEditable
                      ? (e) => {
                          setCustomConnectionUrl(e.target.value);
                          // Clear custom URL if user clears the field to revert to auto-generated
                          if (!e.target.value.trim()) {
                            setCustomConnectionUrl('');
                          }
                        }
                      : undefined
                  }
                  onBlur={() => {
                    // When user stops editing, if field is empty, clear custom URL to use auto-generated
                    if (connectionUrlEditable && !customConnectionUrl.trim()) {
                      setCustomConnectionUrl('');
                    }
                  }}
                  placeholder={t('ph_postgres_uri')}
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    backgroundColor: 'var(--ant-color-bg-container)',
                    color: 'var(--ant-color-text)',
                  }}
                />
                <Button
                  type={connectionUrlEditable ? 'default' : 'primary'}
                  onClick={() => {
                    if (connectionUrlEditable && customConnectionUrl) {
                      // Parse the custom URL and update connection config when switching to preview
                      parseConnectionUrl(customConnectionUrl);
                    } else if (!connectionUrlEditable) {
                      // Switching to edit mode - clear custom URL so user can edit fresh
                      setCustomConnectionUrl('');
                    }
                    setConnectionUrlEditable(!connectionUrlEditable);
                  }}
                  style={{ minWidth: '80px' }}
                >
                  {connectionUrlEditable ? t('preview') : t('edit')}
                </Button>
              </Space.Compact>
              <Text type="secondary" style={{ fontSize: '12px' }}>
                {connectionUrlEditable
                  ? t('connection_url_edit_help')
                  : t('connection_url_auto_help')}
              </Text>
            </Form.Item>
          )}

          {/* Advanced Options */}
          <Collapse ghost>
            <Panel header={t('collapse_advanced_options')} key="advanced">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('label_ssl_mode')}>
                    <Select
                      value={connectionConfig.sslMode}
                      onChange={(value) => {
                        userModifiedRef.current.sslMode = true;
                        setConnectionConfig((prev) => ({ ...prev, sslMode: value }));
                      }}
                    >
                      <Option value="disable">{t('ssl_disable')}</Option>
                      <Option value="prefer">{t('ssl_prefer')}</Option>
                      <Option value="require">{t('ssl_require')}</Option>
                      <Option value="verify-ca">{t('ssl_verify_ca')}</Option>
                      <Option value="verify-full">{t('ssl_verify_full')}</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('label_connection_pool')}>
                    <Radio.Group
                      value={connectionConfig.connectionPool}
                      onChange={(e) => setConnectionConfig((prev) => ({ ...prev, connectionPool: e.target.value }))}
                    >
                      <Radio value={false}>{t('disabled')}</Radio>
                      <Radio value={true}>{t('enabled')}</Radio>
                    </Radio.Group>
                  </Form.Item>
                </Col>
              </Row>
              {selectedDatabaseType === 'sqlserver' && (
                <Row gutter={16} style={{ marginTop: 8 }}>
                  <Col span={12}>
                    <Form.Item
                      label={t('label_trust_server_certificate')}
                      help={t('help_trust_server_certificate')}
                    >
                      <Radio.Group
                        value={connectionConfig.trustServerCertificate !== false}
                        onChange={(e) =>
                          setConnectionConfig((prev) => ({ ...prev, trustServerCertificate: e.target.value }))
                        }
                      >
                        <Radio value={true}>{t('yes')}</Radio>
                        <Radio value={false}>{t('no')}</Radio>
                      </Radio.Group>
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item label={t('label_odbc_driver')} help={t('help_odbc_driver_example')}>
                      <Input
                        placeholder={t('ph_odbc_driver_18')}
                        value={connectionConfig.driver ?? ''}
                        onChange={(e) =>
                          setConnectionConfig((prev) => ({ ...prev, driver: e.target.value || undefined }))
                        }
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('label_connection_timeout_seconds')}>
                    <Input
                      type="number"
                      min={5}
                      max={300}
                      value={connectionConfig.connectionTimeout ?? 30}
                      onChange={(e) =>
                        setConnectionConfig((prev) => ({
                          ...prev,
                          connectionTimeout: parseInt(e.target.value, 10) || 30,
                        }))
                      }
                    />
                  </Form.Item>
                </Col>
              </Row>

              {connectionConfig.connectionPool && (
                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item label={t('label_min_connections')}>
                      <Input
                        type="number"
                        value={connectionConfig.minConnections}
                        onChange={(e) =>
                          setConnectionConfig((prev) => ({ ...prev, minConnections: parseInt(e.target.value) }))
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label={t('label_max_connections')}>
                      <Input
                        type="number"
                        value={connectionConfig.maxConnections}
                        onChange={(e) =>
                          setConnectionConfig((prev) => ({ ...prev, maxConnections: parseInt(e.target.value) }))
                        }
                      />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item label={t('label_timeout_s')}>
                      <Input
                        type="number"
                        value={connectionConfig.connectionTimeout}
                        onChange={(e) =>
                          setConnectionConfig((prev) => ({ ...prev, connectionTimeout: parseInt(e.target.value) }))
                        }
                      />
                    </Form.Item>
                  </Col>
                </Row>
              )}
            </Panel>
          </Collapse>
        </Form>
      </div>
    );
  };

  const renderCloudStorageConfiguration = () => {
    const isS3 = selectedDatabaseType === 's3_parquet';
    const isAzure = selectedDatabaseType === 'azure_blob';
    const isGCP = selectedDatabaseType === 'gcp_cloud_storage';
    const isDelta = selectedDatabaseType === 'delta_lake';
    const isIceberg = selectedDatabaseType === 'iceberg';
    const isCloudStorage = isS3 || isAzure || isGCP;

    return (
      <div style={{ padding: '8px 0' }}>
        <Title level={4} style={{ marginBottom: '16px' }}>
          {isDelta
            ? 'Delta Lake Configuration'
            : isIceberg
              ? 'Apache Iceberg Configuration'
              : isS3
                ? 'Amazon S3 Configuration'
                : isAzure
                  ? 'Azure Blob Storage Configuration'
                  : isGCP
                    ? 'Google Cloud Storage Configuration'
                    : 'Cloud Storage Configuration'}
        </Title>

        <Form layout="vertical">
          {/* Database Type Selector - Always visible and prominent */}
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label={t('label_db_storage_type')} required help={t('help_db_storage_type_changeable')}>
                <Select
                  value={selectedDatabaseType}
                  onChange={(value) => {
                    setSelectedDatabaseType(value);
                    // Clear connection config when changing database type to avoid confusion
                    setConnectionConfig((prev) => ({
                      host: '',
                      port: databaseTypes.find((db) => db.value === value)?.port || 5432,
                      database: '',
                      username: '',
                      password: '',
                      sslMode: 'prefer',
                      connectionPool: false,
                      minConnections: 1,
                      maxConnections: 10,
                      connectionTimeout: 30,
                      storageUri: '',
                      accessKey: '',
                      secretKey: '',
                      region: 'us-east-1',
                      endpoint: '',
                      accountName: '',
                      accountKey: '',
                      sasToken: '',
                      gcpProjectId: '',
                      gcpCredentials: '',
                      fileFormat: '',
                      version: undefined,
                      timestamp: '',
                      snapshotId: undefined,
                      prometheusUrl: '',
                    }));
                    setTestResult(null);
                  }}
                  style={{ width: '100%' }}
                  size="large"
                >
                  {databaseTypes.map((db) => (
                    <Option key={db.value} value={db.value} disabled={db.disabled}>
                      <Space>
                        <DatabaseLogo dbType={db.value} size={18} />
                        <span>{db.label}</span>
                      </Space>
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item label={t('data_source_name')} required>
                <Input
                  value={dataSourceConfig.name}
                  onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder={t('ph_connection_name_suffix', { engine: databaseTypes.find((db) => db.value === selectedDatabaseType)?.label || '' })}
                />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={24}>
              <Form.Item
                label={t('label_storage_uri')}
                required
                help={
                  isS3
                    ? t('help_storage_uri_s3')
                    : isAzure
                      ? t('help_storage_uri_azure')
                      : isGCP
                        ? t('help_storage_uri_gcp')
                        : isDelta
                          ? t('help_storage_uri_lake')
                          : isIceberg
                            ? t('help_storage_uri_lake')
                            : t('help_storage_uri_generic')
                }
              >
                <Input
                  value={connectionConfig.storageUri || ''}
                  onChange={(e) => {
                    const uri = e.target.value;
                    setConnectionConfig((prev) => ({ ...prev, storageUri: uri }));
                    // Auto-detect and set file format from URI if not set
                    if (isCloudStorage && !connectionConfig.fileFormat) {
                      const ext = uri.split('.').pop()?.toLowerCase();
                      if (ext && ['parquet', 'csv', 'json', 'tsv'].includes(ext)) {
                        setConnectionConfig((prev) => ({ ...prev, fileFormat: ext }));
                      }
                    }
                  }}
                  placeholder={
                    isS3
                      ? t('ph_storage_uri_s3')
                      : isAzure
                        ? t('ph_storage_uri_azure')
                        : isGCP
                          ? t('ph_storage_uri_gcp')
                          : t('ph_storage_uri_multi')
                  }
                />
              </Form.Item>
            </Col>
          </Row>

          {/* File Format Selection for Cloud Storage (not data lakes) */}
          {isCloudStorage && (
            <Row gutter={16}>
              <Col span={24}>
                <Form.Item label={t('label_file_format')} required help={t('help_file_format_select')}>
                  <Select
                    value={connectionConfig.fileFormat || undefined}
                    onChange={(value) => setConnectionConfig((prev) => ({ ...prev, fileFormat: value }))}
                    placeholder={t('ph_select_file_format')}
                  >
                    <Option value="parquet">{t('file_format_parquet')}</Option>
                    <Option value="csv">{t('file_format_csv')}</Option>
                    <Option value="tsv">{t('file_format_tsv')}</Option>
                    <Option value="json">{t('file_format_json')}</Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>
          )}

          {isS3 && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('label_access_key_id')} required>
                    <Input
                      value={connectionConfig.accessKey || ''}
                      onChange={(e) => setConnectionConfig((prev) => ({ ...prev, accessKey: e.target.value }))}
                      placeholder={t('ph_akia')}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('label_secret_access_key')} required>
                    <Input.Password
                      value={connectionConfig.secretKey || ''}
                      onChange={(e) => setConnectionConfig((prev) => ({ ...prev, secretKey: e.target.value }))}
                      placeholder={t('ph_enter_secret_key')}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('label_region')} required>
                    <Input
                      value={connectionConfig.region || 'us-east-1'}
                      onChange={(e) => setConnectionConfig((prev) => ({ ...prev, region: e.target.value }))}
                      placeholder={t('ph_us_east_1')}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          {isAzure && (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('label_storage_account_name')} required>
                    <Input
                      value={connectionConfig.accountName || ''}
                      onChange={(e) => setConnectionConfig((prev) => ({ ...prev, accountName: e.target.value }))}
                      placeholder={t('ph_storage_account')}
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('label_account_key_or_sas')} required>
                    <Input.Password
                      value={connectionConfig.accountKey || connectionConfig.sasToken || ''}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Auto-detect if it's a SAS token (starts with ?)
                        if (value.startsWith('?')) {
                          setConnectionConfig((prev) => ({ ...prev, sasToken: value, accountKey: '' }));
                        } else {
                          setConnectionConfig((prev) => ({ ...prev, accountKey: value, sasToken: '' }));
                        }
                      }}
                      placeholder={t('ph_account_key_or_sas')}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          {isGCP && (
            <>
              <Alert
                message={t('alert_gcp_auth_title')}
                description={t('desc_gcp_service_account')}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item
                    label={t('label_service_account_json_key')}
                    required
                    help={t('gcp_json_help')}
                  >
                    <Input.TextArea
                      rows={6}
                      value={connectionConfig.gcpCredentials || ''}
                      onChange={(e) => setConnectionConfig((prev) => ({ ...prev, gcpCredentials: e.target.value }))}
                      placeholder='{"type": "service_account", "project_id": "...", "private_key_id": "...", ...}'
                      style={{ fontFamily: 'monospace', fontSize: '12px' }}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('label_project_id_optional')}>
                    <Input
                      value={connectionConfig.gcpProjectId || ''}
                      onChange={(e) => setConnectionConfig((prev) => ({ ...prev, gcpProjectId: e.target.value }))}
                      placeholder={t('ph_my_gcp_project')}
                    />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}

          {(isDelta || isIceberg) && (
            <>
              <Alert
                message={t('alert_cloud_provider_title')}
                description={t('desc_cloud_provider_credentials')}
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
              />
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('label_cloud_provider')} required>
                    <Select
                      value={
                        connectionConfig.storageUri?.startsWith('s3://')
                          ? 's3'
                          : connectionConfig.storageUri?.startsWith('azure://') ||
                              connectionConfig.storageUri?.startsWith('abfss://')
                            ? 'azure'
                            : connectionConfig.storageUri?.startsWith('gcs://') ||
                                connectionConfig.storageUri?.startsWith('gs://')
                              ? 'gcp'
                              : undefined
                      }
                      onChange={(value) => {
                        const uri = connectionConfig.storageUri || '';
                        if (value === 's3' && !uri.startsWith('s3://')) {
                          setConnectionConfig((prev) => ({ ...prev, storageUri: 's3://' }));
                        } else if (value === 'azure' && !uri.startsWith('azure://') && !uri.startsWith('abfss://')) {
                          setConnectionConfig((prev) => ({ ...prev, storageUri: 'azure://' }));
                        } else if (value === 'gcp' && !uri.startsWith('gcs://') && !uri.startsWith('gs://')) {
                          setConnectionConfig((prev) => ({ ...prev, storageUri: 'gcs://' }));
                        }
                      }}
                      placeholder={t('ph_select_provider')}
                    >
                      <Option value="s3">{t('cloud_provider_s3')}</Option>
                      <Option value="azure">{t('cloud_provider_azure')}</Option>
                      <Option value="gcp">{t('cloud_provider_gcp')}</Option>
                    </Select>
                  </Form.Item>
                </Col>
              </Row>

              {connectionConfig.storageUri?.startsWith('s3://') && (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label={t('label_access_key_id')} required>
                        <Input
                          value={connectionConfig.accessKey || ''}
                          onChange={(e) => setConnectionConfig((prev) => ({ ...prev, accessKey: e.target.value }))}
                          placeholder={t('ph_akia')}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label={t('label_secret_access_key')} required>
                        <Input.Password
                          value={connectionConfig.secretKey || ''}
                          onChange={(e) => setConnectionConfig((prev) => ({ ...prev, secretKey: e.target.value }))}
                          placeholder={t('ph_enter_secret_key')}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label={t('label_region')} required>
                        <Input
                          value={connectionConfig.region || 'us-east-1'}
                          onChange={(e) => setConnectionConfig((prev) => ({ ...prev, region: e.target.value }))}
                          placeholder={t('ph_us_east_1')}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}

              {connectionConfig.storageUri?.startsWith('azure://') ||
              connectionConfig.storageUri?.startsWith('abfss://') ? (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label={t('label_storage_account_name')} required>
                        <Input
                          value={connectionConfig.accountName || ''}
                          onChange={(e) => setConnectionConfig((prev) => ({ ...prev, accountName: e.target.value }))}
                          placeholder={t('ph_storage_account')}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={12}>
                      <Form.Item label={t('label_account_key_or_sas')} required>
                        <Input.Password
                          value={connectionConfig.accountKey || connectionConfig.sasToken || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value.startsWith('?')) {
                              setConnectionConfig((prev) => ({ ...prev, sasToken: value, accountKey: '' }));
                            } else {
                              setConnectionConfig((prev) => ({ ...prev, accountKey: value, sasToken: '' }));
                            }
                          }}
                          placeholder={t('ph_account_key_or_sas')}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ) : null}

              {(connectionConfig.storageUri?.startsWith('gcs://') ||
                connectionConfig.storageUri?.startsWith('gs://')) && (
                <>
                  <Row gutter={16}>
                    <Col span={24}>
                      <Form.Item
                        label={t('label_service_account_json_key')}
                        required
                        help={t('gcp_json_help')}
                      >
                        <Input.TextArea
                          rows={6}
                          value={connectionConfig.gcpCredentials || ''}
                          onChange={(e) => setConnectionConfig((prev) => ({ ...prev, gcpCredentials: e.target.value }))}
                          placeholder='{"type": "service_account", "project_id": "...", "private_key_id": "...", ...}'
                          style={{ fontFamily: 'monospace', fontSize: '12px' }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Item label={t('label_project_id_optional')}>
                        <Input
                          value={connectionConfig.gcpProjectId || ''}
                          onChange={(e) => setConnectionConfig((prev) => ({ ...prev, gcpProjectId: e.target.value }))}
                          placeholder={t('ph_my_gcp_project')}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}

              {isDelta && (
                <Collapse ghost style={{ marginTop: 16 }}>
                  <Panel header={t('collapse_time_travel_options')} key="time-travel">
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item label={t('label_version_optional')}>
                          <Input
                            type="number"
                            value={connectionConfig.version || ''}
                            onChange={(e) =>
                              setConnectionConfig((prev) => ({
                                ...prev,
                                version: e.target.value ? parseInt(e.target.value) : undefined,
                              }))
                            }
                            placeholder={t('ph_delta_version')}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={12}>
                        <Form.Item label={t('label_timestamp_optional')}>
                          <Input
                            value={connectionConfig.timestamp || ''}
                            onChange={(e) => setConnectionConfig((prev) => ({ ...prev, timestamp: e.target.value }))}
                            placeholder={t('ph_timestamp_iso')}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              )}

              {isIceberg && (
                <Collapse ghost style={{ marginTop: 16 }}>
                  <Panel header={t('collapse_snapshot_options')} key="snapshot">
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Item label={t('label_snapshot_id_optional')}>
                          <Input
                            type="number"
                            value={connectionConfig.snapshotId || ''}
                            onChange={(e) =>
                              setConnectionConfig((prev) => ({
                                ...prev,
                                snapshotId: e.target.value ? parseInt(e.target.value) : undefined,
                              }))
                            }
                            placeholder={t('ph_iceberg_snapshot')}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Panel>
                </Collapse>
              )}
            </>
          )}

          <Form.Item label={t('description')}>
            <Input.TextArea
              value={dataSourceConfig.description}
              onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, description: e.target.value }))}
              placeholder={t('description_placeholder')}
              rows={3}
            />
          </Form.Item>
        </Form>
      </div>
    );
  };

  const renderApiConfiguration = () => (
    <div style={{ padding: '8px 0' }}>
      <Title level={4} style={{ marginBottom: '16px' }}>
        {t('title_api_config')}
      </Title>

      <Form layout="vertical">
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label={t('label_api_name')} required>
              <Input
                value={dataSourceConfig.name}
                onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={t('ph_api_ds_name')}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label={t('label_base_url')} required>
              <Input
                value={connectionConfig.host}
                onChange={(e) => setConnectionConfig((prev) => ({ ...prev, host: e.target.value }))}
                placeholder={t('ph_https_api_example')}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item label={t('label_path')} help={t('help_api_path_append')}>
              <Input
                value={connectionConfig.apiPath ?? ''}
                onChange={(e) => setConnectionConfig((prev) => ({ ...prev, apiPath: e.target.value }))}
                placeholder={t('ph_api_path')}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item label={t('label_http_method')}>
              <Select
                value={connectionConfig.apiMethod ?? 'GET'}
                onChange={(value) => setConnectionConfig((prev) => ({ ...prev, apiMethod: value }))}
              >
                <Option value="GET">{t('http_get')}</Option>
                <Option value="POST">{t('http_post')}</Option>
                <Option value="PUT">{t('http_put')}</Option>
                <Option value="PATCH">{t('http_patch')}</Option>
              </Select>
            </Form.Item>
          </Col>
        </Row>

        <Form.Item label={t('label_authentication_type')}>
          <Select
            value={connectionConfig.authType || connectionConfig.username || 'none'}
            placeholder={t('ph_select_auth_method')}
            onChange={(value) =>
              setConnectionConfig((prev) => ({
                ...prev,
                authType: value,
                username: value === 'none' ? '' : prev.username,
                ...(value !== 'basic' ? { apiBasicUsername: undefined } : {}),
              }))
            }
          >
            <Option value="none">{t('auth_none')}</Option>
            <Option value="basic">{t('auth_basic')}</Option>
            <Option value="bearer">{t('auth_bearer')}</Option>
            <Option value="api_key">{t('auth_api_key')}</Option>
          </Select>
        </Form.Item>
        {(connectionConfig.authType || connectionConfig.username) === 'basic' && (
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label={t('label_basic_auth_username')}>
                <Input
                  value={connectionConfig.apiBasicUsername ?? ''}
                  onChange={(e) => setConnectionConfig((prev) => ({ ...prev, apiBasicUsername: e.target.value }))}
                  placeholder={t('ph_basic_username')}
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label={t('label_basic_auth_password')}>
                <Input.Password
                  value={connectionConfig.password ?? ''}
                  onChange={(e) => setConnectionConfig((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder={t('ph_basic_password')}
                />
              </Form.Item>
            </Col>
          </Row>
        )}
        {((connectionConfig.authType || connectionConfig.username) === 'bearer' ||
          (connectionConfig.authType || connectionConfig.username) === 'api_key') && (
          <Form.Item
            label={(connectionConfig.authType || connectionConfig.username) === 'bearer' ? t('label_bearer_token') : t('label_api_key_field')}
          >
            <Input.Password
              value={connectionConfig.password ?? ''}
              onChange={(e) => setConnectionConfig((prev) => ({ ...prev, password: e.target.value }))}
              placeholder={
                (connectionConfig.authType || connectionConfig.username) === 'bearer'
                  ? t('ph_enter_bearer_token')
                  : t('ph_enter_api_key')
              }
            />
          </Form.Item>
        )}

        <Form.Item label={t('label_headers_optional')}>
          <Input.TextArea
            value={connectionConfig.apiHeaders ?? ''}
            onChange={(e) => setConnectionConfig((prev) => ({ ...prev, apiHeaders: e.target.value }))}
            placeholder={'{"Accept": "application/json"}'}
            rows={2}
          />
        </Form.Item>

        <Form.Item label={t('label_max_rows_optional')}>
          <Input
            type="number"
            min={100}
            max={1000000}
            placeholder={t('ph_max_rows')}
            value={connectionConfig.max_rows ?? ''}
            onChange={(e) => {
              const v = e.target.value ? parseInt(e.target.value, 10) : undefined;
              setConnectionConfig((prev) => ({ ...prev, max_rows: Number.isNaN(v) ? undefined : v }));
            }}
          />
        </Form.Item>

        <Form.Item label={t('description')}>
          <Input.TextArea
            value={dataSourceConfig.description}
            onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, description: e.target.value }))}
            placeholder={t('ph_describe_api_ds')}
            rows={3}
          />
        </Form.Item>
      </Form>
    </div>
  );

  const renderTestAndSave = () => {
    // This function now only renders the test result alert
    // Buttons are moved to footer
    return (
      <>
        {testResult && (
          <Alert
            message={testResult.success ? t('connection_successful') : t('connection_failed')}
            description={testResult.message || testResult.error}
            type={testResult.success ? 'success' : 'error'}
            showIcon
            style={{ marginTop: '16px' }}
          />
        )}
      </>
    );
  };

  const [kbFiles, setKbFiles] = useState<any[]>([]);
  const [kbUploading, setKbUploading] = useState(false);
  const [kbDocuments, setKbDocuments] = useState<any[]>([]);

  const handleKbUpload = async () => {
    if (!kbFiles.length || !dataSourceConfig.name) {
      message.warning(t('kb_name_and_file_required'));
      return;
    }
    setKbUploading(true);
    try {
      // Single call: create KB data source + upload all files via /knowledge/create
      const formData = new FormData();
      formData.append('name', dataSourceConfig.name);
      formData.append('description', dataSourceConfig.description || '');
      for (const file of kbFiles) {
        formData.append('files', file.originFileObj || file);
      }
      const data = await authenticatedFetch(`/knowledge/create`, {
        method: 'POST',
        body: formData,
      });
      const dsId = data.data_source_id;
      const docs = data.documents || [];
      const successCount = docs.filter((d: any) => d.success).length;

      if (successCount > 0) {
        message.success(t('kb_ingested_count', { success: successCount, total: kbFiles.length }));
      } else {
        message.warning(t('kb_ingestion_issues'));
      }
      setKbDocuments(docs);
      onDataSourceCreated({ id: dsId, name: dataSourceConfig.name, type: 'knowledge_base' });
    } catch (err: any) {
      console.error('KB upload error:', err);
      message.error(err?.message || t('upload_failed'));
    } finally {
      setKbUploading(false);
    }
  };

  const renderKnowledgeBaseUpload = () => (
    <div style={{ padding: '24px 0' }}>
      <Title level={4} style={{ marginBottom: 4 }}>
        <FileOutlined style={{ marginRight: 8 }} />
        {t('kb_title')}
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: '20px' }}>
        {t('kb_description')}
      </Text>

      <Form layout="vertical" size="middle">
        <Form.Item label={t('kb_name_label')} required style={{ marginBottom: 12 }}>
          <Input
            placeholder={t('kb_name_placeholder')}
            value={dataSourceConfig.name}
            onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, name: e.target.value }))}
            maxLength={100}
            showCount
          />
        </Form.Item>
        <Form.Item label={t('description')} style={{ marginBottom: 16 }}>
          <Input.TextArea
            placeholder={t('kb_description_placeholder')}
            rows={2}
            value={dataSourceConfig.description || ''}
            onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, description: e.target.value }))}
            maxLength={500}
          />
        </Form.Item>
      </Form>

      <Dragger
        multiple
        accept=".pdf,.docx,.doc,.md,.markdown,.txt,.text"
        fileList={kbFiles}
        onChange={({ fileList }) => setKbFiles(fileList)}
        beforeUpload={() => false}
        disabled={kbUploading}
        style={{ marginBottom: 16 }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">{t('kb_upload_text')}</p>
        <p className="ant-upload-hint">{t('kb_upload_hint')}</p>
      </Dragger>

      {kbFiles.length > 0 && !kbDocuments.length && (
        <Alert
          type="info"
          showIcon
          message={t('kb_files_selected', { count: kbFiles.length })}
          style={{ marginBottom: 16 }}
        />
      )}

      {kbDocuments.length > 0 && (
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <Text strong style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>
            {t('kb_ingestion_results')}
          </Text>
          {kbDocuments.map((doc: any, i: number) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
                padding: '6px 10px',
                borderRadius: 6,
                background: doc.success
                  ? 'var(--ant-color-success-bg, rgba(82,196,26,0.06))'
                  : 'var(--ant-color-error-bg, rgba(255,77,79,0.06))',
              }}
            >
              {doc.success ? (
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 14 }} />
              ) : (
                <CloseCircleOutlined style={{ color: '#ff4d4f', fontSize: 14 }} />
              )}
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
                title={doc.filename || `File ${i + 1}`}
              >
                {doc.filename || `File ${i + 1}`}
              </span>
              <Tag color={doc.success ? 'green' : 'red'} style={{ margin: 0, fontSize: 11 }}>
                {doc.status === 'ready' ? t('kb_status_ready') : doc.status === 'failed' ? t('kb_status_failed') : doc.status}
              </Tag>
              {doc.message && doc.success && (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {doc.message.replace(/^Ingestion /, '')}
                </Text>
              )}
            </div>
          ))}
        </div>
      )}

      <Button
        type="primary"
        icon={kbUploading ? <LoadingOutlined /> : <SaveOutlined />}
        onClick={handleKbUpload}
        loading={kbUploading}
        disabled={!kbFiles.length || !dataSourceConfig.name || kbUploading}
        block
        size="large"
        style={{ height: 44 }}
      >
        {kbUploading ? t('kb_processing_documents') : t('kb_create_upload')}
      </Button>
    </div>
  );

  const renderSampleDataConfig = () => (
    <div style={{ padding: '24px 0' }}>
      <Title level={4}>{t('sample_data')}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        {t('sample_data_intro')}
      </Text>
      <Row gutter={16}>
        <Col span={24}>
          <Form.Item label={t('data_source_name')} required>
            <Input
              value={dataSourceConfig.name}
              onChange={(e) => setDataSourceConfig((prev) => ({ ...prev, name: e.target.value.trim() }))}
              placeholder={t('ph_sample_ds_name')}
            />
          </Form.Item>
        </Col>
        <Col span={24}>
          <Form.Item label={t('label_industry_domain')} required>
            <Select
              value={selectedSampleDomain}
              onChange={(value) => {
                setSelectedSampleDomain(value);
                if (!dataSourceConfig.name || dataSourceConfig.name.startsWith('Sample:')) {
                  setDataSourceConfig((prev) => ({ ...prev, name: `Sample: ${SAMPLE_DOMAINS.find((d) => d.value === value)?.label ?? value}` }));
                }
              }}
              style={{ width: '100%' }}
              options={SAMPLE_DOMAINS.map((d) => ({ value: d.value, label: d.label }))}
            />
          </Form.Item>
        </Col>
      </Row>
      <Button
        type="primary"
        icon={<SaveOutlined />}
        onClick={saveDataSource}
        loading={loading}
        disabled={!dataSourceConfig.name?.trim()}
      >
        {t('btn_save')}
      </Button>
    </div>
  );

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return renderDataSourceTypeSelection();
      case 1:
        if (dataSourceConfig.type === 'file') {
          return renderFileUpload();
        } else if (dataSourceConfig.type === 'knowledge_base') {
          return renderKnowledgeBaseUpload();
        } else if (dataSourceConfig.type === 'sample_duckdb') {
          return renderSampleDataConfig();
        } else if (dataSourceConfig.type === 'api') {
          return (
            <>
              {renderApiConfiguration()}
              {renderTestAndSave()}
            </>
          );
        } else if (dataSourceConfig.type === 'warehouse') {
          // Check if it's a data lake or cloud storage type (Delta/Iceberg/S3/Azure/GCP)
          if (
            ['delta_lake', 'iceberg', 's3_parquet', 'azure_blob', 'gcp_cloud_storage'].includes(selectedDatabaseType)
          ) {
            return (
              <>
                {renderCloudStorageConfiguration()}
                {renderTestAndSave()}
              </>
            );
          }
          return (
            <>
              {renderDatabaseConfiguration()}
              {renderTestAndSave()}
            </>
          );
        } else {
          return (
            <>
              {renderDatabaseConfiguration()}
              {renderTestAndSave()}
            </>
          );
        }
      default:
        return null;
    }
  };

  const canProceedToNext = () => {
    switch (currentStep) {
      case 0:
        return dataSourceConfig.type !== undefined && dataSourceConfig.type !== '';
      case 1:
        if (dataSourceConfig.type === 'file') {
          if (fileSourceKind === 'google_sheet') {
            return dataSourceConfig.name?.trim() !== '' && googleSheetUrl?.trim() !== '';
          }
          return uploadedFile !== null && dataSourceConfig.name !== '';
        } else if (dataSourceConfig.type === 'knowledge_base') {
          // KB uses its own upload button; step validation: name + files selected
          return dataSourceConfig.name !== '' && kbFiles.length > 0;
        } else if (dataSourceConfig.type === 'api') {
          return connectionConfig.host !== '' && dataSourceConfig.name !== '';
        } else if (dataSourceConfig.type === 'sample_duckdb') {
          return dataSourceConfig.name !== '';
        } else {
          // Check if this is a cloud storage or data lake type
          const isDataLake = databaseTypes.find((db) => db.value === selectedDatabaseType)?.isDataLake;
          const isCloudStorage =
            selectedDatabaseType === 's3_parquet' ||
            selectedDatabaseType === 'azure_blob' ||
            selectedDatabaseType === 'gcp_cloud_storage';

          if (isDataLake || isCloudStorage) {
            // For cloud storage/data lake types
            const hasStorageUri =
              connectionConfig.storageUri !== '' &&
              (connectionConfig.storageUri?.startsWith('s3://') ||
                connectionConfig.storageUri?.startsWith('azure://') ||
                connectionConfig.storageUri?.startsWith('abfss://') ||
                connectionConfig.storageUri?.startsWith('gcs://') ||
                connectionConfig.storageUri?.startsWith('gs://'));

            if (selectedDatabaseType === 's3_parquet') {
              // S3 requires: storageUri, accessKey, secretKey, fileFormat
              return (
                hasStorageUri &&
                connectionConfig.accessKey !== '' &&
                connectionConfig.secretKey !== '' &&
                connectionConfig.fileFormat !== '' &&
                dataSourceConfig.name !== ''
              );
            } else if (selectedDatabaseType === 'azure_blob') {
              // Azure Blob requires: storageUri, accountName, (accountKey OR sasToken), fileFormat
              return (
                hasStorageUri &&
                connectionConfig.accountName !== '' &&
                (connectionConfig.accountKey !== '' || connectionConfig.sasToken !== '') &&
                connectionConfig.fileFormat !== '' &&
                dataSourceConfig.name !== ''
              );
            } else if (selectedDatabaseType === 'gcp_cloud_storage') {
              // GCP Cloud Storage requires: storageUri, serviceAccountKey (gcpCredentials), fileFormat
              return (
                hasStorageUri &&
                connectionConfig.gcpCredentials !== '' &&
                connectionConfig.fileFormat !== '' &&
                dataSourceConfig.name !== ''
              );
            } else if (selectedDatabaseType === 'delta_lake') {
              // Delta Lake requires: storageUri, and S3, Azure, or GCP credentials
              const hasS3Creds =
                connectionConfig.storageUri?.startsWith('s3://') &&
                connectionConfig.accessKey !== '' &&
                connectionConfig.secretKey !== '';
              const hasAzureCreds =
                (connectionConfig.storageUri?.startsWith('azure://') ||
                  connectionConfig.storageUri?.startsWith('abfss://')) &&
                connectionConfig.accountName !== '' &&
                (connectionConfig.accountKey !== '' || connectionConfig.sasToken !== '');
              const hasGCPCreds =
                (connectionConfig.storageUri?.startsWith('gcs://') ||
                  connectionConfig.storageUri?.startsWith('gs://')) &&
                connectionConfig.gcpCredentials !== '';
              return hasStorageUri && (hasS3Creds || hasAzureCreds || hasGCPCreds) && dataSourceConfig.name !== '';
            } else if (selectedDatabaseType === 'iceberg') {
              // Iceberg requires: storageUri, and S3, Azure, or GCP credentials
              const hasS3Creds =
                connectionConfig.storageUri?.startsWith('s3://') &&
                connectionConfig.accessKey !== '' &&
                connectionConfig.secretKey !== '';
              const hasAzureCreds =
                (connectionConfig.storageUri?.startsWith('azure://') ||
                  connectionConfig.storageUri?.startsWith('abfss://')) &&
                connectionConfig.accountName !== '' &&
                (connectionConfig.accountKey !== '' || connectionConfig.sasToken !== '');
              const hasGCPCreds =
                (connectionConfig.storageUri?.startsWith('gcs://') ||
                  connectionConfig.storageUri?.startsWith('gs://')) &&
                connectionConfig.gcpCredentials !== '';
              return hasStorageUri && (hasS3Creds || hasAzureCreds || hasGCPCreds) && dataSourceConfig.name !== '';
            }
          }

          // For traditional database/warehouse types
          return (
            connectionConfig.host !== '' &&
            connectionConfig.database !== '' &&
            connectionConfig.username !== '' &&
            connectionConfig.password !== '' &&
            dataSourceConfig.name !== ''
          );
        }
      case 2:
        // For files, this step should not be reached
        if (dataSourceConfig.type === 'file') {
          return false; // Files don't use step 2
        }
        // For databases/warehouses/APIs, require successful test
        return testResult?.success === true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 2) {
      // File (upload or Google Sheet), knowledge_base, and sample_duckdb complete in step 1 — no step 2 needed
      if (dataSourceConfig.type === 'file' || dataSourceConfig.type === 'knowledge_base' || dataSourceConfig.type === 'sample_duckdb') {
        return;
      } else {
        setCurrentStep((prev) => prev + 1);
      }
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const renderWizardFooter = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        width: '100%',
        gap: 8,
      }}
    >
      <div>
        {currentStep > 0 && <Button onClick={handlePrev}>{t('btn_previous')}</Button>}
        {currentStep === 0 && <Button onClick={onClose}>{t('cancel')}</Button>}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {currentStep === 0 && (
          <Button type="primary" onClick={handleNext} disabled={!canProceedToNext()}>
            {t('btn_next')}
          </Button>
        )}
        {currentStep === 1 && dataSourceConfig.type === 'file' && fileSourceKind === 'upload' && (
          <Button
            type="primary"
            onClick={saveDataSource}
            loading={loading}
            disabled={!uploadedFile || !dataSourceConfig.name}
            icon={<SaveOutlined />}
          >
            {t('btn_save')}
          </Button>
        )}
        {currentStep === 1 && dataSourceConfig.type === 'knowledge_base' && kbDocuments.length > 0 && (
          <Button type="primary" onClick={onClose}>
            {t('btn_done')}
          </Button>
        )}
        {currentStep === 1 &&
          (dataSourceConfig.type !== 'file' || fileSourceKind === 'google_sheet') &&
          dataSourceConfig.type !== 'knowledge_base' &&
          dataSourceConfig.type !== 'sample_duckdb' && (
            <>
              <Button type="default" onClick={testConnection} loading={loading} icon={<CheckCircleOutlined />}>
                {t('btn_test')}
              </Button>
              <Button
                type="primary"
                onClick={saveDataSource}
                loading={loading}
                icon={<SaveOutlined />}
                disabled={
                  dataSourceConfig.type === 'file' && fileSourceKind === 'google_sheet'
                    ? !dataSourceConfig.name?.trim() || !googleSheetUrl?.trim()
                    : testResult
                      ? !testResult.success
                      : false
                }
              >
                {t('btn_save')}
              </Button>
            </>
          )}
      </div>
    </div>
  );

  return (
    <Modal
      title={
        <Space>
          <DatabaseOutlined />
          {isChatIntegration ? 'Connect Data for Chat Analysis' : 'Data Source Wizard'}
        </Space>
      }
      open={isOpen}
      onCancel={onClose}
      footer={renderWizardFooter()}
      width={isCompactViewport ? '95vw' : 800}
      centered={!isCompactViewport}
      style={isCompactViewport ? { top: 12 } : undefined}
      classNames={{ body: 'aiser-themed-scrollbar' }}
      styles={{
        body: {
          maxHeight: isCompactViewport ? '78vh' : '72vh',
          overflowY: 'auto',
          overflowX: 'hidden',
          paddingRight: isCompactViewport ? 20 : 24,
          paddingLeft: isCompactViewport ? 20 : 24,
          paddingTop: 16,
        },
      }}
      destroyOnHidden
    >
      <Steps
        current={currentStep}
        direction={isCompactViewport ? 'vertical' : 'horizontal'}
        size={isCompactViewport ? 'small' : 'default'}
        style={{ marginBottom: '24px' }}
      >
        {steps.map((step, index) => (
          <Step key={index} title={step.title} description={step.description} />
        ))}
      </Steps>

      {renderStepContent()}
    </Modal>
  );
};

export default UniversalDataSourceModal;