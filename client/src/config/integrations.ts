'use client';

/**
 * Integration definitions for data sources.
 * Logos are chosen to work in both light and dark mode (devicons/original or theme-friendly assets).
 */

export type IntegrationCategory = 'database' | 'warehouse' | 'cloud' | 'file' | 'api' | 'datalake';

export interface Integration {
  name: string;
  category: IntegrationCategory;
  logo: string;
  description: string;
  officialUrl?: string;
  docsUrl?: string;
  status: 'available' | 'coming-soon';
}

/** Key used in app for db_type / source type (lowercase, no spaces). */
export function integrationKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
}

export const INTEGRATIONS: Integration[] = [
  // Databases
  {
    name: 'PostgreSQL',
    category: 'database',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/postgresql/postgresql-original-wordmark.svg',
    description: 'Open-source relational database with advanced features and extensibility.',
    officialUrl: 'https://www.postgresql.org',
    status: 'available',
  },
  {
    name: 'MySQL',
    category: 'database',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mysql/mysql-original-wordmark.svg',
    description: "World's most popular open-source relational database management system.",
    officialUrl: 'https://www.mysql.com',
    status: 'available',
  },
  {
    name: 'SQL Server',
    category: 'database',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/microsoftsqlserver/microsoftsqlserver-plain-wordmark.svg',
    description: "Microsoft's enterprise-grade relational database management system.",
    officialUrl: 'https://www.microsoft.com/sql-server',
    status: 'available',
  },
  {
    name: 'MariaDB',
    category: 'database',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/mariadb/mariadb-original-wordmark.svg',
    description: 'Open-source relational database, fork of MySQL.',
    officialUrl: 'https://mariadb.org',
    status: 'available',
  },
  // Data Warehouses
  {
    name: 'Snowflake',
    category: 'warehouse',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/snowflake/snowflake-original.svg',
    description: 'Cloud data platform built for the cloud with instant elasticity and secure data sharing.',
    officialUrl: 'https://www.snowflake.com',
    docsUrl: 'https://docs.snowflake.com',
    status: 'available',
  },
  {
    name: 'BigQuery',
    category: 'warehouse',
    logo: 'https://cdn.worldvectorlogo.com/logos/google-bigquery-logo-1.svg',
    description: "Google's fully managed, serverless data warehouse for analytics at scale.",
    officialUrl: 'https://cloud.google.com/bigquery',
    docsUrl: 'https://cloud.google.com/bigquery/docs',
    status: 'available',
  },
  {
    name: 'Redshift',
    category: 'warehouse',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/Amazon-Redshift-Logo.svg/1862px-Amazon-Redshift-Logo.svg.png',
    description: "AWS's fully managed, petabyte-scale data warehouse service.",
    officialUrl: 'https://aws.amazon.com/redshift',
    docsUrl: 'https://docs.aws.amazon.com/redshift',
    status: 'available',
  },
  {
    name: 'ClickHouse',
    category: 'warehouse',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/clickhouse/clickhouse-original.svg',
    description: 'Open-source column-oriented database management system for real-time analytics.',
    officialUrl: 'https://clickhouse.com',
    status: 'available',
  },
  {
    name: 'Prometheus',
    category: 'warehouse',
    logo: 'https://cdn.jsdelivr.net/npm/simple-icons@v9/icons/prometheus.svg',
    description: 'Time-series metrics store; query with PromQL over the HTTP API.',
    officialUrl: 'https://prometheus.io',
    status: 'available',
  },
  {
    name: 'DuckDB',
    category: 'warehouse',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/40/DuckDB_logo.svg/1200px-DuckDB_logo.svg.png',
    description: 'In-process analytical database optimized for analytical queries.',
    officialUrl: 'https://duckdb.org',
    status: 'available',
  },
  // Cloud
  {
    name: 'AWS S3',
    category: 'cloud',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/amazonwebservices/amazonwebservices-original-wordmark.svg',
    description: 'Amazon Simple Storage Service for scalable object storage.',
    officialUrl: 'https://aws.amazon.com/s3',
    docsUrl: 'https://docs.aws.amazon.com/s3',
    status: 'available',
  },
  {
    name: 'Google Cloud Storage',
    category: 'cloud',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/googlecloud/googlecloud-original.svg',
    description: 'Unified object storage for developers and enterprises.',
    officialUrl: 'https://cloud.google.com/storage',
    status: 'available',
  },
  {
    name: 'Azure Blob Storage',
    category: 'cloud',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/azure/azure-original.svg',
    description: "Microsoft's object storage solution for the cloud.",
    officialUrl: 'https://azure.microsoft.com/services/storage/blobs',
    status: 'available',
  },
  // Files
  {
    name: 'CSV',
    category: 'file',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/file/file-original.svg',
    description: 'Import and analyze data from CSV files directly.',
    status: 'available',
  },
  {
    name: 'Excel',
    category: 'file',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e3/Microsoft_Office_Excel_%282019%E2%80%932025%29.svg/1200px-Microsoft_Office_Excel_%282019%E2%80%932025%29.svg.png',
    description: 'Connect to Excel files (.xlsx, .xls) for instant analysis.',
    officialUrl: 'https://www.microsoft.com/excel',
    status: 'available',
  },
  {
    name: 'Parquet',
    category: 'file',
    logo: 'https://parquet.apache.org/images/logo.png',
    description: 'Columnar storage format optimized for analytics workloads.',
    officialUrl: 'https://parquet.apache.org',
    status: 'available',
  },
  {
    name: 'Google Sheets',
    category: 'file',
    logo: 'https://cdn.simpleicons.org/googlesheets/0F9D58',
    description: 'Connect to Google Sheets by URL for live or published sheet data.',
    officialUrl: 'https://www.google.com/sheets',
    status: 'available',
  },
  // API
  {
    name: 'REST API',
    category: 'api',
    logo: 'https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/nodejs/nodejs-original.svg',
    description: 'Connect to any RESTful API endpoint for real-time data access.',
    status: 'available',
  },
  // Data Lakes
  {
    name: 'Delta Lake',
    category: 'datalake',
    logo: 'https://avatars.githubusercontent.com/u/49767398?s=280&v=4',
    description: 'Open-source storage layer that brings ACID transactions to Apache Spark.',
    officialUrl: 'https://delta.io',
    status: 'available',
  },
  {
    name: 'Apache Iceberg',
    category: 'datalake',
    logo: 'https://iceberg.apache.org/assets/images/Iceberg-logo.svg',
    description: 'Open table format for huge analytic tables.',
    officialUrl: 'https://iceberg.apache.org',
    status: 'available',
  },
];

