'use client';

import React from 'react';
import { Col, Form, Input, Row, Switch } from 'antd';
import { useTranslations } from 'next-intl';

/**
 * Connection fields for warehouses and enterprise databases, in each engine's own terms
 * (Databricks HTTP path, Oracle service name, Athena result location, BigQuery key…).
 * The server turns them into one SQLAlchemy URL for the test, schema and queries
 * (server/src/modules/data/services/warehouse_urls.py).
 */

export const WAREHOUSE_TYPES = ['databricks', 'oracle', 'trino', 'athena', 'bigquery', 'snowflake'] as const;
export type WarehouseType = (typeof WAREHOUSE_TYPES)[number];

type Field = {
  key: string;
  label: string; // data_source_modal key
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  multiline?: boolean;
  toggle?: boolean;
  half?: boolean;
};

export const WAREHOUSE_FIELDS: Record<WarehouseType, Field[]> = {
  databricks: [
    { key: 'host', label: 'wh_server_hostname', placeholder: 'adb-1234567890.1.azuredatabricks.net', required: true },
    { key: 'http_path', label: 'wh_http_path', placeholder: '/sql/1.0/warehouses/abc123', required: true },
    { key: 'token', label: 'wh_access_token', required: true, secret: true },
    { key: 'catalog', label: 'wh_catalog', placeholder: 'main', half: true },
    { key: 'schema', label: 'wh_schema', placeholder: 'default', half: true },
  ],
  oracle: [
    { key: 'host', label: 'wh_host', placeholder: 'db.example.com', required: true, half: true },
    { key: 'port', label: 'wh_port', placeholder: '1521', half: true },
    { key: 'service_name', label: 'wh_service_name', placeholder: 'ORCLPDB1', required: true },
    { key: 'username', label: 'wh_username', required: true, half: true },
    { key: 'password', label: 'wh_password', required: true, secret: true, half: true },
  ],
  trino: [
    { key: 'host', label: 'wh_host', placeholder: 'trino.example.com', required: true, half: true },
    { key: 'port', label: 'wh_port', placeholder: '443', half: true },
    { key: 'catalog', label: 'wh_catalog', placeholder: 'hive', required: true, half: true },
    { key: 'schema', label: 'wh_schema', placeholder: 'default', half: true },
    { key: 'username', label: 'wh_username', required: true, half: true },
    { key: 'password', label: 'wh_password_optional', secret: true, half: true },
    { key: 'tls', label: 'wh_use_tls', toggle: true },
  ],
  athena: [
    { key: 'region', label: 'wh_region', placeholder: 'ap-southeast-1', required: true, half: true },
    { key: 'schema', label: 'wh_database', placeholder: 'default', half: true },
    { key: 's3_staging_dir', label: 'wh_s3_results', placeholder: 's3://my-bucket/athena-results/', required: true },
    { key: 'work_group', label: 'wh_work_group', placeholder: 'primary' },
    { key: 'access_key_id', label: 'wh_access_key', half: true },
    { key: 'secret_access_key', label: 'wh_secret_key', secret: true, half: true },
  ],
  bigquery: [
    { key: 'project_id', label: 'wh_project_id', placeholder: 'my-gcp-project', required: true, half: true },
    { key: 'dataset', label: 'wh_dataset', placeholder: 'analytics', half: true },
    { key: 'credentials_json', label: 'wh_service_account_key', secret: true, multiline: true },
  ],
  snowflake: [
    { key: 'host', label: 'wh_account', placeholder: 'xy12345.ap-southeast-1', required: true },
    { key: 'username', label: 'wh_username', required: true, half: true },
    { key: 'password', label: 'wh_password', required: true, secret: true, half: true },
    { key: 'warehouse', label: 'wh_warehouse', placeholder: 'COMPUTE_WH', half: true },
    { key: 'role', label: 'wh_role', placeholder: 'ANALYST', half: true },
    { key: 'database', label: 'wh_database', placeholder: 'ANALYTICS', required: true, half: true },
    { key: 'schema', label: 'wh_schema', placeholder: 'PUBLIC', half: true },
  ],
};

export function isWarehouseType(type: string): type is WarehouseType {
  return (WAREHOUSE_TYPES as readonly string[]).includes(type);
}

/** Labels of required fields that are still empty. */
export function missingWarehouseFields(type: WarehouseType, values: Record<string, string>): string[] {
  return WAREHOUSE_FIELDS[type].filter((f) => f.required && !String(values[f.key] ?? '').trim()).map((f) => f.label);
}

/** Request body for /data/database/test and /data/database/connect. */
export function warehouseRequest(type: WarehouseType, values: Record<string, string>): Record<string, unknown> {
  const v = (k: string) => String(values[k] ?? '').trim() || undefined;
  const port = v('port') ? Number(v('port')) : undefined;
  const custom: Record<string, unknown> = {};
  for (const f of WAREHOUSE_FIELDS[type]) {
    if (['host', 'port', 'username', 'password', 'database'].includes(f.key) || f.toggle) continue;
    if (v(f.key)) custom[f.key] = v(f.key);
  }
  if (type === 'trino' && values.tls === 'off') custom.ssl_mode = 'disable';
  return {
    type,
    host: v('host'),
    port,
    database: v('database') ?? v('catalog') ?? v('dataset') ?? v('schema'),
    username: v('username'),
    password: v('password'),
    connection_type: 'manual',
    custom_fields: custom,
  };
}

export function WarehouseConnectionFields({
  type,
  values,
  onChange,
}: {
  type: WarehouseType;
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const t = useTranslations('data_source_modal');
  const set = (key: string, value: string) => onChange({ ...values, [key]: value });
  return (
    <Row gutter={12}>
      {WAREHOUSE_FIELDS[type].map((f) => (
        <Col key={f.key} span={f.half ? 12 : 24}>
          <Form.Item label={t(f.label as never)} required={f.required}>
            {f.toggle ? (
              <Switch
                id={`wh-${type}-${f.key}`}
                checked={values[f.key] !== 'off'}
                onChange={(on) => set(f.key, on ? 'on' : 'off')}
              />
            ) : f.multiline ? (
              <Input.TextArea
                id={`wh-${type}-${f.key}`}
                rows={4}
                value={values[f.key] ?? ''}
                placeholder={t('wh_service_account_key_placeholder')}
                onChange={(e) => set(f.key, e.target.value)}
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
              />
            ) : f.secret ? (
              <Input.Password
                id={`wh-${type}-${f.key}`}
                value={values[f.key] ?? ''}
                autoComplete="new-password"
                onChange={(e) => set(f.key, e.target.value)}
              />
            ) : (
              <Input
                id={`wh-${type}-${f.key}`}
                value={values[f.key] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </Form.Item>
        </Col>
      ))}
    </Row>
  );
}
