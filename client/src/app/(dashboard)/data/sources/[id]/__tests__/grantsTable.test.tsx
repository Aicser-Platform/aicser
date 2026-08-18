import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DataSourceAccessGrant } from '@/api/dataSources';
import { accessLevelForPermissions } from '../_components/GrantsTable';
import BypassBanner from '../_components/BypassBanner';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

const grant = (over: Partial<DataSourceAccessGrant>): DataSourceAccessGrant =>
  ({
    id: 'g1',
    data_source_id: 'ds1',
    grantee_type: 'user',
    grantee_id: 'u1',
    permissions: ['view', 'query'],
    rls_policy_id: null,
    ...over,
  }) as DataSourceAccessGrant;

describe('accessLevelForPermissions', () => {
  it('recognises each preset regardless of ordering', () => {
    expect(accessLevelForPermissions(['view'])).toBe('view');
    expect(accessLevelForPermissions(['query', 'view'])).toBe('explore');
    expect(accessLevelForPermissions(['share', 'manage', 'edit', 'query', 'view'])).toBe('manage');
  });

  it('falls back to custom for anything else', () => {
    expect(accessLevelForPermissions(['view', 'edit'])).toBe('custom');
    expect(accessLevelForPermissions([])).toBe('custom');
  });
});

describe('BypassBanner', () => {
  it('warns with the bypassing grant count', () => {
    render(<BypassBanner grants={[grant({}), grant({ id: 'g2', rls_policy_id: 'p1' })]} />);
    expect(screen.getByText(/bypass_banner/)).toHaveTextContent('"count":1');
  });

  it('stays silent when every query grant is filtered', () => {
    const { container } = render(<BypassBanner grants={[grant({ rls_policy_id: 'p1' })]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays silent for an unfiltered view-only grant', () => {
    const { container } = render(<BypassBanner grants={[grant({ permissions: ['view'] })]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