/** Map app db_type / type values to integration name key (integrationKey(name)). */
const APP_TYPE_TO_INTEGRATION_NAME: Record<string, string> = {
  postgresql: 'postgresql',
  mysql: 'mysql',
  sqlserver: 'sql_server',
  mssql: 'sql_server',
  mariadb: 'mariadb',
  snowflake: 'snowflake',
  bigquery: 'bigquery',
  redshift: 'redshift',
  clickhouse: 'clickhouse',
  prometheus_source: 'prometheus',
  duckdb: 'duckdb',
  sample_duckdb: 'duckdb',
  google_sheets: 'google_sheets',
  s3_parquet: 'aws_s3',
  azure_blob: 'azure_blob_storage',
  gcp_cloud_storage: 'google_cloud_storage',
  delta_lake: 'delta_lake',
  iceberg: 'apache_iceberg',
  file: 'csv',
  api: 'rest_api',
};

/** Build lookup: integrationKey(name) -> Integration */
const BY_KEY: Record<string, Integration> = {};
INTEGRATIONS.forEach((int) => {
  const key = integrationKey(int.name);
  BY_KEY[key] = int;
});

/** Resolve app type (e.g. sqlserver, clickhouse) to Integration. */
export function getIntegrationByAppType(appType: string): Integration | undefined {
  if (!appType) return undefined;
  const normalized = appType.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
  const nameKey = APP_TYPE_TO_INTEGRATION_NAME[normalized] ?? normalized;
  return BY_KEY[nameKey] ?? BY_KEY[normalized];
}

export function getIntegrationLogo(appType: string): string | undefined {
  return getIntegrationByAppType(appType)?.logo;
}
