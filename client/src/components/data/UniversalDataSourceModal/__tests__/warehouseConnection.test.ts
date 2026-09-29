import { describe, expect, it } from 'vitest';
import { missingWarehouseFields, warehouseRequest } from '../WarehouseConnectionFields';

describe('warehouse connection request', () => {
  it('sends engine settings in custom_fields and the basics at the top level', () => {
    const body = warehouseRequest('databricks', {
      host: 'adb-1.azuredatabricks.net',
      http_path: '/sql/1.0/warehouses/x',
      token: 'dapi1',
      catalog: 'main',
    });
    expect(body).toMatchObject({ type: 'databricks', host: 'adb-1.azuredatabricks.net', database: 'main' });
    expect(body.custom_fields).toEqual({ http_path: '/sql/1.0/warehouses/x', token: 'dapi1', catalog: 'main' });
  });

  it('turns the TLS switch off into plain http for Trino', () => {
    const body = warehouseRequest('trino', { host: 'trino', port: '8080', catalog: 'hive', username: 'ana', tls: 'off' });
    expect(body.port).toBe(8080);
    expect((body.custom_fields as Record<string, unknown>).ssl_mode).toBe('disable');
  });

  it('names the required fields still empty', () => {
    expect(missingWarehouseFields('oracle', { host: 'h', username: 'u' })).toEqual(['wh_service_name', 'wh_password']);
    expect(missingWarehouseFields('athena', { region: 'eu-west-1', s3_staging_dir: 's3://b/' })).toEqual([]);
  });
});
